import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { actions as month } from './+page.server';
import { actions as budgets } from './budgets/+page.server';
import { actions as prices } from './prices/+page.server';

// Each write lives on the route of the tab that makes it.
const actions = { ...month, ...budgets, ...prices };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return {
		get: vi.fn(() => 'tok'),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

/** An action event whose fetch answers the session read as `roles`, then `answer` for the write. */
function writeEvent(fields: Record<string, string>, answer: () => Response, roles = ['admin']) {
	const form = new FormData();
	form.set('confirmed', 'yes');
	for (const [key, value] of Object.entries(fields)) form.append(key, value);
	const written = vi.fn(answer);
	const fetch = vi.fn(async (url: string, init?: RequestInit) =>
		String(url).includes('/auth/me') ? json({ id: 'u1', email: 'a@example.com', roles }) : written(),
	) as unknown as typeof globalThis.fetch;
	return {
		written,
		event: {
			request: { formData: async () => form, clone: () => ({ formData: async () => form }) },
			fetch,
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/tenants/costs'),
		} as never,
	};
}

const BUDGET = {
	name: 'Storage cap',
	amount: '250',
	period: 'monthly',
	period_start: '2026-10-01',
	period_end: '2026-10-31',
};
const PRICE = { resource_type: 'storage', unit_price: '0.09', per_units: '1073741824' };

/**
 * Each write with the fields that pass the form's own checks, and the tag its
 * result carries. The budget writes name their action, because the budgets
 * page reads its drawer's failure through the shared helper that reads it.
 */
const WRITES = {
	createBudget: { fields: BUDGET, tag: { action: 'createBudget' }, saved: { action: 'createBudget', saved: true } },
	deleteBudget: { fields: { id: 'b1' }, tag: { action: 'deleteBudget' }, saved: { action: 'deleteBudget', saved: true } },
	putPrice: { fields: PRICE, tag: { form: 'price' }, saved: { form: 'price', saved: true } },
	resetPrice: { fields: { resource_type: 'storage' }, tag: { form: 'price' }, saved: { form: 'price', saved: true } },
	aggregate: { fields: {}, tag: { form: 'aggregate' }, saved: { form: 'aggregate', saved: true } },
} as const;

const NAMES = Object.keys(WRITES) as (keyof typeof WRITES)[];

describe('tenant costs writes', () => {
	it.each(NAMES)('%s reports a write the plugin accepts', async (name) => {
		const { event, written } = writeEvent(WRITES[name].fields, () => json({ id: 'b1', entries_written: 0 }));
		expect(await actions[name](event)).toMatchObject(WRITES[name].saved);
		expect(written).toHaveBeenCalledTimes(1);
	});

	it.each(NAMES)('%s relays a refusal under its own form', async (name) => {
		const { event } = writeEvent(WRITES[name].fields, () => json({ error: 'budget not found', code: 'not_found' }, 404));
		expect(await actions[name](event)).toEqual({
			status: 400,
			data: { ...WRITES[name].tag, error: 'budget not found', locked: false },
		});
	});

	it.each(NAMES)('%s says the ledger is not enabled on a license refusal', async (name) => {
		const { event } = writeEvent(WRITES[name].fields, () => json({ error: 'payment_required', feature: 'feature:example_feature' }, 402));
		expect(await actions[name](event)).toMatchObject({ status: 402, data: { ...WRITES[name].tag, locked: true } });
	});

	it.each(NAMES)('%s keeps driver text out of an outage', async (name) => {
		const { event } = writeEvent(WRITES[name].fields, () => json({ error: 'pq: connection refused' }, 503));
		const result = (await actions[name](event)) as { data: { error: string } };
		expect(result.data.error).not.toContain('pq:');
	});

	it.each(NAMES)('%s is refused to an editor before anything is written', async (name) => {
		const { event, written } = writeEvent(WRITES[name].fields, () => json({}), ['editor']);
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(written).not.toHaveBeenCalled();
	});
});
