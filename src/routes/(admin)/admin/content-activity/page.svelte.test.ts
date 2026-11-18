// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/content-activity') } }));

import Page from './+page.svelte';
import { hoverSnaps } from '#lib/transitions.test-support.ts';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const ROW = {
	id: 'a1',
	tenant_id: 'acme',
	schema_name: 'article',
	entry_id: '11111111-1111-1111-1111-111111111111',
	action: 'updated',
	source: 'console',
	fields: ['title', 'summary'],
	actor_id: '22222222-2222-2222-2222-222222222222',
	created_at: '2026-10-21T10:00:00Z',
};

const FILTER = { schema: '', entry_id: '', actor: '', action: '', source: '', from: '', to: '' };

function props(over: Record<string, unknown> = {}) {
	return {
		data: {
			activity: { ok: true, value: [ROW] },
			total: 1,
			offset: 0,
			limit: 50,
			filter: FILTER,
			tenant: null,
			superAdmin: false,
			schemas: { ok: true, value: [{ name: 'article', label: 'Articles' }] },
			tenants: { ok: true, value: [] },
			...over,
		} as never,
	};
}

describe('content activity', () => {
	it('shows who changed which entry of which type, how and when', () => {
		const { container } = render(Page, { props: props() });
		const row = container.querySelector('tbody tr') as HTMLElement;
		expect(said(row)).toContain('22222222');
		expect(said(row)).toContain('11111111');
		expect(said(row)).toContain('Articles');
		expect(said(row)).toContain('Updated');
		expect(said(row)).toContain('console');
		expect(said(row)).toContain('title, summary');
	});

	it('narrows to one entry or one person from their cells, keeping the filter in force', () => {
		render(Page, { props: props({ filter: { ...FILTER, action: 'updated' } }) });
		expect(screen.getByRole('link', { name: '11111111' }).getAttribute('href')).toBe(
			'/admin/content-activity?entry_id=11111111-1111-1111-1111-111111111111&action=updated',
		);
		expect(screen.getByRole('link', { name: '22222222' }).getAttribute('href')).toBe(
			'/admin/content-activity?actor=22222222-2222-2222-2222-222222222222&action=updated',
		);
	});

	it('offers no tenant choice and no tenant column to a reader who is not a super admin', () => {
		const { container } = render(Page, { props: props() });
		expect(container.querySelector('#activity-tenant')).toBeNull();
		expect(screen.queryByRole('columnheader', { name: 'Tenant' })).toBeNull();
	});

	it('gives a super admin the tenant choice, starting at All tenants, and the tenant of each row', () => {
		const { container } = render(Page, {
			props: props({ superAdmin: true, tenant: '', tenants: { ok: true, value: [{ slug: 'acme', label: 'Acme' }] } }),
		});
		expect(container.querySelector('#activity-tenant')).not.toBeNull();
		expect(said(container.querySelector('#activity-tenant')?.parentElement as HTMLElement)).toContain('All tenants');
		expect(screen.getByRole('columnheader', { name: 'Tenant' })).toBeTruthy();
		expect(said(container.querySelector('tbody tr') as HTMLElement)).toContain('Acme');
	});

	it('keeps the tenant in force on the page links', () => {
		render(Page, { props: props({ superAdmin: true, tenant: 'acme' }) });
		expect(screen.getByRole('link', { name: '11111111' }).getAttribute('href')).toContain('tenant_id=acme');
	});

	it('says an older engine does not record activity, instead of failing', () => {
		const { container } = render(Page, { props: props({ activity: { ok: false, gate: { state: 'absent' } }, total: null }) });
		expect(said(container)).toContain('Content activity needs a newer version of the engine.');
		expect(container.querySelector('table')).toBeNull();
	});

	it('draws a failed read as a failure with a way to try again', () => {
		const { container } = render(Page, {
			props: props({ activity: { ok: false, gate: { state: 'unavailable' } }, total: null }),
		});
		expect(said(container)).toContain('is unavailable');
		expect(screen.getByRole('link', { name: /Try again/ }).getAttribute('href')).toBe('/admin/content-activity');
		expect(said(container)).not.toContain('No content changes yet');
	});

	it('names the entry by its title and the person by their email when the row carries them', () => {
		render(Page, {
			props: props({ activity: { ok: true, value: [{ ...ROW, entry_title: 'Launch notes', actor_email: 'ana@example.com' }] } }),
		});
		expect(screen.getByRole('link', { name: 'Launch notes' }).getAttribute('href')).toContain('entry_id=11111111');
		expect(screen.getByRole('link', { name: 'ana@example.com' }).getAttribute('href')).toContain('actor=22222222');
	});

	it('falls back to the short ids when the title and email are null', () => {
		render(Page, { props: props({ activity: { ok: true, value: [{ ...ROW, entry_title: null, actor_email: null }] } }) });
		expect(screen.getByRole('link', { name: '11111111' })).toBeTruthy();
		expect(screen.getByRole('link', { name: '22222222' })).toBeTruthy();
	});

	it("links a row that names a version to the entry's editor for a tenant admin", () => {
		render(Page, { props: props({ activity: { ok: true, value: [{ ...ROW, revision_num: 7, entry_exists: true }] } }) });
		expect(screen.getByRole('link', { name: 'Version 7' }).getAttribute('href')).toBe(
			'/admin/content/article/11111111-1111-1111-1111-111111111111',
		);
	});

	it('links no row whose version is null', () => {
		const { container } = render(Page, {
			props: props({ activity: { ok: true, value: [{ ...ROW, revision_num: null, entry_exists: true }] } }),
		});
		expect(screen.queryByRole('link', { name: /Version/ })).toBeNull();
		expect(container.querySelector('a[href^="/admin/content/article/"]')).toBeNull();
	});

	it.each([false, undefined])('links no row whose entry the plugin says is gone or does not say (%s)', (exists) => {
		render(Page, { props: props({ activity: { ok: true, value: [{ ...ROW, revision_num: 7, entry_exists: exists }] } }) });
		expect(screen.queryByRole('link', { name: 'Version 7' })).toBeNull();
		expect(screen.getByText('Version 7')).toBeTruthy();
	});

	it('links no row to an editor for a super admin reading across tenants', () => {
		render(Page, {
			props: props({ superAdmin: true, tenant: '', activity: { ok: true, value: [{ ...ROW, revision_num: 7, entry_exists: true }] } }),
		});
		expect(screen.queryByRole('link', { name: 'Version 7' })).toBeNull();
		expect(screen.getByText('Version 7')).toBeTruthy();
	});

	const actor = (c: HTMLElement) => said(c.querySelector('[data-testid="activity-actor"]') as HTMLElement).trim();

	it('shows an API key as one, by its short id', () => {
		const { container } = render(Page, {
			props: props({ activity: { ok: true, value: [{ ...ROW, actor_kind: 'api_key', actor_email: null }] } }),
		});
		expect(actor(container)).toBe('API key 22222222');
		expect(screen.getByRole('link', { name: 'API key 22222222' }).getAttribute('href')).toContain('actor=22222222');
	});

	it("shows an admin token's write as its owner, through an admin token", () => {
		const { container } = render(Page, {
			props: props({ activity: { ok: true, value: [{ ...ROW, actor_kind: 'admin_token', actor_email: 'ana@example.com' }] } }),
		});
		expect(actor(container)).toBe('ana@example.com through an admin token');
	});

	it('shows a person by their email, with no note', () => {
		const { container } = render(Page, {
			props: props({ activity: { ok: true, value: [{ ...ROW, actor_kind: 'user', actor_email: 'ana@example.com' }] } }),
		});
		expect(actor(container)).toBe('ana@example.com');
	});

	it('reads a null kind on a row written before the upgrade as the person it names', () => {
		const { container } = render(Page, {
			props: props({ activity: { ok: true, value: [{ ...ROW, actor_kind: null, actor_email: 'ana@example.com' }] } }),
		});
		expect(actor(container)).toBe('ana@example.com');
		expect(screen.getByRole('link', { name: 'ana@example.com' }).getAttribute('href')).toContain('actor=22222222');
	});

	it('shows a row with no actor id as unknown, whatever its kind', () => {
		const { container } = render(Page, {
			props: props({ activity: { ok: true, value: [{ ...ROW, actor_id: '', actor_kind: null }] } }),
		});
		expect(actor(container)).toBe('-');
		expect(screen.queryByRole('link', { name: '22222222' })).toBeNull();
	});

	it("reads an older engine's row, with no kind, as a person, as before", () => {
		const { container } = render(Page, { props: props() });
		expect(actor(container)).toBe('22222222');
	});

	it('labels a hard delete apart from an archive, and offers it in the action filter', () => {
		const rows = [
			{ ...ROW, id: 'a1', action: 'deleted' },
			{ ...ROW, id: 'a2', action: 'archived' },
		];
		const { container } = render(Page, { props: props({ activity: { ok: true, value: rows } }) });
		const cells = [...container.querySelectorAll('tbody tr')].map((tr) => said(tr as HTMLElement));
		expect(cells[0]).toContain('Deleted');
		expect(cells[1]).toContain('Archived');
		expect(cells[0]).not.toContain('Archived');
	});

	it('tells an empty filtered list apart from no activity at all', () => {
		const filtered = render(Page, {
			props: props({ activity: { ok: true, value: [] }, total: 0, filter: { ...FILTER, action: 'deleted' } }),
		});
		expect(said(filtered.container)).toContain('No changes match');
		cleanup();
		const none = render(Page, { props: props({ activity: { ok: true, value: [] }, total: 0 }) });
		expect(said(none.container)).toContain('No content changes yet');
	});
});

describe('content activity links', () => {
	it('eases the hover color of every link in a row', () => {
		const { container } = render(Page, {
			props: props({
				activity: {
					ok: true,
					value: [
						{ ...ROW, actor_kind: 'api_key', actor_email: null },
						{ ...ROW, id: 'a2', actor_kind: 'user', actor_email: 'ana@example.com', revision_num: 7, entry_exists: true },
					],
				},
			}),
		});
		expect(screen.getByRole('link', { name: 'Version 7' })).toBeTruthy();
		expect(hoverSnaps(container)).toEqual([]);
	});
});
