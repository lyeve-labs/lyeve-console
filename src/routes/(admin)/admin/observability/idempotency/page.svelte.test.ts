// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdempotencyKey } from '#lib/api/idempotency.ts';

type Submit = (input: { cancel: () => void }) => Promise<unknown>;
const forms = vi.hoisted(() => ({ submits: [] as unknown[] }));
vi.mock('$app/forms', () => ({
	enhance: (_form: HTMLFormElement, submit: unknown) => {
		forms.submits.push(submit);
		return { destroy() {} };
	},
}));

const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, confirm: kit.confirm };
});

import IdempotencyPage from './+page.svelte';

afterEach(cleanup);
beforeEach(() => {
	forms.submits = [];
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
});

function key(over: Partial<IdempotencyKey> = {}): IdempotencyKey {
	return {
		key: 'order-17',
		method: 'POST',
		path: '/api/v1/content/orders',
		completed: false,
		replay_count: 0,
		created_at: new Date().toISOString(),
		...over,
	};
}

const props = (over: Record<string, unknown> = {}) => ({
	data: {
		keys: [key(), key({ key: 'invoice-9', completed: true, path: '/api/v1/content/invoices' })],
		total: 2,
		limit: 50,
		offset: 0,
		hasMore: false,
		q: '',
		show: '',
		stats: { total: 2, completed: 1, in_flight: 1 },
		statsRead: true,
		gate: { state: 'ok' },
		...over,
	} as never,
	form: null as never,
});

describe('releasing a key', () => {
	it('names the key in the confirmation title', async () => {
		render(IdempotencyPage, { props: props() });
		const cancel = vi.fn();
		await (forms.submits[0] as Submit)({ cancel });
		expect(kit.confirm).toHaveBeenCalledWith('Release the key order-17?', expect.any(String), { confirmLabel: 'Release' });
		expect(cancel).toHaveBeenCalled();
	});
});

describe('the key toolbar', () => {
	it('offers to clear filters that match nothing, rather than saying no key was sent', () => {
		const { container } = render(IdempotencyPage, { props: props({ keys: [], total: 0, q: 'invoice', show: 'open' }) });
		expect(container.textContent).toContain('No keys match these filters');
		expect(container.textContent).not.toContain('Keys appear here');
		expect(container.querySelector('a[href="/admin/observability/idempotency"]')?.textContent?.trim()).toBe('Clear filters');
	});

	it('keeps the search on each show link', () => {
		const { container } = render(IdempotencyPage, { props: props({ q: 'invoice' }) });
		const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toContain('/admin/observability/idempotency?show=open&q=invoice');
		expect(hrefs).toContain('/admin/observability/idempotency?q=invoice');
	});
});

describe('a refused counters read', () => {
	it('says the role cannot read them rather than that the read failed', () => {
		const { container } = render(IdempotencyPage, {
			props: props({ stats: null, statsRead: false, statsGate: { state: 'forbidden' } }),
		});
		expect(container.textContent).toContain('Your role cannot open the counters');
	});
});

describe('the key search box', () => {
	it('is named for a screen reader', () => {
		const { container } = render(IdempotencyPage, { props: props() });
		expect(container.querySelector('label[for="key-search"]')?.textContent).toBe('Search keys');
	});
});
