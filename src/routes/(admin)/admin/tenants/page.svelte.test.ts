// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// enhance keeps each form's submit handler, so a case can run the one a
// delete would run and read the question it asks.
const forms = vi.hoisted(() => ({
	submits: new Map<HTMLFormElement, (input: unknown) => unknown>(),
	confirm: vi.fn(async () => false),
}));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, submit: (input: unknown) => unknown) => {
		forms.submits.set(node, submit);
		return { destroy: () => forms.submits.delete(node) };
	},
}));
vi.mock('@lyeve-labs/ui-kit', async (original) => ({
	...(await original<typeof import('@lyeve-labs/ui-kit')>()),
	confirm: forms.confirm,
}));

import TenantsPage from './+page.svelte';

afterEach(cleanup);

function tenants(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `t${from + i}`,
		slug: `tenant-${from + i}`,
		name: `Tenant ${from + i}`,
		plan: 'example',
		enabled: true,
		archived: false,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
	}));
}

function data(overrides: Record<string, unknown> = {}) {
	// A bare array of rows is a read that answered. Anything else is passed
	// through, so a case can hand the page a failed read.
	const { tenants: rows = tenants(50), ...rest } = overrides;
	return {
		tenants: Array.isArray(rows) ? { ok: true, value: rows } : rows,
		limit: 50,
		offset: 0,
		total: 731,
		// Creating is enabled, so a pagination test is not also a gate test.
		canProvision: true,
		provisioningUrl: '',
		...rest,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) =>
	({ data: data(over) as never, form: form as never });

const ADD_ON = 'https://shop.example.com/pricing?skus=example-pro&utm_campaign=example';
const PLAN = 'https://shop.example.com/pricing?plan=larger&utm_campaign=tenants';

describe('Tenants provisioning gate', () => {
	// The list is always drawn. Only a create is refused where the plugin does
	// not enable it, so the create control is drawn only where creating is
	// enabled.
	it('draws the list where creating is not enabled', () => {
		const { container } = render(TenantsPage, { props: props({ canProvision: false }) });

		expect(container.textContent).toContain('731 tenants on this engine');
		expect(container.textContent).toContain('tenant-0');
	});

	it('draws no create control where creating is not enabled, and keeps the row actions', () => {
		const { container } = render(TenantsPage, { props: props({ canProvision: false }) });

		expect(container.textContent).not.toContain('New tenant');
		expect(container.querySelector('[aria-label^="Edit "]')).not.toBeNull();
		expect(container.querySelector('[aria-label^="Disable "]')).not.toBeNull();
		expect(container.querySelector('[aria-label^="Delete "]')).not.toBeNull();
	});

	it('says creating is not enabled rather than leaving the refusal to the form', () => {
		const { container, getByTestId } = render(TenantsPage, { props: props({ canProvision: false }) });

		expect(container.textContent).toContain('Tenant provisioning');
		expect(getByTestId('not-enabled').textContent).toContain('Not enabled on this engine.');
	});

	it('draws the create control where creating is enabled', () => {
		const { container } = render(TenantsPage, { props: props() });

		expect(container.textContent).toContain('New tenant');
		expect(container.querySelector('[aria-label^="Edit "]')).not.toBeNull();
	});

	it('offers no create action from the empty state where creating is not enabled', () => {
		const { container } = render(
			TenantsPage,
			{ props: props({ tenants: [], total: 0, canProvision: false }) },
		);

		expect(container.textContent).toContain('No tenants yet');
		expect(container.textContent).not.toContain('New tenant');
	});

	it('heads the first-run empty state one level under the page title', () => {
		const { getByRole } = render(TenantsPage, { props: props({ tenants: [], total: 0, canProvision: true }) });

		expect(getByRole('heading', { level: 2, name: 'No tenants yet' })).toBeTruthy();
	});
});

describe('Tenants plan', () => {
	it('shows the plan as stored, and a dash for a tenant with none', () => {
		const rows = [{ ...tenants(1)[0], plan: '' }, ...tenants(1, 1)];
		const { container } = render(TenantsPage, { props: props({ tenants: rows, total: 2 }) });
		const cells = [...container.querySelectorAll('tbody tr')].map((tr) => tr.querySelectorAll('td')[2]?.textContent?.trim());

		expect(cells).toEqual(['-', 'example']);
	});
});

describe('Tenants pagination', () => {
	// One server page is not the instance, so the heading states the
	// collection's count.
	it('heads the page with the count of the collection, not of the page', () => {
		const { container } = render(TenantsPage, { props: props() });

		expect(container.textContent).toContain('731 tenants on this engine');
	});

	it('states the slice on screen and the real total', () => {
		const { container } = render(TenantsPage, { props: props() });

		expect(container.textContent).toContain('1 to 50 of 731');
	});

	// A link turns the page before the page hydrates, which a callback cannot.
	it('links the next page by its offset', () => {
		const { getByRole } = render(TenantsPage, { props: props() });

		expect(getByRole('link', { name: 'Next page' }).getAttribute('href')).toBe('/admin/tenants?limit=50&offset=50');
	});

	it('marks the page an offset lands inside', () => {
		const { getByRole } = render(TenantsPage, {
			props: props({ offset: 100, tenants: tenants(50, 100) }),
		});

		expect(getByRole('link', { name: '3' }).getAttribute('aria-current')).toBe('page');
	});

	// A pager that offers a fifteenth page of a fifteen-page collection sends a
	// reader to an empty table.
	it('offers no next page on the last one', () => {
		const { container } = render(TenantsPage, {
			props: props({ offset: 700, tenants: tenants(31, 700) }),
		});

		const next = container.querySelector('[aria-label="Next page"]') as HTMLButtonElement;
		expect(next.tagName).toBe('BUTTON');
		expect(next.disabled).toBe(true);
	});

	it('says so when the engine has no tenants at all', () => {
		const { container } = render(TenantsPage, {
			props: props({ tenants: [], total: 0 }),
		});

		expect(container.textContent).toContain('No tenants yet');
	});
});

/*
 * The first-run state invites the reader to create the first tenant. Drawn
 * over a read that failed, it tells somebody whose engine is down that the
 * instance has no tenants.
 */
describe('Tenants when the list could not be read', () => {
	it('says the engine did not answer and offers no create, no pager and no count', () => {
		const { container, queryByRole } = render(TenantsPage, {
			props: props({ tenants: { ok: false, gate: { state: 'unavailable' } }, canProvision: false, total: 0 }),
		});
		expect(container.textContent).toContain('so tenants did not load. Try again in a moment.');
		expect(container.textContent).not.toContain('No tenants yet');
		expect(container.textContent).not.toContain('0 tenants on this engine');
		expect(container.textContent).not.toContain('Tenant provisioning');
		expect(queryByRole('button', { name: /new tenant/i })).toBeNull();
		expect(container.querySelector('table')).toBeNull();
	});
});

/*
 * Every form on the page shares one action result. A drawer that read it
 * whole showed a failed delete in the next New tenant form as if that form
 * had failed.
 */
describe('the tenant drawer and the failures of other actions', () => {
	const drawerText = () => document.body.querySelector('form#tenant-form')?.textContent ?? '';

	it('leaves a newly opened create drawer clean after a failed delete', async () => {
		const { container, getAllByRole } = render(TenantsPage, {
			props: { data: data() as never, form: { action: 'delete', error: 'Could not delete the tenant. Try again.' } as never },
		});
		expect(container.textContent).toContain('Could not delete the tenant. Try again.');
		await fireEvent.click(getAllByRole('button', { name: /new tenant/i })[0]);
		expect(drawerText()).not.toContain('Could not delete the tenant. Try again.');
	});

	it('shows a failed save inside the open drawer and not above the list', async () => {
		const { container, getAllByRole, rerender } = render(TenantsPage, { props: props() });
		await fireEvent.click(getAllByRole('button', { name: /new tenant/i })[0]);
		await rerender({ data: data() as never, form: { action: 'create', error: 'Could not create the tenant. Try again.' } as never });
		expect(drawerText()).toContain('Could not create the tenant. Try again.');
		const outside = container.textContent?.replace(drawerText(), '') ?? '';
		expect(outside).not.toContain('Could not create the tenant. Try again.');
	});
});

describe('the tenant delete question', () => {
	it('says the rows and users go and the stored files stay with the storage backend', async () => {
		const { getByRole } = render(TenantsPage, { props: props({ tenants: tenants(1) }) });
		const form = getByRole('button', { name: 'Delete Tenant 0' }).closest('form');
		const submit = form && forms.submits.get(form);
		expect(submit).toBeTruthy();
		await submit?.({ cancel: vi.fn() });
		expect(forms.confirm).toHaveBeenCalledWith(
			'Delete Tenant 0?',
			"All of its data and users are deleted. Its stored files stay in the storage backend until that backend's own lifecycle rules remove them.",
			{ confirmLabel: 'Delete' },
		);
	});
});

/*
 * A provisioning read that did not answer says nothing about the license, so
 * the page never draws the not-enabled card for it.
 */
describe('Tenants when provisioning could not be read', () => {
	it('says it could not tell, offers no create and makes no licensing claim', () => {
		const { container, queryByTestId, queryByRole } = render(TenantsPage, {
			props: props({ canProvision: false, provisionGate: { state: 'unavailable' } }),
		});
		expect(container.textContent).toContain('so tenant provisioning did not load');
		expect(queryByTestId('not-enabled')).toBeNull();
		expect(queryByRole('button', { name: /new tenant/i })).toBeNull();
		expect(container.textContent).toContain('tenant-0');
	});
});

describe('the tenant drawer fields', () => {
	it('suggests a slug the engine accepts and states the rule', async () => {
		const { getAllByRole } = render(TenantsPage, { props: props() });
		await fireEvent.click(getAllByRole('button', { name: /new tenant/i })[0]);
		const slug = document.body.querySelector<HTMLInputElement>('#slug');
		expect(slug?.placeholder).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
		expect(document.body.textContent).toContain('Lowercase letters, digits and underscores, starting with a letter.');
		// The plugin allows 63 characters on every database.
		expect(document.body.textContent).toContain('At most 63 characters. It cannot be changed later.');
	});

	it('says what an emptied plan is stored as', async () => {
		const { getAllByRole } = render(TenantsPage, { props: props() });
		await fireEvent.click(getAllByRole('button', { name: /^edit tenant-0|^edit tenant 0/i })[0]);
		expect(document.body.textContent).toContain('Leave it empty to use free.');
	});

	it('draws a license refusal inside the drawer', async () => {
		const { getAllByRole, rerender } = render(TenantsPage, { props: props() });
		await fireEvent.click(getAllByRole('button', { name: /new tenant/i })[0]);
		await rerender({
			data: data() as never,
			form: {
				action: 'create',
				error: 'x',
				refused: { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' },
			} as never,
		});
		const drawer = document.body.querySelector('form#tenant-form');
		expect(drawer?.querySelector('[data-testid="refusal-notice"]')).not.toBeNull();
	});
});

describe('the tenant name link on a touch screen', () => {
	// The link is 17 pixels tall. The kit's hit area extends what a finger can
	// reach without moving the row.
	it('carries the extended hit area', () => {
		const { container } = render(TenantsPage, { props: props() });
		const link = container.querySelector('a[href="/admin/tenants/t0"]');
		expect(link?.classList.contains('hit-area')).toBe(true);
		expect(link?.classList.contains('relative')).toBe(true);
	});
});

describe('Tenants refusals', () => {
	it('links where creating is bought when the license does not include it', () => {
		const { getByTestId, getByRole } = render(TenantsPage, {
			props: props({ canProvision: false, provisioningUrl: ADD_ON }),
		});

		expect(getByTestId('not-enabled').textContent).toContain('Creating tenants is not enabled on this engine.');
		const link = getByRole('link', { name: 'View the add-on' });
		expect(link.getAttribute('href')).toBe(ADD_ON);
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
	});

	it('says the provisioning route is not served, and never that the license lacks it', () => {
		const { container, queryByTestId } = render(TenantsPage, {
			props: props({ canProvision: false, provisionGate: { state: 'absent' } }),
		});

		expect(container.textContent).toContain('Creating tenants is not included in this build.');
		expect(container.textContent).not.toContain('license');
		expect(queryByTestId('not-enabled')).toBeNull();
	});

	it('offers no link where the read named none', () => {
		const { getByTestId } = render(TenantsPage, { props: props({ canProvision: false }) });

		expect(getByTestId('not-enabled').querySelector('a')).toBeNull();
	});

	// A refused create comes back while the drawer is open, as a submit's does.
	async function refusedCreate(refused: unknown) {
		const { getAllByRole, rerender } = render(TenantsPage, { props: props() });
		await fireEvent.click(getAllByRole('button', { name: /new tenant/i })[0]);
		await rerender({ data: data() as never, form: { action: 'create', error: 'refused', refused } as never });
		return document.body.querySelector('form#tenant-form') as HTMLElement;
	}

	it('shows a create refused for a missing capability with its add-on link', async () => {
		const drawer = await refusedCreate({ kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: ADD_ON });

		const notice = drawer.querySelector('[data-testid="refusal-notice"]') as HTMLElement;
		expect(notice.textContent).toContain('Not enabled on this engine');
		expect(notice.textContent).toContain('This is not enabled on this engine.');
		expect(notice.querySelector(`a[href="${ADD_ON}"]`)?.textContent?.trim()).toBe('View the add-on');
	});

	it('shows a create refused at the tenant ceiling as a limit reached with its plan link', async () => {
		const drawer = await refusedCreate({ kind: 'cap', cap: 'tenants', limit: null, current: null, upgradeUrl: PLAN });

		const notice = drawer.querySelector('[data-testid="refusal-notice"]') as HTMLElement;
		expect(notice.textContent).toContain('No more tenants');
		expect(notice.textContent).toContain("You've reached the limit for tenants. A license that allows more lifts the limit.");
		expect(notice.textContent).not.toContain('This is not enabled on this engine');
		expect(notice.querySelector(`a[href="${PLAN}"]`)?.textContent?.trim()).toBe('View the plan');
	});

	it('shows a ceiling refusal with no link without a plan button', async () => {
		const drawer = await refusedCreate({ kind: 'cap', cap: 'tenants', limit: null, current: null, upgradeUrl: '' });

		const notice = drawer.querySelector('[data-testid="refusal-notice"]') as HTMLElement;
		expect(notice.textContent).toContain('No more tenants');
		expect(notice.textContent).not.toContain('View the plan');
	});
});

describe('Tenants with none listed and no create offered', () => {
	// The notice spoke of tenants below that were not there, and the empty
	// state asked for a create the page does not offer.
	it('names no tenants below and asks for no create when provisioning is not served', () => {
		const { container } = render(TenantsPage, {
			props: props({ tenants: [], total: 0, canProvision: false, provisionGate: { state: 'absent' } }),
		});
		expect(container.textContent).toContain('Creating tenants is not included in this build.');
		expect(container.textContent).not.toContain('the tenants below');
		expect(container.textContent).toContain('No tenants yet');
		expect(container.textContent).not.toContain('Create a tenant');
	});

	it('names no tenants below when the license does not include creating them', () => {
		const { container } = render(TenantsPage, { props: props({ tenants: [], total: 0, canProvision: false }) });
		expect(container.textContent).toContain('Creating tenants is not enabled on this engine.');
		expect(container.textContent).not.toContain('the tenants below');
		expect(container.textContent).not.toContain('Create a tenant');
	});

	it('keeps the sentence about the tenants below when some are listed', () => {
		const { container } = render(TenantsPage, { props: props({ canProvision: false, provisionGate: { state: 'absent' } }) });
		expect(container.textContent).toContain('You can still edit, disable and delete the tenants below.');
	});
});
