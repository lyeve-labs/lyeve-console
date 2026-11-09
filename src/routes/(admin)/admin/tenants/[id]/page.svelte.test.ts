// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import TenantPage from './+page.svelte';

afterEach(cleanup);

const tenant = {
	id: 't1',
	slug: 'acme',
	name: 'Acme',
	plan: 'example',
	enabled: true,
	archived: false,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z',
};

const member = { id: 'u2', email: 'ada@example.com', disabled: false, home: false, roles: ['editor'] };

function props(over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: {
			tenant,
			choices: { ok: true, value: [{ name: 'flow', available: true }] },
			members: { ok: true, value: [member] },
			homeSuperAdmins: [],
			memberTotal: 1,
			limit: 50,
			offset: 0,
			user: { roles: ['super_admin'] },
			...over,
		},
		form,
	} as never;
}

const drawerText = () => document.body.querySelector('form#member-form')?.textContent ?? '';

describe('tenant detail reads that failed', () => {
	it('says the members could not be read and offers no new member', () => {
		const { container } = render(TenantPage, { props: props({ members: { ok: false, gate: { state: 'unavailable' } } }) });
		expect(container.textContent).toContain("so this tenant's members did not load");
		expect(container.textContent).not.toContain('No members');
		expect(screen.queryByRole('button', { name: /new member/i })).toBeNull();
	});
});

/*
 * A grant and a removal share one action result. The member drawer showed a
 * failed removal in the next form opened as if that form had failed.
 */
describe('the member drawer and the failures of other actions', () => {
	it('leaves a newly opened member drawer clean after a failed removal', async () => {
		const { container } = render(TenantPage, {
			props: props({}, { action: 'revoke', memberError: 'Could not remove the membership. Try again.' }),
		});
		expect(container.textContent).toContain('Could not remove the membership. Try again.');
		await fireEvent.click(screen.getByRole('button', { name: /new member/i }));
		expect(drawerText()).not.toContain('Could not remove the membership');
	});

	it('starts a new member with the reading role', async () => {
		render(TenantPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new member/i }));
		const form = document.body.querySelector('form#member-form') as HTMLFormElement;
		const ticked = [...form.querySelectorAll<HTMLInputElement>('input[name="roles"]')].filter((i) => i.checked).map((i) => i.value);
		expect(ticked).toEqual(['viewer']);
	});

	it('shows a failed grant inside the open drawer, first in its form', async () => {
		const { rerender } = render(TenantPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new member/i }));
		await rerender(props({}, { action: 'grant', memberError: 'Choose at least one role.', fields: { roles: 'Choose at least one role.' } }));
		const form = document.body.querySelector('form#member-form') as HTMLFormElement;
		expect(form.firstElementChild?.textContent).toContain('Choose at least one role.');
	});
});

describe('what this tenant may use', () => {
	it('picks the plugins from a searchable list and posts each one kept', () => {
		const { container } = render(TenantPage, {
			props: props({
				choices: {
					ok: true,
					value: [
						{ name: 'flow', available: true },
						{ name: 'search', available: false },
						{ name: 'ai', available: true },
					],
				},
			}),
		});
		expect(container.querySelectorAll('input[type="checkbox"][name="available"]')).toHaveLength(0);
		expect(container.querySelector('#tenant-features')).toBeTruthy();
		const kept = [...container.querySelectorAll('input[type="hidden"][name="available"]')].map((i) => (i as HTMLInputElement).value);
		expect(kept.sort()).toEqual(['ai', 'flow']);
		const offered = [...container.querySelectorAll('input[name="offered"]')].map((i) => (i as HTMLInputElement).value);
		expect(offered.sort()).toEqual(['ai', 'flow', 'search']);
	});
});

describe('the members of a large tenant', () => {
	it('pages the members rather than stopping at the first page', () => {
		const members = Array.from({ length: 50 }, (_, i) => ({ ...member, id: `u${i}`, email: `m${i}@example.com` }));
		render(TenantPage, { props: props({ members: { ok: true, value: members }, memberTotal: 230 }) });
		expect(screen.getByRole('link', { name: 'Next page' }).getAttribute('href')).toBe('/admin/tenants/t1?limit=50&offset=50');
		expect(document.body.textContent).toContain('of 230');
	});
});

