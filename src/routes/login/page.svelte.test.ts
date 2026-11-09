// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import LoginPage from './+page.svelte';

afterEach(cleanup);

// The sign-in buttons for configured providers, without the recovery links
// every form carries.
const providerLinks = (links: HTMLElement[]) =>
	links.filter((a) => a.getAttribute('href')?.startsWith('/api/admin/auth/'));

const props = (extra: Record<string, unknown> = {}) =>
	({
		form: null,
		data: { oauthProviders: [], samlProviders: [], passwordReset: true, magicLink: true, organization: true, carried: '' },
		...extra,
	}) as never;

// A backup code is 16 hexadecimal characters.
const BACKUP_CODE = 'a1b2c3d4e5f60718';

/** Whether a field lets a whole backup code be typed into it. */
function fitsBackupCode(field: Element | null): boolean {
	const cap = field?.getAttribute('maxlength');
	return field !== null && (cap === null || Number(cap) >= BACKUP_CODE.length);
}

describe('Login page', () => {
	it('asks the browser for the saved password for this account', () => {
		const { container } = render(LoginPage, { props: props() });

		const password = container.querySelector('#password') as HTMLInputElement;
		expect(password.type).toBe('password');
		expect(password.getAttribute('autocomplete')).toBe('current-password');
		expect(password.name).toBe('password');
	});

	// A bare input leaves no way to check a typed password but to clear it and
	// start again.
	it('offers a reveal toggle that does not submit the form', () => {
		const { getByRole } = render(LoginPage, { props: props() });

		const toggle = getByRole('button', { name: /show password/i });
		expect(toggle.getAttribute('type')).toBe('button');
	});

	it('states why a sign-in was refused', () => {
		const { container } = render(LoginPage, {
			props: props({ form: { error: 'Too many attempts. Try again in a moment.' } }),
		});

		expect(container.textContent).toContain('Too many attempts. Try again in a moment.');
		expect(container.querySelector('#password')).not.toBeNull();
	});

	it('posts the challenge token back on the second factor step', () => {
		const { container } = render(LoginPage, {
			props: props({ form: { mfa_required: true, challenge_token: 'tok-1' } }),
		});

		const hidden = container.querySelector('input[name="challenge_token"]') as HTMLInputElement;
		expect(hidden.value).toBe('tok-1');
		expect(container.querySelector('h1')?.textContent?.trim()).toBe('Two-factor verification');
		expect(container.querySelector('#password')).toBeNull();
	});

	// The code field also takes a backup code, which is hexadecimal, so it
	// must not bring up a number pad on a phone.
	it('keeps the full keyboard on the second factor code field', () => {
		const { container } = render(LoginPage, {
			props: props({ form: { mfa_required: true, challenge_token: 'tok-1' } }),
		});
		expect(container.querySelector('input[name="code"]')?.getAttribute('inputmode')).toBeNull();
	});

	it('holds a whole backup code in the second factor code field', () => {
		const { container } = render(LoginPage, {
			props: props({ form: { mfa_required: true, challenge_token: 'tok-1' } }),
		});
		expect(fitsBackupCode(container.querySelector('input[name="code"]'))).toBe(true);
	});

	// A glyph read as an arrow by a sighted reader is read as "left arrow" or
	// skipped entirely by a screen reader, so the icon carries no text.
	it('offers a way back from the second factor step with no glyph standing in for an icon', () => {
		const { getByRole, container } = render(LoginPage, {
			props: props({ form: { mfa_required: true, challenge_token: 'tok-1' } }),
		});

		const back = getByRole('link', { name: /back to sign in/i });
		expect(back.getAttribute('href')).toBe('/login');
		expect(back.querySelector('svg')).toBeTruthy();
		// Arrows, check marks, crosses and bullets, by code point rather than by
		// glyph, so the guard does not carry the thing it forbids.
		expect(container.textContent).not.toMatch(/[\u2190-\u21ff\u2713\u2717\u2022]/);
	});

	it('offers no provider choices when the engine reports none', () => {
		const { queryByText } = render(LoginPage, { props: props() });

		expect(queryByText(/or continue with/i)).toBeNull();
	});

	// An <a> wrapped around a Button nests one interactive element in another.
	// Button renders the anchor itself.
	it('renders each provider as a single anchor', () => {
		const { getAllByRole } = render(LoginPage, {
			props: props({ data: { oauthProviders: ['github', 'azure_ad'], samlProviders: [] } }),
		});

		const links = providerLinks(getAllByRole('link'));
		expect(links.map((a) => a.getAttribute('href'))).toEqual([
			'/api/admin/auth/oauth/github',
			'/api/admin/auth/oauth/azure_ad',
		]);
		expect(links[1].textContent?.trim()).toBe('Sign in with azure ad');
		for (const link of links) {
			expect(link.querySelector('button')).toBeNull();
		}
	});

	// Each configured SAML provider gets a sign-in button, as each OAuth one
	// does.
	it('offers a button for every configured saml provider', () => {
		const { getAllByRole } = render(LoginPage, {
			props: props({ data: { oauthProviders: [], samlProviders: ['Azure AD', 'Okta'] } }),
		});

		const links = providerLinks(getAllByRole('link'));
		expect(links.map((a) => a.getAttribute('href'))).toEqual([
			'/api/admin/auth/saml/Azure%20AD',
			'/api/admin/auth/saml/Okta',
		]);
		// The name is whatever an operator typed, so it is printed as given
		// rather than title-cased the way an oauth key is.
		expect(links[0].textContent?.trim()).toBe('Sign in with Azure AD');
	});

	it('offers both kinds of provider at once', () => {
		const { getAllByRole, getByText } = render(LoginPage, {
			props: props({ data: { oauthProviders: ['github'], samlProviders: ['Okta'] } }),
		});

		expect(getByText(/or continue with/i)).toBeTruthy();
		expect(providerLinks(getAllByRole('link')).map((a) => a.getAttribute('href'))).toEqual([
			'/api/admin/auth/oauth/github',
			'/api/admin/auth/saml/Okta',
		]);
	});

	it('hides the provider choices during the second factor step', () => {
		const { queryByText } = render(LoginPage, {
			props: props({
				form: { mfa_required: true, challenge_token: 'tok-1' },
				data: { oauthProviders: ['github'], samlProviders: [] },
			}),
		});

		expect(queryByText(/or continue with/i)).toBeNull();
	});
});

