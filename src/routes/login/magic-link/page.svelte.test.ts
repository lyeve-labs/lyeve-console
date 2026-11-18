// @vitest-environment jsdom
import { cleanup, render, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import MagicLinkPage from './+page.svelte';

afterEach(cleanup);

describe('Magic link request page', () => {
	it('asks for the address to send the link to', () => {
		const { container, getByRole } = render(MagicLinkPage, { props: { form: null, data: { organization: true, carried: '' } } as never });

		expect((container.querySelector('#email') as HTMLInputElement).type).toBe('email');
		expect(getByRole('button', { name: /email me a link/i })).toBeTruthy();
	});

	it('confirms without saying whether the address has an account, and reads it out', async () => {
		const { container, findByText } = render(MagicLinkPage, { props: { form: { sent: true, email: 'a@b.co' }, data: { organization: true, carried: '' } } as never });

		const region = (await findByText(/If an account exists for a@b.co/)).closest('[aria-live="polite"]');
		expect(region?.getAttribute('aria-atomic')).toBe('true');
		expect(region?.textContent).toContain('a sign-in link is on its way');
		expect(container.querySelector('#email')).toBeNull();
	});

	it('offers an optional organization field that says when to fill it in', () => {
		const { container } = render(MagicLinkPage, { props: { form: null, data: { organization: true, carried: '' } } as never });

		const field = container.querySelector('#tenant') as HTMLInputElement;
		expect(field.name).toBe('tenant');
		expect(field.required).toBe(false);
		expect(container.textContent).toContain('Organization (optional)');
		expect(container.textContent).toContain("Leave this empty unless your organization's identity provider created your account.");
	});

	it('asks for no organization when the console is not set to', () => {
		const { container } = render(MagicLinkPage, { props: { form: null, data: { organization: false, carried: '' } } as never });

		expect(container.querySelector('[name="tenant"]')).toBeNull();
		expect(container.textContent).not.toContain('Organization (optional)');
		expect(container.querySelector('a[href="/login"]')).not.toBeNull();
	});

	it('keeps a refused organization in the field', () => {
		const { container } = render(MagicLinkPage, {
			props: { form: { error: 'x', email: 'a@b.co', tenant: 'acme corp' }, data: { organization: true, carried: '' } } as never,
		});

		expect((container.querySelector('#tenant') as HTMLInputElement).value).toBe('acme corp');
	});

	it('shows the organization its link named, in a field the reader sees', () => {
		const { container } = render(MagicLinkPage, { props: { form: null, data: { organization: true, carried: 'acme' } } as never });

		const field = container.querySelector('#tenant') as HTMLInputElement;
		expect(field.type).toBe('text');
		expect(field.value).toBe('acme');
		expect(container.querySelectorAll('[name="tenant"]')).toHaveLength(1);
		expect(container.querySelector('input[type="hidden"][name="tenant"]')).toBeNull();
		expect(container.textContent).toContain('The link you followed filled this in. Change or clear it if it is not your organization.');
		expect(container.querySelector('a[href="/login?tenant=acme"]')).not.toBeNull();
	});

	it('submits what the field shows after the reader changes or clears it', async () => {
		const { container } = render(MagicLinkPage, { props: { form: null, data: { organization: true, carried: 'acme' } } as never });
		const field = container.querySelector('#tenant') as HTMLInputElement;
		const posted = () => new FormData(field.form as HTMLFormElement).get('tenant');

		expect(posted()).toBe('acme');
		await fireEvent.input(field, { target: { value: 'globex' } });
		expect(posted()).toBe('globex');
		await fireEvent.input(field, { target: { value: '' } });
		expect(posted()).toBe('');
	});

	it('keeps an organization the reader cleared when the form comes back refused', () => {
		const { container } = render(MagicLinkPage, { props: { form: { error: 'x', tenant: '' }, data: { organization: true, carried: 'acme' } } as never });

		expect((container.querySelector('#tenant') as HTMLInputElement).value).toBe('');
	});
});

describe('Magic link request page title', () => {
	it('names the page in the tab as its heading does', () => {
		const { getByRole } = render(MagicLinkPage, { props: { form: null, data: { organization: true, carried: '' } } as never });
		expect(getByRole('heading', { level: 1 }).textContent).toContain('Sign in with an email link');
		expect(document.title).toContain('Sign in with an email link');
	});
});
