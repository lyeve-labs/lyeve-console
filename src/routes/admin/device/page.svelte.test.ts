// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import DevicePage from './+page.svelte';
import { outlineSkips } from '$lib/test-outline';
import { OUTAGE } from '$lib/outage';

afterEach(cleanup);

const request = {
	user_code: 'WDJB-MJHT',
	client_name: 'lyeve cli',
	requester_ip: '203.0.113.7',
	created_at: new Date().toISOString(),
	expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
	tenant_id: '',
	roles: ['admin'],
	session_expires_in: 3600,
	approver_ip: '203.0.113.7',
	same_address: true,
};

function props(data: Record<string, unknown>, form: unknown = null) {
	return { data: { email: 'ada@example.com', view: 'enter', code: '', request: null, mfaEnrolled: false, ...data }, form } as never;
}

const formFor = (action: string) => document.body.querySelector(`form[action="?/${action}"]`) as HTMLFormElement | null;

describe('a sign-in request to decide', () => {
	it('shows what the device would get and posts the code with the password to approve', () => {
		render(DevicePage, { props: props({ view: 'pending', code: 'WDJB-MJHT', request }) });
		expect(document.body.textContent).toContain('WDJB-MJHT');
		expect(document.body.textContent).toContain('lyeve cli');
		expect(document.body.textContent).toContain('(the same address)');
		const approve = formFor('approve') as HTMLFormElement;
		const sent = new FormData(approve);
		expect([sent.get('code'), sent.get('step')]).toEqual(['WDJB-MJHT', 'password']);
		expect(screen.getByLabelText(/Your password/)).toBeTruthy();
		expect(new FormData(formFor('deny') as HTMLFormElement).get('code')).toBe('WDJB-MJHT');
	});

	it('asks for the authenticator code when the account has two-factor authentication', () => {
		render(DevicePage, { props: props({ view: 'pending', code: 'WDJB-MJHT', request, mfaEnrolled: true }) });
		expect(new FormData(formFor('approve') as HTMLFormElement).get('step')).toBe('mfa_code');
	});

	it('keeps the request open and says why a confirmation was refused', () => {
		render(DevicePage, {
			props: props({ view: 'pending', code: 'WDJB-MJHT', request }, { stepUp: { error: 'That code is not valid.', field: 'That code is not valid.', needsMfa: true } }),
		});
		expect(screen.getAllByText('That code is not valid.').length).toBeGreaterThan(0);
		expect(new FormData(formFor('approve') as HTMLFormElement).get('step')).toBe('mfa_code');
		expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
	});
});

describe('the outcome of a decision', () => {
	it.each([
		['approved', 'Device signed in'],
		['denied', 'Sign-in denied'],
		['forbidden', 'You cannot approve this sign-in'],
	])('shows %s in place of the request, with no code field', (outcome, title) => {
		render(DevicePage, { props: props({ view: 'pending', code: 'WDJB-MJHT', request }, { outcome }) });
		expect(screen.getByText(title)).toBeTruthy();
		expect(formFor('approve')).toBeNull();
		expect(screen.queryByLabelText(/Code from the device/)).toBeNull();
	});

	it.each([
		['expired', 'This code has expired'],
		['decided', 'Already decided'],
	])('offers another code after %s', (view, title) => {
		render(DevicePage, { props: props({ view, code: 'WDJB-MJHT' }) });
		expect(screen.getByText(title)).toBeTruthy();
		expect(screen.getByText('Try another code')).toBeTruthy();
	});

	it.each(['approved', 'expired', 'unknown'])('heads the %s outcome one level under the page title', (view) => {
		render(DevicePage, { props: props({ view, code: 'WDJB-MJHT' }, view === 'approved' ? { outcome: view } : null) });
		expect(outlineSkips()).toEqual([]);
	});

	it('keeps an unknown code in the field so it can be corrected', () => {
		render(DevicePage, { props: props({ view: 'unknown', code: 'WDJB-MJH' }) });
		expect(screen.getByText('No sign-in is waiting for this code')).toBeTruthy();
		expect((screen.getByLabelText(/Code from the device/) as HTMLInputElement).value).toBe('WDJB-MJH');
	});

	it('says the engine did not answer and retries the same code', () => {
		render(DevicePage, { props: props({ view: 'error', code: 'WDJB-MJHT' }) });
		expect(screen.getByText(OUTAGE.title)).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe('/admin/device?code=WDJB-MJHT');
	});
});

describe('a refusal that is not an outage', () => {
	it('says the engine is busy and retries the same code', () => {
		render(DevicePage, { props: props({ view: 'busy', code: 'WDJB-MJHT' }) });
		expect(screen.getByText('Too many requests')).toBeTruthy();
		expect(screen.queryByText(OUTAGE.title)).toBeNull();
		expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe('/admin/device?code=WDJB-MJHT');
	});

	it('shows the sentence a 402 carried', () => {
		render(DevicePage, { props: props({ view: 'refused', code: 'WDJB-MJHT', refusal: 'The license does not include it.' }) });
		expect(screen.getByText('The license does not include it.')).toBeTruthy();
		expect(screen.queryByText(OUTAGE.title)).toBeNull();
	});
});

describe('the first visit', () => {
	it('asks for the code shown on the device', () => {
		render(DevicePage, { props: props({}) });
		expect(screen.getByText('Enter the code')).toBeTruthy();
		const field = screen.getByLabelText(/Code from the device/) as HTMLInputElement;
		expect(field.name).toBe('code');
		expect(field.value).toBe('');
	});
});
