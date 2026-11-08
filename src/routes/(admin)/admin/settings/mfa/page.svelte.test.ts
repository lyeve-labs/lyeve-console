// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,AA') } }));

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

const licensed = { plan: 'example', state: 'active', features: ['mfa'], tenant_quota: 1 };

function setup(mfaEnabled: boolean | { ok: false; gate: unknown }, form: unknown = null, hasPasskeys = false) {
	const mfa = typeof mfaEnabled === 'boolean' ? { ok: true, value: { enabled: mfaEnabled, hasPasskeys } } : mfaEnabled;
	return render(Page, { props: { data: { mfa, entitlements: licensed }, form } as never });
}

describe('an account with a passkey', () => {
	it('says passkeys keep two-factor on and offers both app controls', () => {
		const { container, getByRole } = setup(true, null, true);
		expect(container.textContent).toContain('This account has a passkey');
		expect(container.textContent).not.toContain('takes a code from the authenticator app');
		expect(getByRole('button', { name: /Set up with this code/ })).toBeTruthy();
		expect(container.querySelector('form[action="?/setup"]')).not.toBeNull();
		expect(container.querySelector('form[action="?/disable"]')).not.toBeNull();
	});
});

describe('setting up an app beside a passkey', () => {
	// The engine holds the new key apart until a code from it verifies.
	it('says the new key replaces an app already set up once a code verifies', () => {
		const { container } = setup(true, null, true);
		expect(container.textContent).toContain('the new key replaces it once you verify a code.');
		expect(container.textContent).not.toContain('Starting setup replaces');
	});

	// The account holds a passkey, so a session alone cannot add an app: the
	// page offers the passkey, or a code, before setup starts.
	it('asks for a passkey or a code before setup starts', async () => {
		const { container, getByRole } = setup(true, null, true);
		expect(container.querySelector('form[action="?/prove"]')).not.toBeNull();
		expect(getByRole('button', { name: /Confirm with a passkey/ })).toBeTruthy();
		const button = getByRole('button', { name: /Set up with this code/ }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		const input = container.querySelector('form[action="?/setup"] input[name="code"]') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'a1b2c3d4e5f60718' } });
		expect(button.disabled).toBe(false);
	});
});

describe('confirming with a passkey', () => {
	const options = { publicKey: { challenge: 'AAEC', allowCredentials: [{ type: 'public-key', id: 'BAUG' }] } };
	const proving = { step: 'proving', proofSessionId: 'proof-1', options };

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('carries the proof session to the setup form and waits for a click', () => {
		const { container, getByRole } = setup(true, proving, true);
		expect((container.querySelector('input[name="proof_session_id"]') as HTMLInputElement).value).toBe('proof-1');
		expect(container.querySelector('form[action="?/setup"]')).not.toBeNull();
		expect(getByRole('button', { name: /Use a passkey/ })).toBeTruthy();
		expect(getByRole('link', { name: /Cancel/ }).getAttribute('href')).toBe('/admin/settings/mfa');
	});

	it('posts the signed assertion with the setup form', async () => {
		const get = vi.fn(async () => ({
			id: 'BAUG',
			type: 'public-key',
			rawId: new Uint8Array([4, 5, 6]).buffer,
			response: {
				clientDataJSON: new Uint8Array([1]).buffer,
				authenticatorData: new Uint8Array([2]).buffer,
				signature: new Uint8Array([3]).buffer,
				userHandle: null,
			},
		}));
		vi.stubGlobal('PublicKeyCredential', class {});
		vi.stubGlobal('navigator', { ...navigator, credentials: { get } });
		const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});

		const { container, getByRole } = setup(true, proving, true);
		await fireEvent.click(getByRole('button', { name: /Use a passkey/ }));

		await waitFor(() => expect(submit).toHaveBeenCalled());
		const sent = JSON.parse((container.querySelector('input[name="assertion"]') as HTMLInputElement).value);
		expect(sent).toMatchObject({ id: 'BAUG', rawId: 'BAUG', response: { signature: 'Aw' } });
		expect(get).toHaveBeenCalledOnce();
		submit.mockRestore();
	});

	it('says in its own words when the passkey does not answer', async () => {
		vi.stubGlobal('PublicKeyCredential', class {});
		vi.stubGlobal('navigator', {
			...navigator,
			credentials: { get: vi.fn(async () => Promise.reject(new DOMException('denied', 'NotAllowedError'))) },
		});
		const { getByRole, findByText } = setup(true, proving, true);
		await fireEvent.click(getByRole('button', { name: /Use a passkey/ }));
		expect(await findByText(/The passkey request timed out or was canceled/)).toBeTruthy();
	});

	it('says so when the browser has no passkey support', async () => {
		vi.stubGlobal('PublicKeyCredential', undefined);
		const { getByRole, findByText } = setup(true, proving, true);
		await fireEvent.click(getByRole('button', { name: /Use a passkey/ }));
		expect(await findByText('This browser cannot use a passkey. Enter a code instead.')).toBeTruthy();
	});
});

