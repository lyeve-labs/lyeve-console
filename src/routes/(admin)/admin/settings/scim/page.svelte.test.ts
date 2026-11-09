// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * enhance hands each form's submit function over here, so a test can run the
 * one behind a delete and read the question it asks.
 */
const forms = vi.hoisted(() => ({ submits: [] as { node: HTMLFormElement; submit: unknown }[] }));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, submit?: unknown) => {
		forms.submits.push({ node, submit });
		return { destroy: () => {} };
	},
}));
const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

/** The title of the question the first delete form on the page asks. */
async function deleteTitle(): Promise<string> {
	const entry = forms.submits.find((f) => f.node.getAttribute('action') === '?/delete' && f.node.isConnected);
	const submit = entry?.submit as ((input: { cancel: () => void }) => Promise<unknown>) | undefined;
	if (!submit) throw new Error('no delete form registered a submit function');
	kit.confirm.mockClear();
	await submit({ cancel: () => {} });
	return String((kit.confirm.mock.calls[0] as unknown[] | undefined)?.[0] ?? '');
}

import ScimPage from './+page.svelte';
import type { ScimProvider } from '$lib/api/scim';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function provider(over: Partial<ScimProvider> = {}): ScimProvider {
	return {
		id: 'c1',
		name: 'Azure AD',
		enabled: true,
		tenant_id: 'default',
		attribute_map: {},
		deprovision_on_delete: true,
		deprovision_action: 'disable',
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		providers: [provider()],
		total: 1,
		limit: 25,
		offset: 0,
		hasMore: false,
		gate: { state: 'ok' },
		licensed: true,
		user: { id: 'u1', email: 'root@b.test', roles: ['super_admin'] },
		...over,
	} as never,
	form: form as never,
});

describe('the gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(ScimPage, {
			props: props({ gate: { state: 'locked', upgradeUrl: '' }, providers: [] }),
		});
		expect(said(container)).toContain('Not enabled on this engine');
		expect(said(container)).not.toContain('New connection');
	});

	it('says the plugin is absent rather than that nothing is connected', () => {
		const { container } = render(ScimPage, {
			props: props({ gate: { state: 'absent' }, providers: [] }),
		});
		expect(said(container)).toContain('not included in this build');
		expect(said(container)).not.toContain('No connections yet');
	});

	it('reports a failed read as a failure, not as an empty list', () => {
		const { container } = render(ScimPage, {
			props: props({ gate: { state: 'error', message: 'The connections could not be read.' }, providers: [] }),
		});
		expect(said(container)).toContain('could not be read');
		expect(said(container)).not.toContain('No connections yet');
	});
});

describe('the rows', () => {
	// This is the fact an auditor asks about, and the two fields behind it are
	// stored independently, so the row has to answer it in words.
	it('says what happens to a deprovisioned account', () => {
		const { container } = render(ScimPage, {
			props: props({ providers: [provider({ deprovision_action: 'delete' })] }),
		});
		expect(said(container)).toContain('Deleted');
	});

	it('says an account is deleted when deprovisioning is off, whatever the stored action', () => {
		const { container } = render(ScimPage, {
			props: props({
				providers: [provider({ deprovision_on_delete: false, deprovision_action: 'disable' })],
			}),
		});
		expect(said(container)).toContain('Deleted');
		expect(said(container)).not.toContain('Left alone');
	});

	// Every connection acts on a directory delete, whatever its switch says, so
	// a count of the connections whose switch is on would read as a count of
	// the ones that act.
	it('counts no connections by their removal switch', () => {
		const { container } = render(ScimPage, {
			props: props({ providers: [provider({ deprovision_on_delete: false })] }),
		});
		expect(said(container)).not.toContain('Deprovisioning accounts');
	});

	it('counts connections in the pager, the word the page uses for them', () => {
		const { container } = render(ScimPage, { props: props() });
		expect(said(container)).toContain('connections 1 to 1 of 1');
		expect(said(container)).not.toContain('providers 1 to 1');
	});

	it('offers a rotation for every connection, since the token cannot be read back', () => {
		const { getByLabelText } = render(ScimPage, { props: props() });
		expect(getByLabelText('Rotate the token for Azure AD')).toBeTruthy();
	});
});

