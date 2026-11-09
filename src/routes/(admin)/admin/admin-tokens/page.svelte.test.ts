// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }), applyAction: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://admin/admin/admin-tokens') } }));

afterEach(cleanup);

const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();

function token(over: Record<string, unknown>) {
	return {
		id: 't1',
		tenant_id: 'default',
		owner_user_id: 'u1',
		owner_email: 'me@b.test',
		name: 'ci-deploy',
		display_prefix: 'abcd1234',
		grants: ['schemas:read'],
		allowed_ips: [],
		expires_at: at(30),
		created_at: at(-1),
		last_used_at: null,
		revoked_at: null,
		rotated_from: null,
		...over,
	};
}

function setup(over: Record<string, unknown> = {}, roles = ['super_admin']) {
	const data = {
		user: { id: 'u1', email: 'me@b.test', roles, tenant_id: 'default' },
		tokens: [],
		total: 0,
		limit: 50,
		offset: 0,
		grants: [{ name: 'schemas:read', description: 'Read schemas.', routes: [{ method: 'GET', pattern: '/api/admin/schemas' }] }],
		mfaEnrolled: false,
		tenants: [],
		log: null,
		adminOrigin: 'http://admin',
		...over,
	};
	// A bare array stands for a read that answered, as the load returns it.
	for (const name of ['tokens', 'grants', 'tenants'] as const) {
		const value = data[name];
		if (Array.isArray(value)) (data as Record<string, unknown>)[name] = { ok: true, value };
	}
	return render(Page, { props: { data, form: null } as never });
}

describe('admin tokens page', () => {
	it('explains what a token is for when there is none, and offers one', () => {
		const { getByText, getAllByRole } = setup();
		expect(getByText('No admin tokens yet')).toBeTruthy();
		expect(getByText(/call the admin API with only the grants you choose/)).toBeTruthy();
		expect(getAllByRole('button', { name: /New token/ }).length).toBeGreaterThan(0);
	});

	it('says the list could not be read rather than drawing it empty', () => {
		const { getByText, queryByText, queryByRole } = setup({ tokens: { ok: false, gate: { state: 'unavailable' } } });
		expect(getByText(/is unavailable, so admin tokens did not load/)).toBeTruthy();
		expect(queryByText('No admin tokens yet')).toBeNull();
		expect(queryByRole('button', { name: /New token/ })).toBeNull();
	});

	it('reads each row status, and offers only the actions that row allows', () => {
		const { getByText, getByRole, queryByRole, getAllByText } = setup({
			tokens: [
				token({ id: 'new', rotated_from: 'old', expires_at: at(3), owner_user_id: 'u1' }),
				token({ id: 'old', name: 'legacy', expires_at: at(5) }),
				token({ id: 'gone', name: 'gone', revoked_at: at(-1) }),
				token({ id: 'past', name: 'past', expires_at: at(-2) }),
				token({ id: 'theirs', name: 'theirs', owner_user_id: 'u2', owner_email: 'other@b.test' }),
			],
			total: 5,
		});
		expect(getAllByText('Active').length).toBeGreaterThan(0);
		const row = (name: string) => getByText(name).closest('tr')?.textContent ?? '';
		expect(row('legacy')).toContain('Replaced');
		expect(row('gone')).toContain('Revoked');
		expect(row('past')).toContain('Expired');
		expect(getByText('other@b.test')).toBeTruthy();
		expect(getByText(/expired 2 days ago/)).toBeTruthy();
		expect(getByRole('button', { name: 'Rotate ci-deploy' })).toBeTruthy();
		expect(queryByRole('button', { name: 'Rotate legacy' })).toBeNull();
		expect(queryByRole('button', { name: 'Rotate theirs' })).toBeNull();
		expect(getByRole('button', { name: 'Revoke theirs' })).toBeTruthy();
		expect(queryByRole('button', { name: 'Revoke gone' })).toBeNull();
		expect(queryByRole('button', { name: 'Revoke past' })).toBeNull();
		expect(getByRole('link', { name: 'Request log of gone' }).getAttribute('href')).toBe('/admin/admin-tokens?log=gone');
	});

	it('shows no owner column to an admin, who sees only their own tokens', () => {
		const { queryByRole } = setup({ tokens: [token({})], total: 1 }, ['admin']);
		expect(queryByRole('columnheader', { name: 'Owner' })).toBeNull();
	});

	it('reads a dropped row in the request log as the requests it lost', () => {
		const { getByText } = setup({
			tokens: [token({})],
			total: 1,
			log: {
				token: 't1',
				rows: [
					{ id: 'r1', token_id: 't1', tenant_id: 'default', method: '', route_pattern: 'dropped:12', status: 0, client_ip: '', created_at: at(0) },
					{ id: 'r2', token_id: 't1', tenant_id: 'default', method: 'GET', route_pattern: '/api/admin/schemas', status: 200, client_ip: '10.0.0.1', created_at: at(0) },
				],
				total: 2,
				limit: 50,
				offset: 0,
			},
		});
		expect(getByText('12 requests not logged (the log queue was full)')).toBeTruthy();
		expect(getByText('/api/admin/schemas')).toBeTruthy();
	});

	it('says in the create form that the grants could not be read', async () => {
		const failed = { ok: false, gate: { state: 'error', message: 'The grants could not be read, so no token can be created now.' } };
		const { getAllByRole } = setup({ tokens: [token({})], total: 1, grants: failed });
		await fireEvent.click(getAllByRole('button', { name: /New token/ })[0]);
		expect(document.body.textContent).toContain('The grants could not be read');
	});

	it('says in the create form that the tenants could not be read', async () => {
		const { getAllByRole } = setup({ tokens: [token({})], total: 1, tenants: { ok: false, gate: { state: 'unavailable' } } });
		await fireEvent.click(getAllByRole('button', { name: /New token/ })[0]);
		expect(document.body.textContent).toContain('Could not load the tenants');
	});

	it('offers the five statuses as chips', () => {
		const { getByRole } = setup({ tokens: [token({})], total: 1 });
		const chips = getByRole('group', { name: 'Status' });
		expect(chips.querySelectorAll('button')).toHaveLength(5);
	});

	it('opens the rotate form as the same side panel as the create form, with its fields and its warning', async () => {
		const first = setup({ tokens: [token({})], total: 1 });
		await fireEvent.click(first.getAllByRole('button', { name: /New token/ })[0]);
		// The panel's width follows its fields, so the overlay around it is what
		// tells a side panel from a centered card.
		const createPanel = first.getByRole('dialog', { name: 'New admin token' }).parentElement?.className;
		first.unmount();

		const { getByRole } = setup({ tokens: [token({})], total: 1 });
		await fireEvent.click(getByRole('button', { name: 'Rotate ci-deploy' }));
		const panel = getByRole('dialog', { name: 'Rotate ci-deploy' });
		expect(panel.parentElement?.className, 'rotate opened in another kind of overlay than create').toBe(createPanel);
		expect(panel.textContent).toContain('The old token keeps working until');
		expect(panel.textContent).toContain('Your password');
		expect(panel.querySelector('button[type="submit"][form="rotate-form"]')?.textContent?.trim()).toBe('Rotate');
	});

	it('shows a revoke refusal that arrives after the page drew, as a post from the confirmation banner does', async () => {
		const view = setup({ tokens: [token({})], total: 1 });
		expect(view.queryByText('Could not revoke the token. Try again.')).toBeNull();

		await view.rerender({ form: { action: 'revoke', error: 'Could not revoke the token. Try again.', fields: {} } });
		expect(view.getByText('Could not revoke the token. Try again.')).toBeTruthy();
	});
});
