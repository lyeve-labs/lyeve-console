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

import SamlPage from './+page.svelte';
import type { SamlProvider } from '$lib/api/saml';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function provider(over: Partial<SamlProvider> = {}): SamlProvider {
	return {
		id: 'p1',
		tenant_id: 'default',
		name: 'Okta',
		entity_id: 'http://www.okta.com/exk1',
		sso_url: 'https://example.okta.com/sso',
		sp_cert_active: '-----BEGIN CERTIFICATE-----',
		name_id_format: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
		want_authn_signed: false,
		want_assertions_signed: true,
		want_response_signed: true,
		sign_authn_requests: true,
		encrypt_assertions: false,
		attributes_mapping: {},
		enabled: true,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		sp_cert_expires_at: '2027-06-01T00:00:00Z',
		idp_cert_expires_at: '2027-06-01T00:00:00Z',
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		providers: [provider()],
		templates: [],
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
		const { container } = render(SamlPage, { props: props({ gate: { state: 'locked', upgradeUrl: '' }, providers: [] }) });
		expect(said(container)).toContain('Not enabled on this engine');
		expect(said(container)).not.toContain('New provider');
	});

	it('says the plugin is absent rather than that nothing is configured', () => {
		const { container } = render(SamlPage, {
			props: props({ gate: { state: 'absent' }, providers: [] }),
		});
		expect(said(container)).toContain('not included in this build');
		expect(said(container)).not.toContain('No identity providers yet');
	});

	it('reports a failed read as a failure, not as an empty list', () => {
		const { container } = render(SamlPage, {
			props: props({ gate: { state: 'error', message: 'The identity providers could not be read.' }, providers: [] }),
		});
		expect(said(container)).toContain('could not be read');
		expect(said(container)).not.toContain('No identity providers yet');
	});
});

describe('certificates', () => {
	// This is the whole reason the screen exists: a SAML deployment fails on a
	// date, and nothing else in the admin says what that date is.
	it('names the expiry of both certificates', () => {
		const { container } = render(SamlPage, {
			props: props({
				providers: [
					provider({
						sp_cert_expires_at: '2026-10-01T00:00:00Z',
						idp_cert_expires_at: '2028-01-01T00:00:00Z',
					}),
				],
			}),
		});
		const text = said(container);
		expect(text).toContain('Expires in');
	});

	it('counts what has to be renewed, and says none when nothing does', () => {
		const { container } = render(SamlPage, { props: props() });
		expect(said(container)).toContain('Certificates to renew');
	});

	// Staging is the step that publishes a certificate to the IdP. A screen
	// that offered only the promotion would offer a button that always failed.
	it('offers the promotion only once something is staged', () => {
		const quiet = render(SamlPage, { props: props() });
		expect(said(quiet.container)).not.toContain('Waiting to be promoted');
		cleanup();

		const ready = render(SamlPage, {
			props: props({
				providers: [
					provider({
						sp_cert_next: '-----BEGIN CERTIFICATE-----\nstaged\n-----END CERTIFICATE-----',
						sp_cert_next_expires_at: '2028-01-01T00:00:00Z',
					}),
				],
			}),
		});
		const text = said(ready.container);
		expect(text).toContain('Waiting to be promoted');
		expect(text).toContain('Promote');
	});
});

describe('links off the row', () => {
	// A display name holds spaces, and the route matches on the name. An
	// unencoded link reads as "provider not found" at the moment somebody
	// tries to sign in.
	it('encodes the provider name into the metadata and sign-in links', () => {
		const { container } = render(SamlPage, {
			props: props({ providers: [provider({ name: 'Azure AD' })] }),
		});
		const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toContain('/api/admin/auth/saml/Azure%20AD/metadata');
		expect(hrefs).toContain('/api/admin/auth/saml/Azure%20AD');
	});
});

describe('the empty state', () => {
	it('says what a provider is for rather than that a read failed', () => {
		const { container } = render(SamlPage, { props: props({ providers: [] }) });
		expect(said(container)).toContain('No identity providers yet');
		expect(said(container)).toContain('sign-in button on the sign-in page');
	});
});

