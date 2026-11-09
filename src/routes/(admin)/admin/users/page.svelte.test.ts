// @vitest-environment jsdom
import { render, cleanup, fireEvent, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
	invalidateAll: vi.fn(async () => {}),
}));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import UsersPage from './+page.svelte';

afterEach(cleanup);

function accounts(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `u${from + i}`,
		email: `user${from + i}@b.co`,
		roles: ['editor'],
		tenant_id: 't1',
		disabled: false,
		created_at: '2026-01-01T00:00:00Z',
	}));
}

/** Load data as the load returns it. A bare array stands for a read that answered. */
function data(overrides: Record<string, unknown> = {}) {
	const answered = (value: unknown) => (Array.isArray(value) ? { ok: true, value } : value);
	const merged: Record<string, unknown> = { users: accounts(25), limit: 25, offset: 0, hasMore: false, tenants: [], ...overrides };
	return { ...merged, users: answered(merged.users), tenants: answered(merged.tenants) };
}

const props = (over: Record<string, unknown> = {}) =>
	({ data: data(over) as never, form: null as never });

function pager(container: HTMLElement, label: string): HTMLElement | undefined {
	// The kit's pager draws its steps as an arrow and names them in aria-label,
	// so a step is found by its accessible name and not by the text it carries.
	return [...container.querySelectorAll('a, button')].find(
		(el) => el.textContent?.includes(label) || el.getAttribute('aria-label')?.includes(label)
	) as HTMLElement | undefined;
}

/*
 * `toLocale*` with no locale reads the same row differently in two browsers,
 * and differently again between the server render and the hydrated one. So
 * the Created column formats its date through $lib/format.
 */
describe('Users dates', () => {
	it('renders the created day as an ISO day, whatever zone the reader is in', () => {
		const { container } = render(UsersPage, { props: props({ users: accounts(1) }) });

		expect(container.textContent).toContain('2026-01-01');
	});

	it('names the gap rather than printing an invalid date', () => {
		const rows = accounts(1);
		rows[0].created_at = '';
		const { container } = render(UsersPage, { props: props({ users: rows }) });

		expect(container.textContent).toContain('Unknown');
		expect(container.textContent).not.toContain('Invalid Date');
	});
});

/*
 * The create form opens in a modal with a scrim and a close control, so it
 * reads as something that is open rather than as part of the page.
 */
describe('Users create', () => {
	it('keeps the form out of the page until it is asked for', () => {
		const { container } = render(UsersPage, { props: props() });

		expect(container.querySelector('[role="dialog"]')).toBeNull();
	});

	it('opens the form as a dialog', async () => {
		const { container, getAllByRole } = render(UsersPage, { props: props() });

		await fireEvent.click(getAllByRole('button', { name: /new user/i })[0]);

		const dialog = container.querySelector('[role="dialog"]');
		expect(dialog).toBeTruthy();
		expect(dialog?.textContent).toContain('New user');
	});

	it('gives the dialog a close control of its own', async () => {
		const { getAllByRole, getByRole } = render(UsersPage, { props: props() });

		await fireEvent.click(getAllByRole('button', { name: /new user/i })[0]);

		expect(getByRole('button', { name: /close/i })).toBeTruthy();
	});

	// An install may set its own minimum and drop the complexity rule, and the
	// console cannot read either, so the hint gives the default as a default.
	it('names the engine\'s policy and gives its rules only as the default', async () => {
		const { container, getAllByRole } = render(UsersPage, { props: props() });

		await fireEvent.click(getAllByRole('button', { name: /new user/i })[0]);

		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain(
			'The password policy applies. By default it needs at least 12 characters, with upper case, lower case and a digit, and no common passwords.'
		);
	});

	it('starts a new account with the reading role, never editor', async () => {
		const { container, getAllByRole } = render(UsersPage, { props: props() });

		await fireEvent.click(getAllByRole('button', { name: /new user/i })[0]);

		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		const ticked = [...dialog.querySelectorAll<HTMLInputElement>('input[name="roles"]')]
			.filter((el) => el.checked)
			.map((el) => el.value);
		expect(ticked).toEqual(['viewer']);
	});

	// The roles offered here and on the API key page are the same list.
	it('offers every role the engine issues', async () => {
		const { container, getAllByRole } = render(UsersPage, { props: props() });

		await fireEvent.click(getAllByRole('button', { name: /new user/i })[0]);

		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		const roles = [...dialog.querySelectorAll('input[name="roles"]')].map(
			(el) => (el as HTMLInputElement).value
		);
		expect(roles).toEqual(['viewer', 'editor', 'admin', 'super_admin']);
	});
});

