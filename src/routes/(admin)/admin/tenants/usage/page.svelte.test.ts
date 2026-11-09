// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import UsagePage from './+page.svelte';

afterEach(cleanup);

const MIRA = '24d6560b-540e-47b6-8957-59934db4021d';

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const request = (requested_by: string) => ({
	id: 'q1',
	tenant_id: 'default',
	requested_by,
	requests_limit: 100000,
	reason: 'Launch traffic in November',
	status: 'pending',
	reviewed_by: '',
	created_at: '2026-10-11T18:36:49Z',
});

const props = (over: Record<string, unknown> = {}) => ({
	data: {
		user: { id: 'u1', email: 'admin@example.com', roles: ['super_admin'] },
		quotas: [],
		quotaTotal: 0,
		limit: 50,
		offset: 0,
		requests: { ok: true, value: [request(MIRA)] },
		requestTotal: 1,
		usage: { ok: true, value: [] },
		people: { [MIRA]: 'mira.costa@example.com' },
		gate: { state: 'ok' },
		permitted: true,
		...over,
	} as never,
	form: null as never,
});

describe('Requests for more', () => {
	it('names the requester by email', () => {
		const { container } = render(UsagePage, { props: props() });
		const text = said(container);
		expect(text).toContain('by mira.costa@example.com');
		expect(text).not.toContain(MIRA);
	});

	it('keeps a short id for an account the directory did not answer', () => {
		const { container } = render(UsagePage, { props: props({ people: {} }) });
		const text = said(container);
		expect(text).toContain('by 24d6560b');
		expect(text).not.toContain(MIRA);
	});
});

describe('Quotas when the usage could not be read', () => {
	const quota = {
		id: 'q1',
		tenant_id: 'acme',
		requests_limit: 1000,
		storage_bytes_limit: 0,
		bandwidth_bytes_limit: 0,
		is_hard_limit: true,
		block_on_exceeded: true,
		grace_period_hours: 0,
		warn_at_pct_80: true,
		warn_at_pct_90: true,
		blocked_at: null,
	};

	it('says so over the table rather than drawing rows that used nothing', () => {
		const { container } = render(UsagePage, {
			props: props({ quotas: [quota], quotaTotal: 1, usage: { ok: false, gate: { state: 'error', message: 'Could not load usage per tenant.' } } }),
		});
		expect(said(container)).toContain('Could not load usage per tenant');
		cleanup();
		const answered = render(UsagePage, { props: props({ quotas: [quota], quotaTotal: 1 }) });
		expect(said(answered.container)).not.toContain('Could not load usage per tenant');
	});
});

/*
 * Every form on the page shares one action result. A drawer that read it
 * whole showed a failed review in the next New quota form as if that form had
 * failed.
 */
describe('the quota drawer and the failures of other actions', () => {
	const drawerText = () => document.body.querySelector('form#quota-form')?.textContent ?? '';

	it('leaves a newly opened quota drawer clean after a failed review', async () => {
		const { container, getAllByRole } = render(UsagePage, {
			props: { ...props(), form: { action: 'review', error: 'Could not review the request. Try again.' } as never },
		});
		expect(said(container)).toContain('Could not review the request. Try again.');
		await fireEvent.click(getAllByRole('button', { name: /new quota/i })[0]);
		expect(drawerText()).not.toContain('Could not review the request');
	});

	// The two warning switches sat 16px apart, so the second one's touch hit
	// area took the bottom of the first one's. They are spaced the way the SAML
	// form spaces its switches, by the group that holds them.
	it('spaces the two warning switches so each keeps its touch hit area', async () => {
		const { getAllByRole } = render(UsagePage, { props: props() });
		await fireEvent.click(getAllByRole('button', { name: /new quota/i })[0]);
		const warn80 = document.body.querySelector('#quota-warn80')?.closest('label') as HTMLElement;
		const warn90 = document.body.querySelector('#quota-warn90')?.closest('label') as HTMLElement;
		const group = warn90.parentElement as HTMLElement;
		expect(warn80.parentElement).toBe(group);
		expect(group.className.split(/\s+/)).toEqual(expect.arrayContaining(['gap-4', 'coarse:gap-6']));
		expect(warn90.className).not.toContain('coarse:mt-2');
	});

	it('shows a failed save inside the open drawer', async () => {
		const { getAllByRole, rerender } = render(UsagePage, { props: props() });
		await fireEvent.click(getAllByRole('button', { name: /new quota/i })[0]);
		await rerender({ ...props(), form: { action: 'quota', error: 'Could not save the quota. Try again.' } as never });
		expect(drawerText()).toContain('Could not save the quota. Try again.');
	});
});

