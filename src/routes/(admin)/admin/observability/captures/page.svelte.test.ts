// @vitest-environment jsdom
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import CapturesPage from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const capture = {
	id: 'c1',
	captured_at: '2026-10-06T10:00:00Z',
	method: 'POST',
	url: 'http://localhost:3002/api/v1/content/orders',
	status_code: 201,
	duration_ms: 12.5,
	ttl_seconds: 86400,
};

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		captures: [capture],
		total: 1,
		limit: 50,
		offset: 0,
		hasMore: false,
		superAdmin: false,
		licensed: true,
		gate: { state: 'ok' },
		...over,
	} as never,
	form: form as never,
});

describe('the license', () => {
	it('says what is not included when the plugin answers unlicensed', () => {
		const { container } = render(CapturesPage, { props: props({ licensed: false }) });
		expect(said(container)).toContain('Capture rules and replay sets are not included');
	});

	it('offers no new replay set the license refuses', () => {
		const { getAllByRole } = render(CapturesPage, { props: props({ licensed: false }) });
		expect((getAllByRole('button', { name: /New replay set/ })[0] as HTMLButtonElement).disabled).toBe(true);
	});
});

describe('replay sets', () => {
	it('offers a new set only once a capture is selected', async () => {
		render(CapturesPage, { props: props() });
		const make = screen.getByRole('button', { name: /New replay set/ }) as HTMLButtonElement;
		expect(make.disabled).toBe(true);
		await fireEvent.click(screen.getByLabelText(/Select POST/));
		expect((screen.getByRole('button', { name: /New replay set from 1/ }) as HTMLButtonElement).disabled).toBe(false);
	});
});

describe('the gate', () => {
	it('says the plugin is absent rather than showing an empty list', () => {
		const { container } = render(CapturesPage, { props: props({ gate: { state: 'absent' }, captures: [] }) });
		expect(said(container)).toContain('not included in this build');
		expect(said(container)).not.toContain('No captures yet');
	});
});

describe('a failed set save', () => {
	// The message belongs to the drawer it came from, so the page behind the
	// drawer stays quiet about it.
	it('is not said on the page behind the drawer', () => {
		const { container } = render(CapturesPage, { props: props({}, { error: 'Enter a name for the set.', drawer: 'set' }) });
		expect(said(container)).not.toContain('Enter a name for the set.');
	});

	it('says a failed create from outside a drawer on the page', () => {
		const { container } = render(CapturesPage, { props: props({}, { error: 'Could not create the replay set. Try again.' }) });
		expect(said(container)).toContain('Could not create the replay set. Try again.');
	});
});

describe("a super admin's list", () => {
	// The plugin applies no tenant filter to a super admin's read, so the list
	// and its total cover every tenant.
	it('says it covers every tenant and names each row\'s tenant', () => {
		const { container } = render(CapturesPage, {
			props: props({ superAdmin: true, captures: [{ ...capture, tenant_id: 'acme' }] }),
		});
		expect(said(container)).toContain('requests every tenant sent');
		expect(said(container)).toContain('Captures from every tenant');
		expect(said(container)).toContain('A replay set can only include captures from your own tenant.');
		expect(screen.getByRole('columnheader', { name: 'Tenant' })).toBeTruthy();
		expect(screen.getByRole('cell', { name: 'acme' })).toBeTruthy();
	});

	// The plugin refuses a set that names another tenant's capture, so that
	// row cannot be picked, and its label says why.
	it("cannot pick another tenant's capture for a replay set", () => {
		render(CapturesPage, {
			props: props({
				superAdmin: true,
				ownTenant: 'acme',
				captures: [
					{ ...capture, tenant_id: 'acme' },
					{ ...capture, id: 'c2', tenant_id: 'globex' },
				],
			}),
		});
		const own = screen.getByRole('checkbox', { name: 'Select POST /api/v1/content/orders' }) as HTMLInputElement;
		const other = screen.getByRole('checkbox', {
			name: 'POST /api/v1/content/orders is from another tenant and cannot be added to a replay set',
		}) as HTMLInputElement;
		expect(own.disabled).toBe(false);
		expect(other.disabled).toBe(true);
	});

	it("keeps a tenant admin's list to the tenant", () => {
		const { container } = render(CapturesPage, { props: props() });
		expect(said(container)).toContain('requests this tenant sent');
		expect(screen.queryByRole('columnheader', { name: 'Tenant' })).toBeNull();
	});
});

describe('the new replay set button', () => {
	it('carries the Plus every New button carries', async () => {
		render(CapturesPage, { props: props() });
		const button = screen.getByRole('button', { name: /New replay set/ });
		expect(button.querySelector('svg.lucide-plus')).toBeTruthy();
	});
});