/**
 * A list that ends at the engine's default page with no way forward makes an
 * instance with more accounts than that look complete.
 */
describe('Users pagination', () => {
	it('offers the next page as a link carrying the advanced offset', () => {
		const { container } = render(UsersPage, { props: props({ hasMore: true }) });

		expect(pager(container, 'Next')?.getAttribute('href')).toBe(
			'/admin/users?limit=25&offset=25'
		);
	});

	it('links back once past the first page', () => {
		const { container } = render(UsersPage, {
			props: props({ offset: 50, users: accounts(25, 50), hasMore: true }),
		});

		expect(pager(container, 'Prev')?.getAttribute('href')).toBe(
			'/admin/users?limit=25&offset=25'
		);
	});

	// The endpoint sends no row count, so the pager states the slice it is
	// showing rather than a total nobody measured.
	it('names the accounts on screen rather than a total it cannot know', () => {
		const { container } = render(UsersPage, {
			props: props({ offset: 25, users: accounts(25, 25), hasMore: true }),
		});

		expect(container.textContent).toContain('accounts 26 to 50');
	});

	it('renders no pager at all when one page holds everything', () => {
		const { container } = render(UsersPage, { props: props({ users: accounts(3) }) });

		expect(pager(container, 'Next')).toBeUndefined();
		expect(pager(container, 'Prev')).toBeUndefined();
	});

	it('offers no forward link on the last page', () => {
		const { container } = render(UsersPage, {
			props: props({ offset: 25, users: accounts(10, 25), hasMore: false }),
		});

		expect(pager(container, 'Next')?.getAttribute('href')).toBeNull();
	});
});

/*
 * The browser's own bubble is unstyled, shows one field at a time, is gone on
 * the next click and is never announced. The action answers per field and the
 * message reaches the control that was rejected, which is what carries
 * aria-invalid and the paragraph its aria-describedby points at.
 */
describe('Users form errors', () => {
	const rejected = {
		action: 'create',
		error: 'Check the highlighted fields.',
		fields: { email: 'Enter an email address.', password: 'Password must be at least 12 characters' },
	};

	// The failure comes back while the drawer is open, as a submit's does.
	async function openCreate(form: unknown) {
		const rendered = render(UsersPage, {
			props: { data: data() as never, form: null as never },
		});
		await fireEvent.click(rendered.getAllByRole('button', { name: /new user/i })[0]);
		await rendered.rerender({ data: data() as never, form: form as never });
		return rendered;
	}

	it('marks the rejected control invalid', async () => {
		const { container } = await openCreate(rejected);

		const email = container.querySelector('#new-email');
		expect(email?.getAttribute('aria-invalid')).toBe('true');
	});

	it('points the control at the message that explains it', async () => {
		const { container } = await openCreate(rejected);

		const email = container.querySelector('#new-email');
		const describedBy = email?.getAttribute('aria-describedby');
		expect(describedBy).toBe('new-email-error');
		expect(container.querySelector(`#${describedBy}`)?.textContent).toBe('Enter an email address.');
	});

	it('puts the message on each rejected control rather than one banner', async () => {
		const { container } = await openCreate(rejected);

		expect(container.querySelector('#new-pw')?.getAttribute('aria-invalid')).toBe('true');
		expect(container.querySelector('#new-pw-error')?.textContent).toBe(
			'Password must be at least 12 characters'
		);
	});

	// The region is mounted before there is anything in it: an element carrying
	// role="alert" that was not in the tree when the failure happened is
	// announced inconsistently.
	it('announces the rejection through a live region', async () => {
		const { container } = await openCreate(rejected);

		const region = container.querySelector('[role="dialog"] [aria-live="assertive"]');
		expect(region).toBeTruthy();
		expect(region?.textContent).toContain('2 fields need attention.');
	});

	it('leaves the controls unmarked when the action did not reject them', async () => {
		const { container } = await openCreate(null);

		expect(container.querySelector('#new-email')?.hasAttribute('aria-invalid')).toBe(false);
	});
});

/*
 * A super admin sets a password from the row. The engine judges it and ends
 * every session the account held. The drawer states no rule of its own and
 * shows the refusal on the control.
 */