/*
 * The members pager reruns the load, which hands back an equal choice list as
 * a new object. Reseeding the picks from it undid a change not yet saved.
 */
describe('unsaved plugin picks', () => {
	const choices = () => ({
		ok: true,
		value: [
			{ name: 'flow', available: true },
			{ name: 'ai', available: true },
		],
	});
	const kept = () =>
		[...document.querySelectorAll('input[type="hidden"][name="available"]')].map((i) => (i as HTMLInputElement).value);

	it('survive a turn of the members page', async () => {
		const { rerender } = render(TenantPage, { props: props({ choices: choices() }) });
		await fireEvent.click(screen.getByRole('button', { name: 'Remove flow' }));
		expect(kept()).toEqual(['ai']);
		await rerender(props({ choices: choices(), offset: 50 }));
		expect(kept()).toEqual(['ai']);
	});

	it('follow what the engine stores once it changes', async () => {
		const { rerender } = render(TenantPage, { props: props({ choices: choices() }) });
		await fireEvent.click(screen.getByRole('button', { name: 'Remove flow' }));
		await rerender(
			props({
				choices: {
					ok: true,
					value: [
						{ name: 'flow', available: true },
						{ name: 'ai', available: false },
					],
				},
			}),
		);
		expect(kept()).toEqual(['flow']);
	});
});

/*
 * The engine signs a home tenant in with the roles its home membership sets.
 * A save there either ended an account's super admin at its next sign-in or
 * held it past a removal on the Users page.
 */
describe('the home row of a super admin', () => {
	const root = { id: 'u1', email: 'root@example.com', disabled: false, home: true, roles: ['super_admin', 'admin'] };
	const lost = { id: 'u3', email: 'lost@example.com', disabled: false, home: true, roles: ['editor'] };
	const edit = (email: string) => screen.getByRole('button', { name: `Edit roles for ${email}` }) as HTMLButtonElement;

	it('is not edited here and names the Users page', () => {
		const { container } = render(TenantPage, { props: props({ members: { ok: true, value: [root] } }) });
		expect(edit('root@example.com').disabled).toBe(true);
		expect(container.textContent).toContain("A super admin's home roles are managed on the Users page.");
	});

	it('warns when the home membership already leaves super admin out', () => {
		const { container } = render(TenantPage, {
			props: props({ members: { ok: true, value: [lost, member] }, homeSuperAdmins: ['u3'] }),
		});
		expect(container.textContent).toContain('lost@example.com signs in here without super admin');
		expect(edit('lost@example.com').disabled).toBe(true);
	});

	it('says the accounts could not be read where the warning would be', () => {
		const { container } = render(TenantPage, {
			props: props({ members: { ok: true, value: [lost] }, homeSuperAdmins: null }),
		});
		expect(container.textContent).toContain(
			'Could not load the accounts. Reload the page to see whether a home member signs in here without super admin.',
		);
	});

	// The warning says no page changes that membership, so the row must not
	// send the reader to the Users page for it.
	it('does not send the reader to the Users page for a home row that lost super admin', () => {
		const { container } = render(TenantPage, {
			props: props({ members: { ok: true, value: [lost] }, homeSuperAdmins: ['u3'] }),
		});
		const row = edit('lost@example.com').closest('tr') as HTMLElement;
		expect(row.textContent).not.toContain('managed on the Users page');
		expect(row.textContent).toContain('This home membership cannot be changed here or on the Users page.');
		expect(container.textContent).not.toContain('managed on the Users page');
	});

	it('leaves any other account editable, and posts no role it was not given', async () => {
		const { container } = render(TenantPage, { props: props() });
		expect(container.textContent).not.toContain('signs in here without super admin');
		await fireEvent.click(edit('ada@example.com'));
		const form = document.body.querySelector<HTMLFormElement>('form#member-form');
		expect(new FormData(form!).getAll('roles')).not.toContain('super_admin');
	});
});

describe('a tenant with no members', () => {
	it('offers the action that adds one', () => {
		const { container } = render(TenantPage, { props: props({ members: { ok: true, value: [] }, memberTotal: 0 }) });
		expect(container.textContent).toContain('No members');
		expect(screen.getAllByRole('button', { name: /new member/i }).length).toBe(2);
	});
});
