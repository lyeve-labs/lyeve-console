import { describe, expect, it } from 'vitest';
import { actions, load } from './+page.server';
import { fixturePrice } from '$lib/components/ai/test-support/fixtures';
import { actionEvent, formOf, json, loadEvent, refused, sentBody } from '$lib/components/ai/test-support/events';

const path = '/admin/ai/prices';
type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

describe('admin/ai/prices load', () => {
	it('lists the table', async () => {
		const { event } = loadEvent({ '/api/admin/ai/prices': () => json({ prices: [fixturePrice] }) }, { path });
		const out = (await load(event)) as Loaded;
		expect(out.prices).toEqual([fixturePrice]);
	});

	it.each([
		[402, 'locked'],
		[403, 'forbidden'],
		[404, 'off'],
		[503, 'no_provider'],
	])('sorts a %i into the %s state', async (status, state) => {
		const { event } = loadEvent({ '/api/admin/ai/prices': () => refused(status, status === 503 ? 'no enabled AI provider configured' : 'refused') }, { path });
		const out = (await load(event)) as Loaded;
		expect(out.gate.state).toBe(state);
		expect(out.prices).toEqual([]);
	});
});

describe('admin/ai/prices actions', () => {
	it('puts a row under its kind and model', async () => {
		const { event, calls } = actionEvent(
			{ '/api/admin/ai/prices/openai/gpt-4o': () => json(fixturePrice) },
			formOf({ kind: 'openai', model: 'gpt-4o', input_per_1k: '0.0025', output_per_1k: '0.01', image_per_call: '' }),
			{ path }
		);
		expect(await actions.save(event)).toEqual({ key: 'openai/gpt-4o', saved: true });
		const call = calls.find((c) => c.url.includes('/ai/prices/'));
		expect(call?.init?.method).toBe('PUT');
		expect(sentBody(calls, '/ai/prices/')).toEqual({ input_per_1k: 0.0025, output_per_1k: 0.01, image_per_call: 0 });
	});

	it('encodes a model name with a slash in it', async () => {
		const { event, calls } = actionEvent(
			{ '/api/admin/ai/prices/': () => json(fixturePrice) },
			formOf({ kind: 'openai_compatible', model: 'meta/llama-3', input_per_1k: '0' }),
			{ path }
		);
		await actions.save(event);
		expect(calls.find((c) => c.url.includes('/ai/prices/'))?.url).toContain('/openai_compatible/meta%2Fllama-3');
	});

	it('refuses a bad kind, a blank model and a negative price before the engine is asked', async () => {
		const cases: Record<string, string>[] = [
			{ kind: 'nope', model: 'x' },
			{ kind: 'openai', model: '' },
			{ kind: 'openai', model: 'x', input_per_1k: '-1' },
		];
		for (const fields of cases) {
			const { event, calls } = actionEvent({}, formOf(fields), { path });
			expect(await actions.save(event)).toMatchObject({ status: 400 });
			expect(calls.some((c) => c.url.includes('/ai/prices'))).toBe(false);
		}
	});

	it('is a super admin write', async () => {
		const { event } = actionEvent({}, formOf({ kind: 'openai', model: 'x' }), { path, roles: ['admin'] });
		await expect(actions.save(event)).rejects.toMatchObject({ status: 403 });
		await expect(actions.delete(event)).rejects.toMatchObject({ status: 403 });
	});

	it('deletes a row and names the row in the answer', async () => {
		const { event, calls } = actionEvent(
			{ '/api/admin/ai/prices/openai/gpt-4o': () => new Response(null, { status: 204 }) },
			formOf({ kind: 'openai', model: 'gpt-4o' }),
			{ path }
		);
		expect(await actions.delete(event)).toEqual({ key: 'openai/gpt-4o', deleted: true });
		expect(calls.find((c) => c.url.includes('/ai/prices/'))?.init?.method).toBe('DELETE');
	});
});