describe('Users set password', () => {
	const refused = {
		action: 'setPassword',
		error: 'Check the highlighted field.',
		fields: { new_password: 'password must be at least 12 characters' },
	};

	async function openSetPassword(form: unknown) {
		const rendered = render(UsersPage, {
			props: { data: data({ users: accounts(1) }) as never, form: null as never },
		});
		await fireEvent.click(rendered.getByRole('button', { name: /set password for user0@b\.co/i }));
		await rendered.rerender({ data: data({ users: accounts(1) }) as never, form: form as never });
		return rendered;
	}

	it('offers the action on every row', () => {
		const { getAllByRole } = render(UsersPage, { props: props({ users: accounts(3) }) });

		expect(getAllByRole('button', { name: /^set password for /i })).toHaveLength(3);
	});

	it('opens a drawer that names the account and posts to setPassword', async () => {
		const { container } = await openSetPassword(null);

		const dialog = container.querySelector('[role="dialog"]');
		expect(dialog?.textContent).toContain('Set password for user0@b.co');
		expect(dialog?.textContent).toContain('signs the user out of every session');
		const form = dialog?.querySelector('form');
		expect(form?.getAttribute('action')).toBe('?/setPassword');
		expect((form?.querySelector('input[name="id"]') as HTMLInputElement).value).toBe('u0');
		expect(form?.querySelector('input[name="new_password"]')).toBeTruthy();
	});

	it('offers to remove the account passkeys, checked, in the form it posts', async () => {
		const { container } = await openSetPassword(null);

		const dialog = container.ownerDocument.querySelector('[role="dialog"]') as HTMLElement;
		const box = within(dialog).getByRole('checkbox', { name: "Remove this account's passkeys" }) as HTMLInputElement;
		expect(box.checked).toBe(true);
		expect(box.name).toBe('remove_passkeys');
		expect(box.closest('form')?.getAttribute('action')).toBe('?/setPassword');
		expect(dialog.textContent).toContain('Recommended. They can add their passkeys again after signing in.');
	});

	it('shows the engine refusal on the password control', async () => {
		const { container } = await openSetPassword(refused);

		const control = container.querySelector('#set-pw');
		expect(control?.getAttribute('aria-invalid')).toBe('true');
		expect(container.querySelector('#set-pw-error')?.textContent).toBe(
			'password must be at least 12 characters'
		);
	});

	// The two drawers each carry a password control. A refusal from one must
	// not mark the other, so the fields are named apart.
	it('leaves the create form unmarked by a set password refusal', async () => {
		const { getAllByRole, container } = render(UsersPage, {
			props: { data: data() as never, form: refused as never },
		});
		await fireEvent.click(getAllByRole('button', { name: /new user/i })[0]);

		expect(container.querySelector('#new-pw')?.hasAttribute('aria-invalid')).toBe(false);
	});

	it('leaves the control unmarked when nothing was refused', async () => {
		const { container } = await openSetPassword(null);

		expect(container.querySelector('#set-pw')?.hasAttribute('aria-invalid')).toBe(false);
	});
});

// Every action answers into one `form`. A failure from one action must not
// read as another form's failure.
describe('Users failures stay with their own action', () => {
	const deleteFailed = { action: 'delete', error: 'Could not delete the user. Try again.' };

	it('shows a failed delete on the page and never inside the next New user drawer', async () => {
		const { getAllByRole, container } = render(UsersPage, {
			props: { data: data({ users: accounts(1) }) as never, form: deleteFailed as never },
		});
		expect(container.textContent).toContain('Could not delete the user. Try again.');
		await fireEvent.click(getAllByRole('button', { name: /new user/i })[0]);
		const dialog = container.ownerDocument.querySelector('[role="dialog"]');
		expect(dialog?.textContent).not.toContain('Could not delete the user. Try again.');
	});

	it('keeps a failed password set out of the roles drawer', async () => {
		const failed = { action: 'setPassword', error: 'Could not set the password. Try again.' };
		const { getByRole, container } = render(UsersPage, {
			props: { data: data({ users: accounts(1) }) as never, form: failed as never },
		});
		await fireEvent.click(getByRole('button', { name: /edit roles for user0@b\.co/i }));
		const dialog = container.ownerDocument.querySelector('[role="dialog"]');
		expect(dialog?.textContent).not.toContain('Could not set the password. Try again.');
	});

	it('drops a create failure from an earlier opening of the drawer', async () => {
		const failed = { action: 'create', error: 'Could not create the user. Try again.' };
		const { getAllByRole, container } = render(UsersPage, {
			props: { data: data() as never, form: failed as never },
		});
		await fireEvent.click(getAllByRole('button', { name: /new user/i })[0]);
		const dialog = container.ownerDocument.querySelector('[role="dialog"]');
		expect(dialog?.textContent).not.toContain('Could not create the user. Try again.');
	});
});

