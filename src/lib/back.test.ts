import { describe, expect, it } from 'vitest';
import { actionWithQuery, filterHref, listBack, listQuery, queryWithout, returnAddress } from './back';

describe('listBack', () => {
	it('returns the bare list when the detail URL carries no filter', () => {
		const url = new URL('http://localhost/admin/flows/f1');
		expect(listBack('/admin/flows', 'Flows', url, ['status', 'q'])).toEqual({
			href: '/admin/flows',
			label: 'Flows',
		});
	});

	it('forwards only the named keys, in their order, and drops empty ones', () => {
		const url = new URL('http://localhost/admin/flows/f1?q=sync&status=active&stray=1&limit=');
		expect(listBack('/admin/flows', 'Flows', url, ['status', 'q', 'limit']).href).toBe(
			'/admin/flows?status=active&q=sync',
		);
	});

	it('keeps a value that needs escaping intact', () => {
		const url = new URL('http://localhost/admin/flows/f1?q=a%26b');
		expect(listBack('/admin/flows', 'Flows', url, ['q']).href).toBe('/admin/flows?q=a%26b');
	});
});

describe('listQuery', () => {
	it('is empty when nothing is set', () => {
		expect(listQuery({ status: '', q: null, offset: undefined })).toBe('');
	});

	it('names every set filter, numbers included', () => {
		expect(listQuery({ status: 'active', q: '', limit: 25, offset: 50 })).toBe(
			'?status=active&limit=25&offset=50',
		);
	});
});

describe('queryWithout', () => {
	it('keeps every other key, repeated values included, and drops the named ones', () => {
		const url = new URL('http://localhost/admin/jobs?offset=50&edit=j1&tag=a&tag=b');
		expect(queryWithout(url, ['edit', 'new'])).toBe('?offset=50&tag=a&tag=b');
	});

	it('drops the name of the action a form posted to', () => {
		const url = new URL('http://localhost/admin/audit-log?q=alice&/prune');
		expect(queryWithout(url)).toBe('?q=alice');
	});

	it('is empty when nothing is left', () => {
		expect(queryWithout(new URL('http://localhost/admin/jobs?new=1'), ['new'])).toBe('');
	});
});

describe('actionWithQuery', () => {
	it('is the bare action when the page carries no query', () => {
		expect(actionWithQuery('prune', '')).toBe('?/prune');
	});

	it('names the action after the query, so the action request still carries it', () => {
		const action = actionWithQuery('prune', '?q=alice&action=user.login');
		expect(action).toBe('?q=alice&action=user.login&/prune');
		const posted = new URL(action, 'http://localhost/admin/audit-log?q=alice&action=user.login');
		expect(posted.searchParams.get('q')).toBe('alice');
		expect([...posted.searchParams.keys()].find((key) => key.startsWith('/'))).toBe('/prune');
	});
});

describe('returnAddress', () => {
	it('returns to the address the action was posted from, less the action and the dropped keys', () => {
		const url = new URL('http://localhost/admin/jobs?offset=50&edit=j1&/update');
		expect(returnAddress(url, ['edit', 'new'])).toBe('/admin/jobs?offset=50');
	});

	it('is the bare path when nothing is kept', () => {
		expect(returnAddress(new URL('http://localhost/admin/jobs?/create'))).toBe('/admin/jobs');
	});
});

describe('filterHref', () => {
	const url = new URL('http://localhost/admin/jobs?q=nightly&limit=100&offset=200&status=enabled');

	it('keeps the search and the page size, sets the filter and starts at the first page', () => {
		expect(filterHref(url, 'status', 'disabled')).toBe('/admin/jobs?q=nightly&limit=100&status=disabled');
	});

	it('takes the filter out for its empty option', () => {
		expect(filterHref(url, 'status', '')).toBe('/admin/jobs?q=nightly&limit=100');
	});

	it('is the bare path when nothing else is set', () => {
		expect(filterHref(new URL('http://localhost/admin/jobs?status=enabled&offset=50'), 'status', '')).toBe('/admin/jobs');
	});
});
