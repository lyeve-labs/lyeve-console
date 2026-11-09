import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { flowLoadOutcome } from './flow-load';

function cookies(): Cookies {
	return { get: vi.fn(), set: vi.fn(), delete: vi.fn(), getAll: vi.fn(() => []), serialize: vi.fn(() => '') } as unknown as Cookies;
}

describe('flowLoadOutcome', () => {
	it('sends a 401 to the login page after clearing the session cookie', () => {
		const jar = cookies();
		expect(() => flowLoadOutcome(new ApiError(401, 'unauthorized'), { cookies: jar }, 'flows')).toThrow(
			expect.objectContaining({ status: 302, location: '/login' })
		);
		expect(jar.delete).toHaveBeenCalledWith('__Host-sys_session', expect.objectContaining({ path: '/', secure: true }));
	});

	it('clears the plain session cookie on a plain-HTTP console', () => {
		const jar = cookies();
		expect(() => flowLoadOutcome(new ApiError(401, 'unauthorized'), { cookies: jar, url: new URL('http://localhost:5173/admin/flows') }, 'flows')).toThrow(
			expect.objectContaining({ status: 302, location: '/login' })
		);
		expect(jar.delete).toHaveBeenCalledWith('sys_session', expect.objectContaining({ path: '/', secure: false }));
	});

	it('locks the page on a 402 with no banner', () => {
		expect(flowLoadOutcome(new ApiError(402, 'payment required'), { cookies: cookies() }, 'flows')).toEqual({ locked: true, loadError: null });
	});

	it('names the role on a 403', () => {
		expect(flowLoadOutcome(new ApiError(403, 'forbidden'), { cookies: cookies() }, 'datasources')).toEqual({
			locked: false,
			loadError: 'Your role does not allow you to open datasources. Ask a super admin to grant it.',
		});
	});

	it('keeps the engine banner for a 5xx, a network failure and a status it does not expect', () => {
		for (const err of [new ApiError(503, 'pq: connection refused'), new TypeError('fetch failed'), new ApiError(418, 'teapot')]) {
			const out = flowLoadOutcome(err, { cookies: cookies() }, 'variables');
			expect(out).toEqual({ locked: false, loadError: 'Could not load variables.' });
			expect(out.loadError).not.toContain('pq:');
		}
	});
});