describe('the connection form', () => {
	it('submits the deprovision switch even when it is off', async () => {
		const { container } = render(ScimPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new connection/i }));
		const names = [...container.querySelectorAll('input[type="hidden"]')].map((i) =>
			i.getAttribute('name'),
		);
		expect(names).toContain('deprovision_on_delete');
	});

	it('offers the SAML providers to link and submits the choice', async () => {
		const { container } = render(ScimPage, {
			props: props({ saml: { state: 'ok', providers: [{ id: 's1', name: 'okta' }] } }),
		});
		await fireEvent.click(screen.getByRole('button', { name: /new connection/i }));
		const dialog = container.ownerDocument.querySelector('[role="dialog"]') as HTMLElement;
		expect(said(dialog)).toContain('SAML provider');
		expect(dialog.querySelector('input[type="hidden"][name="saml_provider_id"]')).not.toBeNull();
	});

	it('says the SAML providers could not be read instead of offering none', async () => {
		const { container } = render(ScimPage, { props: props({ saml: { state: 'failed' } }) });
		await fireEvent.click(screen.getByRole('button', { name: /new connection/i }));
		const dialog = container.ownerDocument.querySelector('[role="dialog"]') as HTMLElement;
		expect(said(dialog)).toContain('Could not load the SAML providers');
		expect(dialog.querySelector('[name="saml_provider_id"]')).toBeNull();
	});

	it('offers no link when SAML is off', async () => {
		const { container } = render(ScimPage, { props: props({ saml: { state: 'off' } }) });
		await fireEvent.click(screen.getByRole('button', { name: /new connection/i }));
		const dialog = container.ownerDocument.querySelector('[role="dialog"]') as HTMLElement;
		expect(said(dialog)).not.toContain('SAML provider');
	});

	it('warns that rotating breaks provisioning until the directory is updated', async () => {
		const { container } = render(ScimPage, { props: props() });
		await fireEvent.click(screen.getByLabelText('Rotate the token for Azure AD'));
		expect(said(container)).toContain('stops working as soon as the new one is saved');
	});
});

describe('the empty state', () => {
	it('says what a connection is for rather than that a read failed', () => {
		const { container } = render(ScimPage, { props: props({ providers: [] }) });
		expect(said(container)).toContain('No connections yet');
	});
});

describe('the role', () => {
	it('shows an admin the connections and no control that only a super admin may use', () => {
		const { container } = render(ScimPage, {
			props: props({ user: { id: 'u2', email: 'admin@b.test', roles: ['admin'] } }),
		});
		expect(said(container)).toContain('Azure AD');
		expect(said(container)).toContain('Only a super admin can add or remove a connection');
		expect(screen.queryByRole('button', { name: /new connection/i })).toBeNull();
		expect(screen.queryByLabelText('Rotate the token for Azure AD')).toBeNull();
		expect(screen.queryByLabelText('Delete Azure AD')).toBeNull();
	});
});