describe('Login page with a captcha challenge', () => {
	const challenged = (extra: Record<string, unknown> = {}) =>
		props({
			form: {
				error: 'Complete the security check to sign in.',
				captcha: { provider: 'turnstile', siteKey: '0x4AAA' },
				email: 'a@b.co',
				...extra,
			},
		});

	it('shows the provider widget and keeps the address that was typed', () => {
		const { container } = render(LoginPage, { props: challenged() });

		expect(container.querySelector('[data-captcha="turnstile"]')).not.toBeNull();
		expect(container.querySelector('input[name="captcha_token"]')).not.toBeNull();
		expect((container.querySelector('#email') as HTMLInputElement).value).toBe('a@b.co');
		expect(container.textContent).toContain('Complete the security check to sign in.');
	});

	it('holds Sign in until the check has issued a token', () => {
		const { getByRole } = render(LoginPage, { props: challenged() });

		expect((getByRole('button', { name: /^sign in$/i }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('renders no widget before the engine asks for one', () => {
		const { container, getByRole } = render(LoginPage, { props: props() });

		expect(container.querySelector('[data-captcha]')).toBeNull();
		expect((getByRole('button', { name: /^sign in$/i }) as HTMLButtonElement).disabled).toBe(false);
	});
});

describe('Login page recovery links', () => {
	it('offers a password reset and an email sign-in link', () => {
		const { getByRole } = render(LoginPage, { props: props() });

		expect(getByRole('link', { name: /forgot password/i }).getAttribute('href')).toBe('/forgot-password');
		expect(getByRole('link', { name: /email me a sign-in link/i }).getAttribute('href')).toBe('/login/magic-link');
	});

	it('leaves out each link whose plugin is not running', () => {
		const { queryByRole } = render(LoginPage, {
			props: props({ data: { oauthProviders: [], samlProviders: [], passwordReset: false, magicLink: false } }),
		});

		expect(queryByRole('link', { name: /forgot password/i })).toBeNull();
		expect(queryByRole('link', { name: /email me a sign-in link/i })).toBeNull();
	});

	it('hides them during the second factor step', () => {
		const { queryByRole } = render(LoginPage, {
			props: props({ form: { mfa_required: true, challenge_token: 'tok-1' } }),
		});

		expect(queryByRole('link', { name: /forgot password/i })).toBeNull();
		expect(queryByRole('link', { name: /email me a sign-in link/i })).toBeNull();
	});
});

describe('Login page after a session ended', () => {
	it('says the session ended', () => {
		const { container } = render(LoginPage, {
			props: props({ data: { oauthProviders: [], samlProviders: [], ended: true } }),
		});
		expect(container.textContent).toContain('Your session ended. Sign in again.');
	});

	it('says nothing of it on an ordinary visit', () => {
		const { container } = render(LoginPage, { props: props() });
		expect(container.textContent).not.toContain('Your session ended');
	});

	it('offers an optional organization field that says when to fill it in', () => {
		const { container } = render(LoginPage, { props: props() });

		const field = container.querySelector('#tenant') as HTMLInputElement;
		expect(field.name).toBe('tenant');
		expect(field.required).toBe(false);
		expect(container.textContent).toContain('Organization (optional)');
		expect(container.textContent).toContain("Leave this empty unless your organization's identity provider created your account.");
	});

	it('asks for no organization when the console is not set to', () => {
		const { container } = render(LoginPage, {
			props: { form: null, data: { oauthProviders: [], samlProviders: [], passwordReset: true, magicLink: true, organization: false, carried: '' } } as never,
		});

		expect(container.querySelector('[name="tenant"]')).toBeNull();
		expect(container.textContent).not.toContain('Organization (optional)');
		expect(container.querySelector('a[href="/forgot-password"]')).not.toBeNull();
	});

	it('keeps the organization a refused sign-in named', () => {
		const { container } = render(LoginPage, {
			props: props({ form: { error: 'Incorrect email or password.', tenant: 'acme' } }),
		});

		expect((container.querySelector('#tenant') as HTMLInputElement).value).toBe('acme');
	});

	it('shows the organization its link named, in a field the reader sees', () => {
		const { container } = render(LoginPage, { props: { form: null, data: { oauthProviders: [], samlProviders: [], passwordReset: true, magicLink: true, organization: true, carried: 'acme' } } as never });

		const field = container.querySelector('#tenant') as HTMLInputElement;
		expect(field.type).toBe('text');
		expect(field.value).toBe('acme');
		expect(container.querySelectorAll('[name="tenant"]')).toHaveLength(1);
		expect(container.querySelector('input[type="hidden"][name="tenant"]')).toBeNull();
		expect(container.textContent).toContain('The link you followed filled this in. Change or clear it if it is not your organization.');
		expect(container.querySelector('a[href="/forgot-password?tenant=acme"]')).not.toBeNull();
		expect(container.querySelector('a[href="/login/magic-link?tenant=acme"]')).not.toBeNull();
	});

	it('submits what the field shows after the reader changes or clears it', async () => {
		const { container } = render(LoginPage, { props: { form: null, data: { oauthProviders: [], samlProviders: [], passwordReset: true, magicLink: true, organization: true, carried: 'acme' } } as never });
		const field = container.querySelector('#tenant') as HTMLInputElement;
		const posted = () => new FormData(field.form as HTMLFormElement).get('tenant');

		expect(posted()).toBe('acme');
		await fireEvent.input(field, { target: { value: 'globex' } });
		expect(posted()).toBe('globex');
		await fireEvent.input(field, { target: { value: '' } });
		expect(posted()).toBe('');
	});

	it('keeps an organization the reader cleared when the form comes back refused', () => {
		const { container } = render(LoginPage, { props: { form: { error: 'x', tenant: '' }, data: { oauthProviders: [], samlProviders: [], passwordReset: true, magicLink: true, organization: true, carried: 'acme' } } as never });

		expect((container.querySelector('#tenant') as HTMLInputElement).value).toBe('');
	});
});

describe('the sign-in links under a finger', () => {
	const hasHitArea = (el: Element | null) => !!el && ['relative', 'hit-area'].every((c) => el.classList.contains(c));

	it('gives Forgot password a touch hit area', () => {
		const { getByRole } = render(LoginPage, props());
		expect(hasHitArea(getByRole('link', { name: 'Forgot password?' }))).toBe(true);
	});
});
