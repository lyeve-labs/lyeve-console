// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import ResidencyPage from './+page.svelte';
import type { Region, ResidencyReport } from '$lib/api/residency';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function region(over: Partial<Region> = {}): Region {
	return {
		id: 'r1',
		slug: 'eu-west-1',
		display_name: 'EU West (Ireland)',
		provider: 'aws',
		enabled: true,
		is_default: true,
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

function report(over: Partial<ResidencyReport> = {}): ResidencyReport {
	return {
		generated_at: '2026-09-22T10:00:00Z',
		regions: [region()],
		tenant_regions: [
			{
				tenant_id: 't1',
				tenant_slug: 'acme',
				tenant_name: 'Acme',
				region_id: 'r1',
				region_slug: 'eu-west-1',
				region_display_name: 'EU West (Ireland)',
				provider: 'aws',
				assigned_at: '2026-09-01T00:00:00Z',
				has_replica: true,
				replica_status: 'synced',
			},
		],
		summary: {
			total_regions: 1,
			total_tenants: 1,
			tenants_per_region: { 'eu-west-1': 1 },
			replicating_count: 1,
			unassigned_count: 0,
		},
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		regions: [region()],
		report: report(),
		reportGate: { state: 'ok' },
		gate: { state: 'ok' },
		licensed: true,
		permitted: true,
		...over,
	} as never,
	form: form as never,
});

describe('the gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(ResidencyPage, {
			props: props({ gate: { state: 'locked', upgradeUrl: '' }, regions: [], report: null }),
		});
		expect(said(container)).toContain('Not enabled on this engine');
	});

	it('explains the refusal to an admin who may not read it', () => {
		const { container } = render(ResidencyPage, {
			props: props({ permitted: false, regions: [], report: null }),
		});
		expect(said(container)).toContain('Only a super admin can see regions and the residency report');
	});
});

describe('the report', () => {
	// An unread report drawn as a clean one is the worst answer this page can
	// give: zero unplaced tenants because nobody could ask.
	it('never draws an unread report as a clean one', () => {
		const { container } = render(ResidencyPage, {
			props: props({
				report: null,
				reportGate: {
					state: 'error',
					message: 'Could not load the residency report.',
				},
			}),
		});
		const text = said(container);
		expect(text).toContain('Could not load the residency report.');
		expect(text).not.toContain('No tenants assigned yet');
	});

	it('says a refused report is a role refusal, not an outage', () => {
		const { container } = render(ResidencyPage, {
			props: props({ report: null, reportGate: { state: 'forbidden' } }),
		});
		const text = said(container);
		expect(text).toContain('Your role cannot open the residency report.');
		expect(text).not.toContain('did not load');
		expect(text).not.toContain('No tenants assigned yet');
	});

	it('calls an unplaced tenant unaccounted for, not defaulted', () => {
		const stranded = report({
			summary: {
				total_regions: 1,
				total_tenants: 4,
				tenants_per_region: { 'eu-west-1': 1 },
				replicating_count: 1,
				unassigned_count: 3,
			},
		});
		const { container } = render(ResidencyPage, { props: props({ report: stranded }) });
		const text = said(container);
		expect(text).toContain('3 tenants have no region assigned');
		expect(text).toContain('They are not in a default region');
	});

	it('warns that a truncated report is not an audit', () => {
		const partial = report({
			tenant_regions: [],
			summary: {
				total_regions: 1,
				total_tenants: 500,
				tenants_per_region: { 'eu-west-1': 500 },
				replicating_count: 0,
				unassigned_count: 0,
			},
		});
		const { container } = render(ResidencyPage, { props: props({ report: partial }) });
		expect(said(container)).toContain('This report covers one page of tenants, not all of them.');
	});

	it('says nothing is placed rather than reporting compliance', () => {
		const { container } = render(ResidencyPage, {
			props: props({ report: report({ summary: null, tenant_regions: [] }) }),
		});
		expect(said(container)).toContain('No tenants assigned yet');
	});

	it('names where each tenant sits and whether it has a replica', () => {
		const { container } = render(ResidencyPage, { props: props() });
		const text = said(container);
		expect(text).toContain('eu-west-1');
		expect(text).toContain('In step');
	});
});

describe('regions', () => {
	// A disabled region keeps every tenant already in it, so nothing here may
	// read as an evacuation.
	it('says a closed region is closed to new tenants', () => {
		const { container } = render(ResidencyPage, {
			props: props({ regions: [region({ enabled: false, is_default: false })] }),
		});
		expect(said(container)).toContain('Closed to new tenants');
	});

	it('marks the default region', () => {
		const { container } = render(ResidencyPage, { props: props() });
		expect(said(container)).toContain('Default for new tenants');
	});

	it('says a region has to exist before a tenant can be placed', () => {
		const { container } = render(ResidencyPage, { props: props({ regions: [] }) });
		expect(said(container)).toContain('Create a region before you place a tenant in it');
	});
});

describe('Data residency region drawer', () => {
	it('shows a failed save inside the open drawer', async () => {
		const { getByRole } = render(ResidencyPage, {
			props: props({}, { action: 'create', error: 'A region with that slug already exists.' }),
		});
		await fireEvent.click(getByRole('button', { name: /new region/i }));
		const form = document.getElementById('region-form') as HTMLFormElement;
		expect(form.textContent).toContain('A region with that slug already exists.');
	});
});

describe('Data residency failures stay where they were made', () => {
	it('shows a failed delete on the page and opens the region drawer clean', async () => {
		const { getByRole, container } = render(ResidencyPage, {
			props: props({}, { action: 'delete', error: 'Could not delete the region. Try again.' }),
		});
		expect(said(container)).toContain('Could not delete the region. Try again.');
		await fireEvent.click(getByRole('button', { name: /new region/i }));
		const form = document.getElementById('region-form') as HTMLFormElement;
		expect(form.textContent).not.toContain('Could not delete');
	});
});

describe('a region list past the cap', () => {
	it('says the list stops at 100 regions', () => {
		const { container } = render(ResidencyPage, { props: props({ more: true }) });
		expect(said(container)).toContain('Showing the first 100 regions');
	});

	it('says nothing when every region is listed', () => {
		const { container } = render(ResidencyPage, { props: props({ more: false }) });
		expect(said(container)).not.toContain('Showing the first');
	});
});