describe('the quota list', () => {
	const quota = (tenant_id: string) => ({
		id: `q-${tenant_id}`,
		tenant_id,
		requests_limit: 1000,
		storage_bytes_limit: 0,
		bandwidth_bytes_limit: 0,
		is_hard_limit: true,
		block_on_exceeded: true,
		grace_period_hours: 0,
		warn_at_pct_80: true,
		warn_at_pct_90: true,
		blocked_at: null,
	});

	it('narrows the page by the typed tenant', async () => {
		const { container } = render(UsagePage, { props: props({ quotas: [quota('acme'), quota('globex')], quotaTotal: 2 }) });
		await fireEvent.input(container.querySelector('#quota-search') as HTMLInputElement, { target: { value: 'glob' } });
		const rows = [...container.querySelectorAll('table[aria-label="Quotas"] tbody tr, [aria-label="Quotas"] tbody tr')].map((tr) => tr.textContent ?? '');
		expect(rows.some((t) => t.includes('globex'))).toBe(true);
		expect(rows.some((t) => t.includes('acme'))).toBe(false);
	});

	it('offers the first quota from the empty list', () => {
		const { getAllByRole } = render(UsagePage, { props: props() });
		expect(getAllByRole('button', { name: /new quota/i })).toHaveLength(2);
	});
});

describe('the page for an admin', () => {
	const admin = { user: { id: 'u2', email: 'ada@example.com', roles: ['admin'] } };
	const own = {
		id: 'q-acme',
		tenant_id: 'acme',
		requests_limit: 1000,
		storage_bytes_limit: 0,
		bandwidth_bytes_limit: 0,
		is_hard_limit: true,
		block_on_exceeded: true,
		grace_period_hours: 0,
		warn_at_pct_80: true,
		warn_at_pct_90: true,
		blocked_at: null,
	};

	it("shows the tenant's own quota and requests, and offers no write", () => {
		const { container, queryAllByRole } = render(UsagePage, { props: props({ ...admin, quotas: [own], quotaTotal: 1 }) });
		expect(said(container)).toContain('acme');
		expect(said(container)).toContain('Launch traffic in November');
		expect(said(container)).toContain('Only a super admin can set a quota or review a request.');
		expect(queryAllByRole('button', { name: /new quota/i })).toHaveLength(0);
		expect(queryAllByRole('button', { name: /edit the quota/i })).toHaveLength(0);
		expect(queryAllByRole('button', { name: /approve|deny/i })).toHaveLength(0);
	});
});

describe('a license without paid quotas', () => {
	const stored = {
		id: 'q-acme',
		tenant_id: 'acme',
		requests_limit: 1000,
		storage_bytes_limit: 1234567,
		bandwidth_bytes_limit: 0,
		is_hard_limit: false,
		block_on_exceeded: true,
		grace_period_hours: 0,
		warn_at_pct_80: true,
		warn_at_pct_90: true,
		blocked_at: null,
	};
	const refused = {
		action: 'quota',
		error: 'x',
		refused: { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' },
	};

	it('holds the paid fields and Approve with the reason once a write is refused', async () => {
		const { getByRole, rerender } = render(UsagePage, { props: props({ quotas: [stored], quotaTotal: 1 }) });
		await rerender({ ...props({ quotas: [stored], quotaTotal: 1 }), form: refused as never });
		expect((getByRole('button', { name: /approve the request/i }) as HTMLButtonElement).disabled).toBe(true);
		expect((getByRole('button', { name: /deny the request/i }) as HTMLButtonElement).disabled).toBe(false);
		expect(said(document.body)).toContain('turn on enforcement or approve a request');

		await fireEvent.click(getByRole('button', { name: 'Edit the quota for acme' }));
		const field = (id: string) => document.body.querySelector<HTMLInputElement>(`#${id}`);
		expect(field('quota-requests')?.disabled).toBe(true);
		expect(field('quota-storage')?.disabled).toBe(true);
		// Turning enforcement off needs no license, turning it on does.
		expect(field('quota-block')?.disabled).toBe(false);
		expect(field('quota-hard')?.disabled).toBe(true);
	});

	it('posts the stored bytes of a limit left as it was', async () => {
		const { getByRole } = render(UsagePage, { props: props({ quotas: [stored], quotaTotal: 1 }) });
		await fireEvent.click(getByRole('button', { name: 'Edit the quota for acme' }));
		const form = document.body.querySelector<HTMLFormElement>('form#quota-form');
		const posted = new FormData(form!);
		expect(posted.get('storage_bytes_limit')).toBe('1234567');
		expect(posted.get('requests_limit')).toBe('1000');
		expect(said(document.body)).toContain('Storage (GB)');
	});

	// The footer ends with Cancel and Save. Delete sits alone at its start
	// edge, so a hurried press near Save never removes the quota.
	it('sets Delete apart at the start of the footer, before Cancel and Save', async () => {
		const { getByRole } = render(UsagePage, { props: props({ quotas: [stored], quotaTotal: 1 }) });
		await fireEvent.click(getByRole('button', { name: 'Edit the quota for acme' }));
		const labels = [...document.body.querySelectorAll('button')]
			.map((b) => b.textContent?.trim())
			.filter((t) => t === 'Delete' || t === 'Cancel' || t === 'Save');
		expect(labels).toEqual(['Delete', 'Cancel', 'Save']);
		const remove = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Delete');
		expect(remove?.classList.contains('me-auto')).toBe(true);
	});
});

describe('What the usage figures count', () => {
	it('says the request counts cover API-key traffic only', () => {
		const { getByTestId } = render(UsagePage, { props: props() });
		const line = said(getByTestId('usage-scope'));
		expect(line).toContain('requests made with an API key only');
		expect(line).toContain('Requests from a signed-in session are not counted.');
	});
});
