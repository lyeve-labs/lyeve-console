// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import StoredPage from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		superAdmin: false,
		entries: [],
		entriesGate: null,
		unlisted: false,
		flushScoped: true,
		total: 0,
		limit: 50,
		offset: 0,
		hasMore: false,
		gate: { state: 'ok' },
		...over,
	} as never,
	form: form as never,
});

describe('flush', () => {
	// The plugin scopes the flush to the tenant the request names, and it
	// admits a tenant admin. The button says what goes.
	it("offers a tenant admin the flush of this tenant's responses", () => {
		const { container } = render(StoredPage, { props: props() });
		expect(screen.getByRole('button', { name: "Flush this tenant's responses" })).toBeTruthy();
		expect(said(container)).not.toContain('Flush the cache');
		expect(said(container)).toContain('Only super admins can see stored keys');
	});

	it('names the whole cache only where the session names no tenant', () => {
		render(StoredPage, { props: props({ superAdmin: true, flushScoped: false }) });
		expect(screen.getByRole('button', { name: 'Flush the cache' })).toBeTruthy();
	});

	it("says the stored list is this tenant's while the counters are every tenant's", () => {
		const entry = { key: 'resp:acme:1', size: 10, expires_at: '2026-09-23T12:00:00Z', created_at: '2026-09-23T11:00:00Z', ttl_mode: 'fixed', tags: null };
		const { container } = render(StoredPage, { props: props({ superAdmin: true, entries: [entry], total: 1 }) });
		expect(said(container)).toContain("Only this tenant's keys are listed. The counters on the Overview tab include every tenant.");
	});
});

describe('stored entries', () => {
	it('stops an entry size at GB', () => {
		const entry = { key: 'page:/', size: 2 * 1024 ** 4, expires_at: '2026-09-23T12:00:00Z', created_at: '2026-09-23T11:00:00Z', ttl_mode: 'fixed', tags: null };
		const { container } = render(StoredPage, { props: props({ superAdmin: true, entries: [entry], total: 1 }) });
		expect(said(container)).toContain('2048.0 GB');
	});

	// The counter on the Overview tab read thousands while the list said
	// nothing was cached.
	it('says the entries could not be read rather than that nothing is cached', () => {
		const { container } = render(StoredPage, {
			props: props({
				superAdmin: true,
				entriesGate: { state: 'error', message: 'Could not load stored entries.' },
			}),
		});
		expect(said(container)).toContain('Could not load stored entries.');
		expect(said(container)).not.toContain('No cached entries yet');
	});

	// A networked provider cannot list what it holds. The plugin answers an
	// empty page and a note, and the counter on the Overview tab still counts
	// thousands.
	it('says the provider does not list its entries rather than that nothing is cached', () => {
		const { container } = render(StoredPage, {
			props: props({
				superAdmin: true,
				unlisted: true,
			}),
		});
		expect(said(container)).toContain('This cache provider cannot list its entries');
		expect(said(container)).not.toContain('No cached entries yet');
	});

});

describe('the gate', () => {
	it('says the plugin is absent rather than showing an empty page', () => {
		const { container } = render(StoredPage, { props: props({ gate: { state: 'absent' }, entries: [] }) });
		expect(said(container)).toContain('The cache is not included in this build.');
		expect(said(container)).not.toContain('No cached entries yet');
	});
});
