// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUSY, OUTAGE } from '$lib/outage';

const state = vi.hoisted(() => ({
	page: { url: new URL('http://admin.test/admin') },
}));

vi.mock('$app/state', () => state);

import ErrorPanel from './ErrorPanel.svelte';

afterEach(cleanup);

function mount(status: number, message = '', at = 'http://admin.test/admin') {
	state.page.url = new URL(at);
	return render(ErrorPanel, { props: { status, message, homeHref: '/admin', homeLabel: 'Dashboard' } });
}

describe('ErrorPanel', () => {
	describe('a reader the engine knows and refuses', () => {
		it('says why, in the words the load gave', () => {
			const { getByText } = mount(403, 'Only a super admin can open this page.');
			expect(getByText('Access denied')).toBeTruthy();
			expect(getByText('Only a super admin can open this page.')).toBeTruthy();
		});

		it('falls back to a plain refusal when the load gave no words', () => {
			expect(mount(403).getByText('You do not have access to this page.')).toBeTruthy();
		});

		it('leads with the dashboard and never offers to sign in', () => {
			const { getAllByRole, queryByRole } = mount(403, 'Requires the admin role');
			expect(queryByRole('link', { name: /sign in/i })).toBeNull();
			const [first] = getAllByRole('link');
			expect(first.textContent?.trim()).toBe('Dashboard');
			expect(first.getAttribute('href')).toBe('/admin');
		});
	});

	// No admin seat left is a refusal too: the engine knows the account and
	// the instance is full, so the page says why and offers no sign-in.
	it('reads a 402 as a refusal in the words the load gave', () => {
		const seats = "Every admin seat is taken. You're using 5 of 5, the most this engine allows.";
		const { getByText, getAllByRole, queryByRole } = mount(402, seats);
		expect(getByText('Access denied')).toBeTruthy();
		expect(getByText(seats)).toBeTruthy();
		expect(queryByRole('link', { name: /sign in/i })).toBeNull();
		expect(getAllByRole('link')[0].getAttribute('href')).toBe('/admin');
	});

	describe('an engine refusing for the request rate', () => {
		it('says so in the words the load gave, never with the outage wording', () => {
			const { getByText, queryByText } = mount(429, BUSY.body);
			expect(getByText(BUSY.title)).toBeTruthy();
			expect(getByText(BUSY.body)).toBeTruthy();
			expect(queryByText(OUTAGE.title)).toBeNull();
			expect(queryByText(OUTAGE.body)).toBeNull();
		});

		it('offers one retry of the same address, query included', () => {
			const { getAllByRole } = mount(429, BUSY.body, 'http://admin.test/admin/users?role=editor');
			const links = getAllByRole('link');
			expect(links).toHaveLength(1);
			expect(links[0].textContent?.trim()).toBe(OUTAGE.action);
			expect(links[0].getAttribute('href')).toBe('/admin/users?role=editor');
		});

		it('falls back to its own sentence when the load gave none', () => {
			expect(mount(429).getByText(BUSY.body)).toBeTruthy();
		});
	});

	it('still sends an expired session to sign in', () => {
		const { getByText, getByRole } = mount(401);
		expect(getByText('Not signed in')).toBeTruthy();
		expect(getByRole('link', { name: /sign in/i }).getAttribute('href')).toBe('/login');
	});

	describe('an engine that did not answer', () => {
		it('says the session survived and nothing changed', () => {
			const { getByText } = mount(503, OUTAGE.body);
			expect(getByText(OUTAGE.title)).toBeTruthy();
			expect(getByText(OUTAGE.body)).toBeTruthy();
		});

		it('offers one retry of the same address, query included, as a plain link', () => {
			const { getAllByRole } = mount(503, '', 'http://admin.test/admin/content/posts?page=2&sort=title');
			const links = getAllByRole('link');
			expect(links).toHaveLength(1);
			expect(links[0].textContent?.trim()).toBe(OUTAGE.action);
			expect(links[0].getAttribute('href')).toBe('/admin/content/posts?page=2&sort=title');
		});

		it('never asks a reader who is still signed in to sign in', () => {
			const { queryByRole } = mount(503);
			expect(queryByRole('link', { name: /sign in/i })).toBeNull();
		});

		it('keeps the detail block for other server failures only', () => {
			expect(mount(503, 'The experiment could not be read').queryByText('What the engine returned')).toBeNull();
			cleanup();
			expect(mount(500, 'boom').getByText('What the engine returned')).toBeTruthy();
		});

		it('folds the detail block shut behind a disclosure button', () => {
			const toggle = mount(500, 'boom').getByRole('button', { name: 'What the engine returned' });
			expect(toggle.getAttribute('aria-expanded')).toBe('false');
		});

		it('heads at the level the page asks for', () => {
			state.page.url = new URL('http://admin.test/admin');
			const { getAllByRole } = render(ErrorPanel, {
				props: { status: 404, homeHref: '/admin', homeLabel: 'Dashboard', level: 2 },
			});
			expect(getAllByRole('heading', { level: 2 })).toHaveLength(1);
		});
	});

	// A client-side retry would run only the load that failed again and keep
	// what the shell read during the outage, so both retries reload the page.
	it('asks for a fresh document from either retry', () => {
		for (const status of [503, 429]) {
			const link = mount(status).getByRole('link', { name: OUTAGE.action });
			// The two values the router reads as on.
			expect(['', 'true']).toContain(link.getAttribute('data-sveltekit-reload'));
			cleanup();
		}
	});
});
