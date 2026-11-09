import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { CatalogError } from '$lib/api/assist';
import { assistRefusal, catalogFor, refusalStatus } from './flow-assist';

describe('assistRefusal', () => {
	// The client puts the raw body of an answer that was not JSON in the
	// message, so a proxy's 503 page would be relayed as the engine's sentence.
	it('relays a 503 only when the engine sent it', () => {
		expect(assistRefusal(new ApiError(503, '<html><h1>503 Service Unavailable</h1></html>'))).toEqual({
			state: 'error',
			message: 'The assistant did not answer. Try again.',
		});
	});

	it('maps the two gates, the validator and the rest', () => {
		expect(assistRefusal(new ApiError(402, 'ai is not enabled'))).toEqual({ state: 'locked' });
		expect(assistRefusal(new ApiError(404, 'not found'))).toEqual({ state: 'off' });
		expect(assistRefusal(new ApiError(503, 'flow validator is not registered', { error: 'flow validator is not registered' }))).toEqual({ state: 'unavailable', message: 'flow validator is not registered' });
		expect(assistRefusal(new ApiError(503, '', {}))).toEqual({ state: 'unavailable', message: 'The flow validator is not available on this engine.' });
		expect(assistRefusal(new ApiError(422, 'prompt is too long', { error: 'prompt is too long', code: 'http_422' }))).toEqual({ state: 'error', message: 'prompt is too long' });
		// A 4xx with no code came from something in front of the engine.
		expect(assistRefusal(new ApiError(413, 'Request Entity Too Large'))).toEqual({ state: 'error', message: 'The assistant did not answer. Try again.' });
		expect(assistRefusal(new ApiError(500, 'pq: connection refused'))).toEqual({ state: 'error', message: 'The assistant did not answer. Try again.' });
		expect(assistRefusal(new Error('boom'))).toEqual({ state: 'error', message: 'The assistant did not answer. Try again.' });
	});

	it('reads a spent budget as an error that keeps the prompt live, not as the license', () => {
		const budget = new ApiError(402, 'ai budget exhausted for this billing period', { error: 'ai budget exhausted for this billing period', code: 'http_402' });
		const refusal = assistRefusal(budget);
		expect(refusal.state).toBe('error');
		expect((refusal as { message: string }).message).toContain('budget for this billing period is spent');
		const license = new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'ai', feature: 'feature:ai', upgrade_url: '' });
		expect(assistRefusal(license)).toEqual({ state: 'locked' });
		const other = new ApiError(402, 'this request needs a paid plan', { error: 'this request needs a paid plan', code: 'http_402' });
		expect(assistRefusal(other)).toEqual({ state: 'locked' });
	});

	it('reads a missing catalog route as unavailable and a 402 on it as locked', () => {
		expect(assistRefusal(new CatalogError(404, 'not found'))).toMatchObject({ state: 'unavailable' });
		expect(assistRefusal(new CatalogError(402, 'ai is not enabled'))).toEqual({ state: 'locked' });
		expect(assistRefusal(new CatalogError(500, 'pq: x'))).toEqual({ state: 'error', message: 'Could not load the node catalog. Try again.' });
	});

	it('names a timed-out model', () => {
		const err = new Error('timed out');
		err.name = 'TimeoutError';
		expect(assistRefusal(err).state).toBe('error');
		expect((assistRefusal(err) as { message: string }).message).toContain('too long');
	});

	it('answers each refusal with its status', () => {
		expect(refusalStatus({ state: 'locked' })).toBe(402);
		expect(refusalStatus({ state: 'off' })).toBe(404);
		expect(refusalStatus({ state: 'unavailable', message: '' })).toBe(503);
		expect(refusalStatus({ state: 'error', message: '' })).toBe(400);
	});
});

describe('catalogFor', () => {
	it('reads the catalog once per request and again for the next', async () => {
		const fetch = vi.fn(async () => new Response('# Nodes', { status: 200 }));
		const cookies = { get: () => 'tok' };
		const first = { request: new Request('http://localhost/x'), fetch: fetch as unknown as typeof globalThis.fetch, cookies };
		expect(await Promise.all([catalogFor(first), catalogFor(first)])).toEqual(['# Nodes', '# Nodes']);
		expect(fetch).toHaveBeenCalledTimes(1);
		const second = { ...first, request: new Request('http://localhost/y') };
		expect(await catalogFor(second)).toBe('# Nodes');
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
