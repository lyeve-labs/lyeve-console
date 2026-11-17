// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
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
	it('narrows the rows on this page by key or path', async () => {
		const { container } = render(IdempotencyPage, { props: props() });
		await fireEvent.input(container.querySelector('#key-narrow') as HTMLInputElement, { target: { value: 'invoice' } });
		const rows = [...container.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '');
		expect(rows).toHaveLength(1);
		expect(rows[0]).toContain('invoice-9');
	});

	it('shows only the keys that have not finished', async () => {
		const { container } = render(IdempotencyPage, { props: props() });
		const segment = [...container.querySelectorAll('[role="radio"]')].find((el) => el.textContent?.includes('Not finished'));
		await fireEvent.click(segment as HTMLElement);
		const rows = [...container.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '');
		expect(rows).toHaveLength(1);
		expect(rows[0]).toContain('order-17');
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
		expect(container.querySelector('label[for="key-narrow"]')?.textContent).toBe('Search this page');
	});
});
