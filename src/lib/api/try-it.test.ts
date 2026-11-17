import { describe, expect, it } from 'vitest';
import { isRunnable, presentBody, refuse, unfilledParameters } from './try-it';
import { CONTENT_API_URL, ENGINE_URL, engineOriginFor } from '#lib/server/engine.ts';

/*
 * A try-it that fires a DELETE performs a real delete against real tenant
 * data, on a page that looks like documentation rather than like a console.
 * The gate is most of the feature.
 */
describe('refuse', () => {
	const read = { method: 'GET', path: '/api/v1/schemas' };

	it('lets a read through with no ceremony', () => {
		expect(refuse(read)).toBeNull();
	});

	it('refuses a write to a session that may not send one', () => {
		const r = refuse({ method: 'DELETE', path: '/api/v1/content/post/1', canWrite: false });
		expect(r?.reason).toContain('super admin');
	});

	it('refuses a write nobody acknowledged, even from a super admin', () => {
		const r = refuse({ method: 'DELETE', path: '/api/v1/content/post/1', canWrite: true });
		expect(r?.reason).toContain('changes data');
	});

	it('sends a write that was acknowledged for this call', () => {
		expect(
			refuse({
				method: 'DELETE',
				path: '/api/v1/content/post/1',
				canWrite: true,
				acknowledged: true,
			}),
		).toBeNull();
	});

	// Sent as written, this asks the engine for a record whose id is the
	// literal text "{id}". It answers 404 and reads as the endpoint being
	// broken rather than as a value being missing.
	it('refuses a path that is still a template, and names what is missing', () => {
		const r = refuse({ method: 'GET', path: '/api/admin/users/{id}' });
		expect(r?.reason).toContain('{id}');
	});

	it('refuses a method it will not send', () => {
		expect(refuse({ method: 'TRACE', path: '/x' })?.reason).toContain('TRACE');
		expect(refuse({ method: 'CONNECT', path: '/x' })?.reason).toBeTruthy();
	});

	it('refuses a path that is not one', () => {
		expect(refuse({ method: 'GET', path: 'api/v1/schemas' })?.reason).toContain('slash');
	});
});

describe('isRunnable', () => {
	it('knows the methods the engine actually serves', () => {
		for (const m of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
			expect(isRunnable(m), m).toBe(true);
		}
		for (const m of ['TRACE', 'OPTIONS', 'CONNECT', '']) {
			expect(isRunnable(m), m).toBe(false);
		}
	});

	it('does not care about case', () => {
		expect(isRunnable('get')).toBe(true);
	});
});

describe('unfilledParameters', () => {
	it('names every placeholder left in the path', () => {
		expect(unfilledParameters('/api/v1/content/{schema}/{id}')).toEqual(['schema', 'id']);
		expect(unfilledParameters('/api/v1/schemas')).toEqual([]);
	});
});

describe('presentBody', () => {
	it('shapes JSON so the reader can see it', () => {
		expect(presentBody('{"a":1}', 'application/json')).toBe('{\n  "a": 1\n}');
	});

	it('leaves anything else exactly as it came', () => {
		expect(presentBody('plain text', 'text/plain')).toBe('plain text');
	});

	// A 500 from a proxy is HTML, and a reader needs to see that rather than a
	// parse error about it.
	it('leaves a body that claims JSON and is not', () => {
		expect(presentBody('<html>502</html>', 'application/json')).toBe('<html>502</html>');
	});
});

/*
 * Which listener a path belongs to.
 *
 * The engine binds /api/admin on one address and everything under /api/v1 on
 * another, and a deployment may put them on different hosts. A relative fetch
 * from a server action resolves against SvelteKit's own router first, so each
 * path is sent to the listener that serves it.
 */
describe('engineOriginFor', () => {
	it('sends an admin path to the admin listener', () => {
		expect(engineOriginFor('/api/admin/schemas')).toBe(ENGINE_URL);
		expect(engineOriginFor('/api/admin/users/1')).toBe(ENGINE_URL);
	});

	it('sends a content path to the content listener', () => {
		expect(engineOriginFor('/api/v1/schemas')).toBe(CONTENT_API_URL);
		expect(engineOriginFor('/api/v1/content/post')).toBe(CONTENT_API_URL);
	});

	// The split the dev proxy and the deployment proxy both make: /api/admin is
	// the admin one and every other path under /api is the content one.
	it('sends anything else under /api to the content listener', () => {
		expect(engineOriginFor('/api/flows/hook/abc')).toBe(CONTENT_API_URL);
		expect(engineOriginFor('/robots.txt')).toBe(CONTENT_API_URL);
	});

	// The two must differ by default, or the split routes nothing.
	it('the two listeners are not the same address by default', () => {
		expect(ENGINE_URL).not.toBe(CONTENT_API_URL);
	});
});