describe('the drawers', () => {
	const createText = () => document.body.querySelector('form#scim-connection-form')?.textContent ?? '';
	const rotateText = () => document.body.querySelector('form#scim-rotate-form')?.textContent ?? '';

	it('shows a refused create inside the open drawer', async () => {
		const { rerender } = render(ScimPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new connection/i }));
		await rerender(props({}, { action: 'create', error: 'Could not create the connection. Try again.' }));
		expect(createText()).toContain('Could not create the connection. Try again.');
	});

	it('shows a refused rotation inside the open drawer', async () => {
		const { rerender } = render(ScimPage, { props: props() });
		await fireEvent.click(screen.getByLabelText('Rotate the token for Azure AD'));
		await rerender(props({}, { action: 'rotate', error: 'Could not rotate the token. Try again.' }));
		expect(rotateText()).toContain('Could not rotate the token. Try again.');
	});

	it('leaves a newly opened create drawer clean after a failed delete', async () => {
		const { container } = render(ScimPage, {
			props: props({}, { action: 'delete', error: 'Could not delete the connection. Try again.' }),
		});
		expect(said(container)).toContain('Could not delete the connection. Try again.');
		await fireEvent.click(screen.getByRole('button', { name: /new connection/i }));
		expect(createText()).not.toContain('Could not delete');
	});

	it('keeps a failed create out of the rotate drawer, and a failed rotation out of the create drawer', async () => {
		const { rerender } = render(ScimPage, { props: props() });
		await fireEvent.click(screen.getByLabelText('Rotate the token for Azure AD'));
		await rerender(props({}, { action: 'create', error: 'Could not create the connection. Try again.' }));
		expect(rotateText()).not.toContain('Could not create');
		cleanup();

		const second = render(ScimPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new connection/i }));
		await second.rerender(props({}, { action: 'rotate', error: 'Could not rotate the token. Try again.' }));
		expect(createText()).not.toContain('Could not rotate');
	});

	it('offers the deprovision choice as radios that say deleting cannot be undone', async () => {
		render(ScimPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new connection/i }));
		const radios = [...document.body.querySelectorAll<HTMLInputElement>('input[type="radio"][name="deprovision_action"]')];
		expect(radios.map((r) => r.value)).toEqual(['disable', 'delete']);
		expect(document.body.textContent).toContain('This cannot be undone.');
	});
});

describe('the search', () => {
	it('narrows the page and keeps the pager when nothing matches', async () => {
		const { container } = render(ScimPage, {
			props: props({ providers: [provider(), provider({ id: 'c2', name: 'Okta' })], total: 40, hasMore: true }),
		});
		await fireEvent.input(screen.getByPlaceholderText('Connection name on this page'), { target: { value: 'okta' } });
		expect(said(container)).toContain('Okta');
		expect(said(container)).not.toContain('Azure AD');
		await fireEvent.input(screen.getByPlaceholderText('Connection name on this page'), { target: { value: 'nothing like it' } });
		expect(said(container)).toContain('No connections match this search');
		expect(container.querySelector('a[href="/admin/settings/scim?limit=25&offset=25"]')).toBeTruthy();
	});
});

describe('the delete', () => {
	it('names the connection in the confirmation', async () => {
		render(ScimPage, { props: props() });
		expect(await deleteTitle()).toBe('Delete SCIM connection Azure AD?');
	});
});

// The plugin acts on every removal and drops the field, so the form cannot
// offer to turn that off.
describe('the removal switch', () => {
	it('shows acting on removals as on and fixed, with the reason', async () => {
		const { container } = render(ScimPage, { props: props({}) });
		await fireEvent.click(screen.getAllByRole('button', { name: /new connection/i })[0]);
		const control = container.ownerDocument.getElementById('scim-deprovision');
		expect(control?.hasAttribute('disabled')).toBe(true);
		expect(control?.getAttribute('aria-checked')).toBe('true');
		expect(container.ownerDocument.body.textContent).toContain('Always on.');
		const field = container.ownerDocument.querySelector<HTMLInputElement>('input[name="deprovision_on_delete"]');
		expect(field?.value).toBe('true');
	});
	// Okta and Entra remove a person by marking them inactive, and the plugin
	// disables the account on that whatever the switch or the action say.
	it('says the switch governs a delete only, and an inactive person is always disabled', async () => {
		render(ScimPage, { props: props({}) });
		await fireEvent.click(screen.getAllByRole('button', { name: /new connection/i })[0]);
		const hint = document.body.textContent ?? '';
		expect(hint).toContain('When a directory deletes a person');
		expect(hint).toContain('mark the person inactive');
		expect(hint).toContain('always disables the account');
	});
});
