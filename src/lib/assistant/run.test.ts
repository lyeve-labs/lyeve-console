import { describe, expect, it } from 'vitest';
import { readRun, runTarget } from './run';

describe('running a proposed request', () => {
	it('takes only an engine path and a method the engine serves', () => {
		expect(readRun({ method: 'put', path: '/api/admin/schemas/articles', body: { a: 1 } })).toEqual({
			method: 'PUT',
			path: '/api/admin/schemas/articles',
			body: { a: 1 },
		});
		for (const path of ['https://evil.example/api/x', '//evil.example/api/x', '/api/../admin', '/api//x', '/admin/x', '/api/x?y=1', '/api/x#y', 'api/x', '/api/%2e%2e/admin/x', '/api/.%2E/x', '/api/x/./y']) {
			expect(readRun({ method: 'GET', path }), path).toBeNull();
		}
		expect(readRun({ method: 'TRACE', path: '/api/x' })).toBeNull();
	});

	it('sends no body with a GET', () => {
		expect(readRun({ method: 'GET', path: '/api/v1/content/articles', body: { a: 1 } })).toEqual({ method: 'GET', path: '/api/v1/content/articles' });
	});

	it('writes the query with repeated keys for a list', () => {
		expect(runTarget({ method: 'GET', path: '/api/v1/content/articles', query: { 'filters[slug]': 'five-habits', populate: ['author', 'category'], limit: 1, skip: null } })).toBe(
			'/api/v1/content/articles?filters%5Bslug%5D=five-habits&populate=author&populate=category&limit=1',
		);
	});

	it('spells an object as name[key]=value, the way the proposal was written', () => {
		expect(runTarget({ method: 'GET', path: '/api/v1/content/articles', query: { filters: { slug: 'x' } } })).toBe(
			'/api/v1/content/articles?filters%5Bslug%5D=x',
		);
	});
});
