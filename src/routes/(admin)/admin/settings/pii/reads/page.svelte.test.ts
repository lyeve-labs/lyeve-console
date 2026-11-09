// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(async () => {}) }));

import ReadsPage from './+page.svelte';

afterEach(cleanup);

const said = (c: HTMLElement) => (c.textContent ?? '').replace(/\s+/g, ' ');

const props = (over: Record<string, unknown> = {}) => ({
	data: {
		entries: [
			{
				id: 'a1',
				viewer_user_id: 'u1',
				viewer_role: 'admin',
				pii_type: 'email',
				record_type: 'user',
				accessed_at: '2026-09-22T10:00:00Z',
			},
		],
		total: 1,
		limit: 50,
		offset: 0,
		gate: { state: 'ok' },
		...over,
	} as never,
});

describe('PII unmasked reads gate', () => {
	it('says responses are served as stored when the plugin is absent', () => {
		const { container } = render(ReadsPage, { props: props({ gate: { state: 'absent' }, entries: [] }) });
		expect(said(container)).toContain('Responses are not masked');
	});

	it('carries the strip with Unmasked reads marked, whatever the gate', () => {
		const { getByRole } = render(ReadsPage, { props: props({ gate: { state: 'absent' }, entries: [] }) });
		expect(getByRole('tab', { name: 'Unmasked reads' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'Rules' })).toBeTruthy();
	});
});

describe('PII masking access log', () => {
	it('says masking still runs when only the log failed', () => {
		const message = 'Could not load the unmasked reads. Masking is still running.';
		const { container } = render(ReadsPage, { props: props({ gate: { state: 'error', message }, entries: [] }) });
		expect(said(container)).toContain('Masking is still running');
	});

	it('draws no count of unmasked reads when the log was not read', () => {
		const message = 'Could not load the unmasked reads. Masking is still running.';
		const { container } = render(ReadsPage, {
			props: props({ gate: { state: 'error', message }, entries: [], total: 0 }),
		});
		expect(said(container)).not.toMatch(/Unmasked reads ?0/);
		expect(said(container)).not.toContain('No unmasked reads yet');
	});

	it('counts the reads it read', () => {
		const { container } = render(ReadsPage, { props: props({ total: 120 }) });
		expect(said(container)).toMatch(/Unmasked reads ?120/);
	});

	it('names the search box for a screen reader', () => {
		const { getByLabelText } = render(ReadsPage, { props: props() });
		expect(getByLabelText('Search this page')).toBeTruthy();
	});

	it('reads an empty log as nobody having looked', () => {
		const { container } = render(ReadsPage, { props: props({ entries: [], total: 0 }) });
		expect(said(container)).toContain('No unmasked reads yet');
	});

	it('summarizes what is read most, which rows alone never answer', () => {
		const { container } = render(ReadsPage, { props: props() });
		expect(said(container)).toContain('Most read on this page');
	});
});

describe('PII unmasked reads pager', () => {
	it('offers the next page of the access log at its own address', () => {
		const entries = Array.from({ length: 50 }, (_, i) => ({
			id: `a${i}`,
			viewer_role: 'admin',
			pii_type: 'email',
			record_type: 'user',
			accessed_at: '2026-09-22T10:00:00Z',
		}));
		const { container } = render(ReadsPage, { props: props({ entries, total: 120 }) });
		const next = [...container.querySelectorAll('a')].find((a) => a.getAttribute('aria-label')?.includes('Next'));
		expect(next?.getAttribute('href')).toBe('/admin/settings/pii/reads?limit=50&offset=50');
	});
});
