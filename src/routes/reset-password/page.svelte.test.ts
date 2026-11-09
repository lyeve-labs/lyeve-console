// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ResetPage from './+page.svelte';

afterEach(cleanup);

const props = (token: string, form: unknown = null, carried = '') =>
	({ form, data: { token, minLength: 12, carried } }) as never;

describe('Reset password page', () => {
	it('asks for the new password twice and posts the token with it', () => {
		const { container } = render(ResetPage, { props: props('t1') });

		const password = container.querySelector('#password') as HTMLInputElement;
		expect(password.type).toBe('password');
		expect(password.getAttribute('autocomplete')).toBe('new-password');
		expect(container.querySelector('#confirm')).not.toBeNull();
		expect((container.querySelector('input[name="token"]') as HTMLInputElement).value).toBe('t1');
		expect(container.textContent).toContain('At least 12 characters.');
	});

	it('offers to remove the passkeys, checked, in the form it posts', () => {
		const { getByRole, container } = render(ResetPage, { props: props('t1') });

		const box = getByRole('checkbox', { name: 'Remove my passkeys' }) as HTMLInputElement;
		expect(box.checked).toBe(true);
		expect(box.name).toBe('remove_passkeys');
		expect(box.closest('form')).toBe(container.querySelector('form'));
		expect(container.textContent).toContain(
			'Recommended. A passkey someone else added stops working. You can add your own again after you sign in.'
		);
	});

	it('says how many passkeys the reset removed, and nothing when it removed none', async () => {
		const removed = render(ResetPage, { props: props('t1', { done: true, passkeysRemoved: 2 }) });
		expect(await removed.findByText('Password changed. 2 passkeys were removed. Sign in with the new one.')).toBeTruthy();
		cleanup();
		const none = render(ResetPage, { props: props('t1', { done: true, passkeysRemoved: 0 }) });
		expect(await none.findByText('Password changed. Sign in with the new one.')).toBeTruthy();
		expect(none.queryByText(/passkeys were removed\./)).toBeNull();
	});

	it('sends the visitor to sign in once the password is changed', () => {
		const { getByRole, container } = render(ResetPage, { props: props('t1', { done: true }) });

		expect(container.querySelector('h1')?.textContent?.trim()).toBe('Password changed');
		expect(getByRole('link', { name: /sign in/i }).getAttribute('href')).toBe('/login');
	});

	it('reads out that the password changed', async () => {
		const { findByText } = render(ResetPage, { props: props('t1', { done: true }) });

		const region = (await findByText('Password changed. Sign in with the new one.')).closest('[aria-live="polite"]');
		expect(region?.getAttribute('aria-atomic')).toBe('true');
		expect(region?.textContent).toContain('Password changed.');
	});

	it('offers a new link for an expired one instead of the form', () => {
		const { getByRole, container } = render(ResetPage, {
			props: props('t1', { error: 'This reset link no longer works. Request a new one.', expired: true }),
		});

		expect(container.querySelector('#password')).toBeNull();
		expect(getByRole('link', { name: /request a new link/i }).getAttribute('href')).toBe('/forgot-password');
	});

	it('never asks for an organization and carries the one its link named', () => {
		const { getByRole, container } = render(ResetPage, {
			props: props('t1', { error: 'This reset link no longer works. Request a new one.', expired: true }, 'acme'),
		});

		expect(container.querySelector('input[name="tenant"]')).toBeNull();
		expect(getByRole('link', { name: /request a new link/i }).getAttribute('href')).toBe('/forgot-password?tenant=acme');
		expect(getByRole('link', { name: /back to sign in/i }).getAttribute('href')).toBe('/login?tenant=acme');
	});

	it('offers a new link when the email link carried no token', () => {
		const { container } = render(ResetPage, { props: props('') });

		expect(container.querySelector('#password')).toBeNull();
		expect(container.textContent).toContain('incomplete');
	});
});