describe('Users create, several tenants', () => {
	it('asks which tenant the account belongs to only when there are several', async () => {
		const one = render(UsersPage, { props: props({ tenants: [{ slug: 'acme', name: 'Acme' }] }) });
		await fireEvent.click(one.getAllByRole('button', { name: /new user/i })[0]);
		expect(one.container.ownerDocument.querySelector('#new-tenant')).toBeNull();
		one.unmount();

		const two = render(UsersPage, { props: props({ tenants: [{ slug: 'acme', name: 'Acme' }, { slug: 'globex', name: 'Globex' }] }) });
		await fireEvent.click(two.getAllByRole('button', { name: /new user/i })[0]);
		expect(two.container.ownerDocument.querySelector('#new-tenant')).toBeTruthy();
		expect(two.container.ownerDocument.querySelector('input[name="tenant_required"]')).toBeTruthy();
	});
});


describe('Users read failures', () => {
	it('says the accounts could not be read instead of inviting a first account', () => {
		const failed = { ok: false, gate: { state: 'error', message: 'Could not load the accounts.' } };
		const { container, queryByRole } = render(UsersPage, { props: props({ users: failed }) });

		expect(container.textContent).toContain('Could not load the accounts.');
		expect(container.textContent).not.toContain('No users yet');
		expect(queryByRole('button', { name: /new user/i })).toBeNull();
	});

	it('says in the create form that the tenants could not be read', async () => {
		const failed = { ok: false, gate: { state: 'unavailable' } };
		const { getAllByRole, container } = render(UsersPage, { props: props({ tenants: failed }) });
		await fireEvent.click(getAllByRole('button', { name: /new user/i })[0]);

		expect(container.ownerDocument.body.textContent).toContain('Could not load the tenants');
	});
});

describe('Users role filter', () => {
	it('offers the roles as chips', () => {
		const { getByRole } = render(UsersPage, { props: props() });

		expect(getByRole('group', { name: 'Role' })).toBeTruthy();
		expect(getByRole('button', { name: 'super_admin' })).toBeTruthy();
	});
});

describe('Users admin seat refusal', () => {
	// The refusal comes back while the drawer is open, as a submit's does.
	it('shows the seat count and a button to where more seats are bought', async () => {
		const link = 'https://shop.example.com/pricing?plan=basic&utm_source=admin&utm_medium=product&utm_campaign=admin.seats';
		const refused = { kind: 'cap', cap: 'admin.seats', limit: 3, current: 3, upgradeUrl: link };
		const rendered = render(UsersPage, { props: { data: data() as never, form: null as never } });
		await fireEvent.click(rendered.getAllByRole('button', { name: /new user/i })[0]);
		await rendered.rerender({
			data: data() as never,
			form: { action: 'create', error: 'Every admin seat is taken.', refused } as never,
		});

		const dialog = within(rendered.container.ownerDocument.body.querySelector('[role="dialog"]') as HTMLElement);
		expect(dialog.getByText(/You're using 3 of 3,/)).toBeTruthy();
		expect(dialog.getByText(/A license that allows more lifts the limit\./)).toBeTruthy();
		const more = dialog.getByRole('link', { name: 'View the plan' });
		expect(more.getAttribute('href')).toBe(link);
		expect(more.getAttribute('target')).toBe('_blank');
	});
});

describe('accounts a tenant identity provider created', () => {
	it('marks them in words a tenant admin reads, and only them', () => {
		const [local, password] = accounts(2);
		const { getAllByRole } = render(UsersPage, {
			props: props({ users: [{ ...local, tenant_local: true }, { ...password, tenant_local: false }] }),
		});

		const rows = getAllByRole('row').slice(1);
		expect(within(rows[0]).queryByText('Signs in through your identity provider')).not.toBeNull();
		expect(within(rows[1]).queryByText('Signs in through your identity provider')).toBeNull();
	});

	it('shows the address the account signs in with', () => {
		const [local] = accounts(1);
		const { getAllByRole } = render(UsersPage, {
			props: props({ users: [{ ...local, email: 'pat@acme.example', tenant_local: true }] }),
		});

		expect(within(getAllByRole('row')[1]).queryByText('pat@acme.example')).not.toBeNull();
	});
});

