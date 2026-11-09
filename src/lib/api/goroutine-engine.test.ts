import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@lyeve-labs/client';
import {
	byOwnerRows,
	durationMs,
	parseAsyncHooksForm,
	parseParallelForm,
	parsePoolForm,
	readGoroutineEngine,
	readTuningLicensed,
} from '$lib/api/goroutine-engine';

function clientAnswering(tuning: () => Response) {
	const fetch = vi.fn(async (url: string) => {
		if (String(url).endsWith('/debug/goroutines/tuning')) return tuning();
		return new Response(JSON.stringify({ total: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
	}) as unknown as typeof globalThis.fetch;
	return createClient(fetch, {});
}

const answer = (body: unknown, status = 200) => () =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('readTuningLicensed', () => {
	it('reads the flag the plugin sends', async () => {
		expect(await readTuningLicensed(clientAnswering(answer({ licensed: true })))).toBe(true);
		expect(await readTuningLicensed(clientAnswering(answer({ licensed: false })))).toBe(false);
	});

	// An older plugin has no such route, and a failed read says nothing about
	// the license. Both keep the forms, and a refused write still says 402.
	it('reads a 404, a failure or a body without the flag as licensed', async () => {
		expect(await readTuningLicensed(clientAnswering(answer({ error: 'not found' }, 404)))).toBe(true);
		expect(await readTuningLicensed(clientAnswering(answer({ error: 'unavailable' }, 503)))).toBe(true);
		expect(await readTuningLicensed(clientAnswering(answer({})))).toBe(true);
		expect(
			await readTuningLicensed(
				clientAnswering(() => {
					throw new TypeError('network down');
				}),
			),
		).toBe(true);
	});

	it('travels with the four views', async () => {
		const views = await readGoroutineEngine(clientAnswering(answer({ licensed: false })));
		expect(views.licensed).toBe(false);
		expect(views.snapshot).toEqual({ total: 1 });
	});
});

function form(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return data;
}

describe('byOwnerRows', () => {
	it('ranks owners by count, the largest first, and by name on a tie', () => {
		const rows = byOwnerRows({
			total: 9,
			by_owner: {
				engine: { total: 2, oldest: '1s' },
				cron: { total: 5, oldest: '1m2.5s' },
				audit: { total: 2, oldest: '4s' },
			},
		});
		expect(rows.map((r) => r.owner)).toEqual(['cron', 'audit', 'engine']);
		expect(rows[0]).toEqual({ owner: 'cron', total: 5, oldest: '1m2.5s' });
	});

	it('is empty when the engine sent no tracker', () => {
		expect(byOwnerRows({ total: 40 })).toEqual([]);
		expect(byOwnerRows(null)).toEqual([]);
	});

	it('tolerates a count that is not a number', () => {
		expect(byOwnerRows({ total: 1, by_owner: { x: { total: 'many' as never, oldest: 3 as never } } })).toEqual([
			{ owner: 'x', total: 0, oldest: '' },
		]);
	});
});

describe('durationMs', () => {
	it('reads the grammar the engine parses', () => {
		expect(durationMs('30s')).toBe(30_000);
		expect(durationMs('1m2.5s')).toBe(62_500);
		expect(durationMs('1h')).toBe(3_600_000);
		expect(durationMs('500ms')).toBe(500);
	});

	it('refuses a bare number, a stray unit and nothing', () => {
		for (const raw of ['30', 's', '', '30 s', '1d', 'fast']) expect(durationMs(raw), raw).toBeNull();
	});
});

describe('the tunable forms', () => {
	it('sends the pool size inside its bounds', () => {
		expect(parsePoolForm(form({ size: '200' }))).toEqual({ body: { size: 200 } });
	});

	it('refuses a pool size outside the bounds or not a whole number', () => {
		for (const size of ['0', '4097', '1.5', 'many', '']) {
			const parsed = parsePoolForm(form({ size }));
			expect('error' in parsed, size).toBe(true);
		}
		expect(parsePoolForm(form({ size: '5000' }))).toEqual({ error: 'Enter a value from 1 to 4096 for pool size.' });
	});

	it('sends the parallel ceiling and timeout, and refuses a timeout over an hour', () => {
		expect(parseParallelForm(form({ max_concurrent: '16', timeout: '45s' }))).toEqual({ body: { max_concurrent: 16, timeout: '45s' } });
		expect(parseParallelForm(form({ max_concurrent: '16', timeout: '61m' }))).toEqual({ error: 'Enter at most 1h for timeout.' });
		expect(parseParallelForm(form({ max_concurrent: '16', timeout: '0s' }))).toEqual({ error: 'Enter a duration longer than zero for timeout.' });
		expect(parseParallelForm(form({ max_concurrent: '2000', timeout: '1s' }))).toEqual({ error: 'Enter a value from 1 to 1024 for max concurrent.' });
	});

	it('sends the async hook queue with the switch read from the checkbox', () => {
		expect(parseAsyncHooksForm(form({ workers: '8', queue_size: '2048', timeout: '5s', enabled: 'on' }))).toEqual({
			body: { workers: 8, queue_size: 2048, timeout: '5s', enabled: true },
		});
		// An unchecked box sends nothing, which is off.
		expect(parseAsyncHooksForm(form({ workers: '8', queue_size: '2048', timeout: '5s' }))).toEqual({
			body: { workers: 8, queue_size: 2048, timeout: '5s', enabled: false },
		});
		expect(parseAsyncHooksForm(form({ workers: '8', queue_size: '70000', timeout: '5s' }))).toEqual({ error: 'Enter a value from 1 to 65536 for queue size.' });
		expect(parseAsyncHooksForm(form({ workers: '8', queue_size: '64', timeout: '11m' }))).toEqual({ error: 'Enter at most 10m for timeout.' });
	});
});