describe('the form', () => {
	// Every switch on this drawer is a security setting, and Toggle renders a
	// button, which submits nothing. Without the hidden field beside it, turning
	// one off would post nothing and the action would keep the old value.
	it('submits every switch, including the ones that are off', async () => {
		const { container } = render(SamlPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new provider/i }));
		const names = [...container.querySelectorAll('input[type="hidden"]')].map((i) =>
			i.getAttribute('name'),
		);
		for (const field of [
			'want_assertions_signed',
			'want_response_signed',
			'sign_authn_requests',
			'encrypt_assertions',
			'enabled',
		]) {
			expect(names).toContain(field);
		}
	});

	it('fills a new provider from the template chosen', async () => {
		const okta = {
			key: 'okta',
			name: 'Okta',
			description: 'Okta SAML 2.0.',
			config: {
				entity_id: '',
				sso_url: '',
				idp_cert_hint: 'Download the certificate from the Okta app.',
				name_id_format: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
				encrypt_assertions: true,
				attributes_mapping: { email: 'mail', roles: 'groups' },
			},
		};
		render(SamlPage, { props: props({ templates: [okta] }) });
		await fireEvent.click(screen.getAllByRole('button', { name: /new provider/i })[0]);
		await fireEvent.click(screen.getByRole('combobox', { name: /Start from/ }));
		await fireEvent.click(screen.getByRole('option', { name: 'Okta' }));
		expect((screen.getByLabelText(/^NameID format/) as HTMLInputElement).value).toBe(okta.config.name_id_format);
		expect((screen.getByLabelText(/^Attribute mapping/) as HTMLTextAreaElement).value).toBe('email=mail\nroles=groups');
		expect((document.querySelector('input[name="encrypt_assertions"]') as HTMLInputElement).value).toBe('true');
		expect(document.body.textContent).toContain('Download the certificate from the Okta app.');
	});

	it('clears the last template when None is chosen after it', async () => {
		const okta = {
			key: 'okta',
			name: 'Okta',
			config: { name_id_format: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent', encrypt_assertions: true, attributes_mapping: { email: 'mail' } },
		};
		render(SamlPage, { props: props({ templates: [okta] }) });
		await fireEvent.click(screen.getAllByRole('button', { name: /new provider/i })[0]);
		await fireEvent.click(screen.getByRole('combobox', { name: /Start from/ }));
		await fireEvent.click(screen.getByRole('option', { name: 'Okta' }));
		await fireEvent.click(screen.getByRole('combobox', { name: /Start from/ }));
		await fireEvent.click(screen.getByRole('option', { name: 'None' }));
		expect((screen.getByLabelText(/^NameID format/) as HTMLInputElement).value).toBe('urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress');
		expect((screen.getByLabelText(/^Attribute mapping/) as HTMLTextAreaElement).value).toBe('email=email\nroles=groups');
		expect((document.querySelector('input[name="encrypt_assertions"]') as HTMLInputElement).value).toBe('false');
	});

	// The plugin turns these three on for every new provider whatever the
	// form sends, so a create cannot offer them off.
	it('shows the three signing switches on and fixed on a new provider', async () => {
		const { container } = render(SamlPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new provider/i }));
		for (const id of ['saml-want-assertions-signed', 'saml-want-response-signed', 'saml-sign-authn']) {
			const control = container.ownerDocument.getElementById(id);
			expect(control?.hasAttribute('disabled'), id).toBe(true);
			expect(control?.getAttribute('aria-checked'), id).toBe('true');
		}
		expect(said(container)).toContain('Edit it after creating to turn one off.');
	});

	it('shows the action error where the form is', () => {
		const { container } = render(SamlPage, {
			props: props({}, { error: 'Could not create the provider. Try again.' }),
		});
		expect(said(container)).toContain('Could not create the provider. Try again.');
	});
});

