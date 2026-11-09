import { describe, expect, it } from 'vitest';
import { error, redirect } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { forbiddenText, fullText, gateOf, isOutage, section } from './gate';

const FAILED = 'Could not load the list.';

/** What fetch rejects with when nothing answers at the engine's address. */
function unreachable(): TypeError {
	return new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
}

/** What the client's own timeout rejects with once the engine takes too long. */
function timedOut(): DOMException {
	return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

describe('gateOf', () => {
	it('calls a 404 absent', () => {
		expect(gateOf(new ApiError(404, 'not found'), FAILED)).toEqual({ state: 'absent' });
	});

	it('calls a 402 not enabled, with the link the refusal names', () => {
		expect(gateOf(new ApiError(402, 'payment_required'), FAILED)).toEqual({ state: 'locked', upgradeUrl: '' });
		const named = new ApiError(402, 'payment_required', { error: 'payment_required', upgrade_url: '/admin/settings/license' });
		expect(gateOf(named, FAILED)).toEqual({ state: 'locked', upgradeUrl: '/admin/settings/license' });
	});

	it('reads a capacity refusal as a ceiling with its numbers, never as a missing feature', () => {
		const full = new ApiError(402, 'cap_exceeded', { error: 'cap_exceeded', cap: 'x', limit: 7, current: 7, upgrade_url: '' });
		expect(gateOf(full, FAILED)).toEqual({ state: 'full', limit: 7, current: 7, upgradeUrl: '' });
		const bare = new ApiError(402, 'cap_exceeded', { error: 'cap_exceeded' });
		expect(gateOf(bare, FAILED)).toEqual({ state: 'full', limit: null, current: null, upgradeUrl: '' });
	});

	it('reads a 403 as the role, not as a failed read', () => {
		expect(gateOf(new ApiError(403, 'insufficient permissions'), FAILED)).toEqual({ state: 'forbidden' });
		const named = new ApiError(403, 'super_admin role required', { error: 'super_admin role required' });
		expect(gateOf(named, FAILED)).toEqual({ state: 'forbidden' });
	});

	it('reads a 429 as the rate, which waiting clears, and not as an outage', () => {
		expect(gateOf(new ApiError(429, 'rate limit exceeded'), FAILED)).toEqual({ state: 'busy' });
	});

	it('reads a 503 as an outage, whatever the engine said about it', () => {
		expect(gateOf(new ApiError(503, 'pq: connection refused'), FAILED)).toEqual({ state: 'unavailable' });
	});

	it('reads a proxy that could not reach the engine as the same outage', () => {
		expect(gateOf(new ApiError(502, 'bad gateway'), FAILED)).toEqual({ state: 'unavailable' });
		expect(gateOf(new ApiError(504, 'gateway timeout'), FAILED)).toEqual({ state: 'unavailable' });
	});

	it('reads a read that never reached the engine as the same outage', () => {
		expect(gateOf(unreachable(), FAILED)).toEqual({ state: 'unavailable' });
		expect(gateOf(new TypeError('Failed to fetch'), FAILED)).toEqual({ state: 'unavailable' });
		expect(gateOf(timedOut(), FAILED)).toEqual({ state: 'unavailable' });
	});

	it('reports anything else as a failed read in the page\'s own words', () => {
		for (const status of [400, 401, 409, 500, 501]) {
			expect(gateOf(new ApiError(status, 'boom'), FAILED)).toEqual({ state: 'error', message: FAILED });
		}
		expect(gateOf(new Error('network'), FAILED)).toEqual({ state: 'error', message: FAILED });
		expect(gateOf(new SyntaxError('Unexpected token < in JSON'), FAILED)).toEqual({ state: 'error', message: FAILED });
		expect(gateOf('down', FAILED)).toEqual({ state: 'error', message: FAILED });
		expect(gateOf(undefined, FAILED)).toEqual({ state: 'error', message: FAILED });
	});

	it('never carries what the engine said into the gate', () => {
		const said = JSON.stringify(gateOf(new ApiError(500, 'pq: relation "sys_jobs" does not exist'), FAILED));
		expect(said).not.toContain('pq:');
	});
});

describe('isOutage', () => {
	it('is a 502, a 503, a 504 or a read that got no answer', () => {
		for (const status of [502, 503, 504]) expect(isOutage(new ApiError(status, 'x'))).toBe(true);
		expect(isOutage(unreachable())).toBe(true);
		expect(isOutage(timedOut())).toBe(true);
	});

	it('is nothing else', () => {
		for (const status of [403, 404, 429, 500, 501]) expect(isOutage(new ApiError(status, 'x'))).toBe(false);
		expect(isOutage(new Error('network'))).toBe(false);
		expect(isOutage(new DOMException('aborted', 'AbortError'))).toBe(false);
		expect(isOutage(null)).toBe(false);
	});
});

describe('section', () => {
	it('carries what the read answered, an empty list included', async () => {
		expect(await section(Promise.resolve([1, 2]), FAILED)).toEqual({ ok: true, value: [1, 2] });
		expect(await section(Promise.resolve([]), FAILED)).toEqual({ ok: true, value: [] });
	});

	it('keeps a failure as its gate and never as an empty value', async () => {
		expect(await section(Promise.reject(new ApiError(503, 'down')), FAILED)).toEqual({
			ok: false,
			gate: { state: 'unavailable' },
		});
		expect(await section(Promise.reject(new ApiError(403, 'insufficient permissions')), FAILED)).toEqual({
			ok: false,
			gate: { state: 'forbidden' },
		});
		expect(await section(Promise.reject(new ApiError(500, 'boom')), FAILED)).toEqual({
			ok: false,
			gate: { state: 'error', message: FAILED },
		});
	});

	it('keeps a failure as the gate a page maps it to', async () => {
		const withheld = (err: unknown) => ({ state: err instanceof ApiError ? 'withheld' : 'error' });
		expect(await section(Promise.reject(new ApiError(403, 'withheld')), withheld)).toEqual({
			ok: false,
			gate: { state: 'withheld' },
		});
	});

	it('answers plain data a load can return', async () => {
		const read = await section(Promise.reject(unreachable()), FAILED);
		expect(JSON.parse(JSON.stringify(read))).toEqual(read);
	});

	it('lets a redirect or an HTTP error thrown on purpose end the load', async () => {
		const away = (async () => redirect(302, '/login'))();
		await expect(section(away, FAILED)).rejects.toMatchObject({ status: 302, location: '/login' });
		const refused = (async () => error(401, 'Session invalid or expired'))();
		await expect(section(refused, FAILED)).rejects.toMatchObject({ status: 401 });
	});
});

describe('fullText', () => {
	it('states the count against the ceiling when both are known', () => {
		expect(fullText({ state: 'full', limit: 7, current: 7, upgradeUrl: '' })).toBe(
			"You're using 7 of 7, the most this engine allows.",
		);
	});

	it('states only what the refusal carried', () => {
		expect(fullText({ state: 'full', limit: 5, current: null, upgradeUrl: '' })).toBe('This engine allows at most 5.');
		expect(fullText({ state: 'full', limit: null, current: null, upgradeUrl: '' })).toBe('This engine is at its limit.');
	});
});

describe('forbiddenText', () => {
	it('names what the role cannot open and who can help', () => {
		expect(forbiddenText('Scheduled jobs')).toBe('Your role cannot open Scheduled jobs. Ask a super admin if you need it.');
	});

	it('names the roles a check admits', () => {
		expect(forbiddenText('this page', ['super_admin'])).toBe('Only a super admin can open this page.');
		expect(forbiddenText('this page', ['super_admin', 'admin'])).toBe('Only an admin or a super admin can open this page.');
	});
});