// A backup code is 16 hexadecimal characters.
const BACKUP_CODE = 'a1b2c3d4e5f60718';

/** Whether a field lets a whole backup code be typed into it. */
function fitsBackupCode(field: Element | null): boolean {
	const cap = field?.getAttribute('maxlength');
	return field !== null && (cap === null || Number(cap) >= BACKUP_CODE.length);
}

// Backup codes are hexadecimal, so a field that takes one must not bring up a
// number pad on a phone, and it must hold the whole code.
describe('fields that take a backup code', () => {
	it('keep the full keyboard on every form that accepts one', () => {
		for (const hasPasskeys of [false, true]) {
			const { container } = setup(true, null, hasPasskeys);
			const fields = container.querySelectorAll('form[action="?/disable"] input[name="code"], form[action="?/setup"] input[name="code"]');
			expect(fields).toHaveLength(2);
			for (const f of fields) {
				expect(f.getAttribute('inputmode')).toBeNull();
				expect(fitsBackupCode(f)).toBe(true);
			}
			cleanup();
		}
	});
});

describe('replacing the authenticator app', () => {
	it('asks for a current code or a backup code before setup starts', async () => {
		const { container, getByRole } = setup(true);
		const input = container.querySelector('form[action="?/setup"] input[name="code"]') as HTMLInputElement;
		expect(input).not.toBeNull();
		const button = getByRole('button', { name: /Replace the authenticator app/ }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		await fireEvent.input(input, { target: { value: 'a1b2c3d4' } });
		expect(button.disabled).toBe(false);
	});

	it('shows the refusal the setup action answered', () => {
		const error = 'That code matches neither the authenticator app already set up nor an unused backup code.';
		const { getByText } = setup(true, { step: 'idle', error });
		expect(getByText(error)).toBeTruthy();
	});
});

describe('two-factor authentication page', () => {
	it('offers to turn it on through the setup action', () => {
		const { container, getByRole } = setup(false);
		expect(getByRole('button', { name: /Turn on two-factor authentication/ })).toBeTruthy();
		expect(container.querySelector('form[action="?/setup"]')).not.toBeNull();
	});

	it('carries the generated key through a wrong code', () => {
		const { container, getByText } = setup(false, { step: 'confirming', uri: 'otpauth://x', secret: 'ABC', error: 'invalid code' });
		expect(getByText('invalid code')).toBeTruthy();
		expect((container.querySelector('input[name="secret"]') as HTMLInputElement).value).toBe('ABC');
		expect(container.querySelector('form[action="?/verify"]')).not.toBeNull();
	});

	it('draws the QR code for the generated key in the browser', async () => {
		const { container } = setup(false, { step: 'confirming', uri: 'otpauth://x', secret: 'ABC' });
		await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA'));
	});

	it('shows the backup codes once, after the code is accepted', () => {
		const { getByText } = setup(false, { step: 'done', backupCodes: ['a1', 'b2'] });
		expect(getByText('a1')).toBeTruthy();
		expect(getByText(/not shown again/)).toBeTruthy();
	});

	it('says the state could not be read instead of offering to turn it on', () => {
		const { container, queryByRole } = setup({ ok: false, gate: { state: 'unavailable' } });
		expect(container.textContent).toContain('Could not load the two-factor status');
		expect(container.textContent).not.toContain('Not enabled on this account');
		expect(queryByRole('button', { name: /Turn on/ })).toBeNull();
		expect(queryByRole('button', { name: /Turn off/ })).toBeNull();
	});

	it('asks for a code to turn it off when it is on', () => {
		const { container } = setup(true);
		expect(container.querySelector('form[action="?/disable"] input[name="code"]')).not.toBeNull();
	});

	it('copies every backup code at once and confirms for a second and a half', async () => {
		vi.useFakeTimers();
		const writeText = vi.fn(async (_text: string) => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		const { getByRole } = setup(false, { step: 'done', backupCodes: ['a1', 'b2'] });
		const copy = getByRole('button', { name: 'Copy all codes' });
		const status = copy.parentElement!.querySelector('[aria-live="polite"]')!;

		await fireEvent.click(copy);
		await vi.advanceTimersByTimeAsync(0);
		expect(writeText).toHaveBeenCalledWith('a1\nb2');
		expect(status.textContent).toBe('Copied');

		await vi.advanceTimersByTimeAsync(1500);
		expect(status.textContent).toBe('');
	});

	it('keeps the advice to write the codes down after a copy fails', async () => {
		vi.useFakeTimers();
		const writeText = vi.fn(async (_text: string) => {
			throw new Error('denied');
		});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		Object.defineProperty(document, 'execCommand', { value: vi.fn(() => false), configurable: true });
		const { getByRole, getByText, queryByText } = setup(false, { step: 'done', backupCodes: ['a1', 'b2'] });

		await fireEvent.click(getByRole('button', { name: 'Copy all codes' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(getByText('Could not copy. Try again.')).toBeTruthy();

		await vi.advanceTimersByTimeAsync(1500);
		expect(queryByText('Could not copy. Try again.')).toBeNull();
		expect(getByText(/If the copy fails, write them down before you leave this page\./)).toBeTruthy();
	});
});

describe('a first factor on a sign-in that is not recent', () => {
	it('asks for the password in the setup form', () => {
		const { container, getByRole } = setup(false, { step: 'password' });
		const form = container.querySelector('form[action="?/setup"]') as HTMLFormElement;
		const field = form.querySelector('input[name="password"]') as HTMLInputElement;
		expect(field.type).toBe('password');
		expect(field.getAttribute('autocomplete')).toBe('current-password');
		expect(field.hasAttribute('aria-invalid')).toBe(false);
		expect(container.textContent).toContain('Confirm it is you with your password.');
		expect(getByRole('button', { name: /Turn on two-factor authentication/ }).closest('form')).toBe(form);
	});

	it('says on the field that the password did not match', () => {
		const { container } = setup(false, { step: 'password', passwordError: 'That password does not match your account.' });
		const field = container.querySelector('input[name="password"]') as HTMLInputElement;
		expect(field.getAttribute('aria-invalid')).toBe('true');
		expect(container.textContent).toContain('That password does not match your account.');
	});

	it('offers to sign in again when the account has no password to give', () => {
		const { container, getByRole } = setup(false, { step: 'signIn' });
		expect(container.textContent).toContain('Sign in again to add a second factor.');
		expect(getByRole('button', { name: 'Sign in again' }).closest('form')?.getAttribute('action')).toBe('/logout');
		expect(container.querySelector('input[name="password"]')).toBeNull();
	});
});
