// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	page: { status: 500, error: null as { message: string } | null, url: new URL('http://admin.test/admin/users?role=editor') },
}));

vi.mock('$app/state', () => state);

import RootError from './+error.svelte';
import { BUSY, OUTAGE } from '$lib/outage';
import { outlineSkips } from '$lib/test-outline';

afterEach(cleanup);

function renderAt(status: number, message = '') {
	state.page.status = status;
	state.page.error = message ? { message } : null;
	return render(RootError);
}

describe('Root error page', () => {
	it('opens its heading outline with an h1 that names the page', () => {
		const { container, getByRole } = renderAt(404);
		expect(getByRole('heading', { level: 1, name: 'Could not open this page' })).toBeTruthy();
		expect(outlineSkips(container)).toEqual([]);
	});

	it('shows the status code carried by the page state', () => {
		const { getByText } = renderAt(404);
		expect(getByText('404')).toBeTruthy();
	});

	it('renders the not-found face for 404', () => {
		const { getByText } = renderAt(404, 'gone');
		expect(getByText('Not found')).toBeTruthy();
		expect(getByText('gone')).toBeTruthy();
	});

	it('offers a sign-in link for 401', () => {
		const { getByText, getByRole } = renderAt(401);
		expect(getByText('Not signed in')).toBeTruthy();
		expect(getByRole('link', { name: /sign in/i }).getAttribute('href')).toBe('/login');
	});

	it('keeps the server face for 500', () => {
		const { getByText } = renderAt(500);
		expect(getByText('Could not complete the request')).toBeTruthy();
	});

	// The shell's own session check fails here, above the admin frame, when the
	// engine cannot answer it. The reader keeps the session and gets a retry.
	it('renders the outage face for 503, with a retry of the same address', () => {
		const { getByText, getByRole } = renderAt(503, OUTAGE.body);
		expect(getByText(OUTAGE.title)).toBeTruthy();
		expect(getByText(OUTAGE.body)).toBeTruthy();
		expect(getByRole('link', { name: OUTAGE.action }).getAttribute('href')).toBe('/admin/users?role=editor');
		expect(document.title).toContain(OUTAGE.title);
	});

	// The session check refuses for the rate and for a full instance too. Each
	// page names its own refusal in the tab, never the outage.
	it.each([
		[429, BUSY.title],
		[402, 'No access'],
	])('titles the tab for a %i after its own face', (status, title) => {
		renderAt(status, 'refused');
		expect(document.title).toContain(title);
		expect(document.title).not.toContain(OUTAGE.title);
	});
});