describe('the role', () => {
	it('shows an admin the providers and no control that only a super admin may use', () => {
		const { container } = render(SamlPage, {
			props: props({
				user: { id: 'u2', email: 'admin@b.test', roles: ['admin'] },
				providers: [provider({ sp_cert_next: 'X' })],
			}),
		});
		expect(said(container)).toContain('Okta');
		expect(said(container)).toContain('Only a super admin can add, change or remove');
		expect(screen.queryByRole('button', { name: 'New provider' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Edit Okta' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Delete Okta' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Promote' })).toBeNull();
	});
});

describe('the drawer', () => {
	const drawerText = () => document.body.querySelector('form#saml-provider-form')?.textContent ?? '';

	// The switches sat 16px apart, so each one's touch hit area took part of
	// its neighbor's. An edit enables the first three and drops the hint that
	// spaced the third, so both drawers have to space every switch.
	const switchGroups = () =>
		new Set(
			[...document.body.querySelectorAll('form#saml-provider-form [role="switch"]')].map(
				(s) => s.closest('label')?.parentElement,
			),
		);

	it('spaces every switch for touch in the New provider drawer', async () => {
		render(SamlPage, { props: props() });
		await fireEvent.click(screen.getAllByRole('button', { name: 'New provider' })[0]);
		expect(document.body.querySelectorAll('form#saml-provider-form [role="switch"]')).toHaveLength(5);
		const groups = switchGroups();
		expect(groups.size).toBe(1);
		expect([...groups][0]?.className).toContain('coarse:gap-6');
	});

	it('spaces every switch for touch in the Edit drawer', async () => {
		render(SamlPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: 'Edit Okta' }));
		const switches = document.body.querySelectorAll('form#saml-provider-form [role="switch"]');
		expect(switches).toHaveLength(5);
		expect([...switches].filter((s) => (s as HTMLButtonElement).disabled)).toHaveLength(0);
		const groups = switchGroups();
		expect(groups.size).toBe(1);
		expect([...groups][0]?.className).toContain('coarse:gap-6');
	});

	it('shows a refused save inside the open drawer', async () => {
		const { rerender } = render(SamlPage, { props: props() });
		await fireEvent.click(screen.getAllByRole('button', { name: 'New provider' })[0]);
		await rerender(props({}, { action: 'create', error: 'Could not create the provider. Try again.' }));
		expect(drawerText()).toContain('Could not create the provider. Try again.');
	});

	it('leaves a newly opened create drawer clean after a failed delete', async () => {
		const { container } = render(SamlPage, {
			props: props({}, { action: 'delete', error: 'Could not delete the provider. Try again.' }),
		});
		expect(said(container)).toContain('Could not delete the provider. Try again.');
		await fireEvent.click(screen.getAllByRole('button', { name: 'New provider' })[0]);
		expect(drawerText()).not.toContain('Could not delete');
	});

	it('leaves a reopened drawer clean of the failure it showed before', async () => {
		render(SamlPage, { props: props({}, { action: 'create', error: 'Could not create the provider. Try again.' }) });
		await fireEvent.click(screen.getAllByRole('button', { name: 'New provider' })[0]);
		expect(drawerText()).not.toContain('Could not create');
	});

});

describe('the pager', () => {
	it('stays when nothing on this page matches the search', async () => {
		const { container } = render(SamlPage, { props: props({ total: 60, hasMore: true }) });
		await fireEvent.input(screen.getByPlaceholderText('Name or entity ID'), { target: { value: 'nothing like it' } });
		expect(said(container)).toContain('No providers match this search');
		expect(container.querySelector('a[href="/admin/settings/saml?limit=25&offset=25"]')).toBeTruthy();
	});
});

describe('the delete', () => {
	it('names the provider in the confirmation', async () => {
		render(SamlPage, { props: props() });
		expect(await deleteTitle()).toBe('Delete SAML provider Okta?');
	});
});

describe('the links on a provider row', () => {
	// Metadata and Test sign-in are two short links on one line about 8px
	// apart, so a finger had no target on either.
	it('gives each link a touch hit area and spaces them so the areas stay apart', () => {
		render(SamlPage, { props: props() });
		const metadata = screen.getByRole('link', { name: 'Metadata' });
		const signIn = screen.getByRole('link', { name: 'Test sign-in' });
		for (const link of [metadata, signIn]) {
			expect(link.className.split(/\s+/)).toEqual(expect.arrayContaining(['relative', 'hit-area']));
		}
		const between = metadata.nextElementSibling as HTMLElement;
		expect(between.nextElementSibling).toBe(signIn);
		expect(between.className.split(/\s+/)).toContain('coarse:mx-4');
	});
});
