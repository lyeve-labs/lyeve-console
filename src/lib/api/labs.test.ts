import { describe, expect, it } from 'vitest';
import {
	buildPath,
	buildQuery,
	byteLength,
	endpointId,
	findEndpoint,
	formatBody,
	graphqlMutates,
	grpcRouteParams,
	grpcRouteParts,
	grpcRouteTakesBody,
	isSameOriginPath,
	labResultFromInvoke,
	documentedStatus,
	labEndpoints,
	mutates,
	parseVariables,
	pathParams,
	pickHeaders,
	riskOf,
	riskTone,
	statusHint,
	type LabEndpoint,
} from './labs';
import type { EndpointGroup } from './reference';

const GROUPS: EndpointGroup[] = [
	{
		id: 'content',
		label: 'Content',
		description: '',
		server: 'api',
		baseUrl: 'http://localhost:3002',
		endpoints: [
			{
				method: 'GET',
				path: '/api/v1/content/{schema}/{id}',
				summary: 'One entry',
				auth: 'bearer',
				params: [
					{ name: 'schema', in: 'path', type: 'string', required: true, description: '' },
					{ name: 'id', in: 'path', type: 'string', required: true, description: '' },
					{ name: 'locale', in: 'query', type: 'string', required: false, description: '' },
				],
			},
			{
				method: 'DELETE',
				path: '/api/v1/content/{schema}/{id}',
				summary: 'Remove an entry',
				auth: 'bearer',
			},
		],
	},
];

function ep(over: Partial<LabEndpoint> = {}): LabEndpoint {
	return {
		id: 'GET /api/v1/content/{schema}/{id}',
		groupId: 'content',
		groupLabel: 'Content',
		server: 'api',
		method: 'GET',
		path: '/api/v1/content/{schema}/{id}',
		summary: 'One entry',
		params: GROUPS[0].endpoints[0].params,
		...over,
	};
}

describe('the path a lab sends', () => {
	it('fills the template the engine documented', () => {
		expect(buildPath(ep(), { schema: 'articles', id: 'abc' })).toBe('/api/v1/content/articles/abc');
	});

	// The whole reason this is not a request forgery primitive: the template
	// is the engine's and a value fills a hole in it. A value carrying
	// structure has to become text, or it rewrites the request.
	it('encodes a value that would otherwise add path structure', () => {
		expect(buildPath(ep(), { schema: 'articles', id: '../../admin/users' }))
			.toBe('/api/v1/content/articles/..%2F..%2Fadmin%2Fusers');
	});

	it('encodes a value that would otherwise start a query or a fragment', () => {
		const path = buildPath(ep(), { schema: 'a', id: 'x?y=1#z' });
		expect(path).toBe('/api/v1/content/a/x%3Fy%3D1%23z');
		expect(path).not.toContain('?');
		expect(path).not.toContain('#');
	});

	// A value that could name a host is the case this exists to stop.
	it('cannot be made to name another host', () => {
		const path = buildPath(ep(), { schema: 'a', id: '//evil.example.com/' });
		expect(path).toBe('/api/v1/content/a/%2F%2Fevil.example.com%2F');
		expect(path?.startsWith('/api/')).toBe(true);
	});

	// A path still carrying {id} is sent literally and answers 404 for a
	// reason that has nothing to do with the endpoint.
	it('refuses a template with a hole left in it', () => {
		expect(buildPath(ep(), { schema: 'articles' })).toBeNull();
		expect(buildPath(ep(), { schema: 'articles', id: '   ' })).toBeNull();
	});

	it('names the parameters a caller has to fill', () => {
		expect(pathParams(ep())).toEqual(['schema', 'id']);
		expect(pathParams(ep({ path: '/api/v1/health' }))).toEqual([]);
	});
});

describe('the query a lab sends', () => {
	// Only documented names. A caller adding one is the same hole the path
	// closes, through a different door.
	it('carries only the parameters the engine documented', () => {
		expect(buildQuery(ep(), { locale: 'en', smuggled: 'yes' })).toBe('?locale=en');
	});

	it('omits an empty value rather than sending a blank one', () => {
		expect(buildQuery(ep(), { locale: '  ' })).toBe('');
		expect(buildQuery(ep(), {})).toBe('');
	});

	it('encodes a value that would otherwise add a parameter', () => {
		expect(buildQuery(ep(), { locale: 'en&admin=1' })).toBe('?locale=en%26admin%3D1');
	});
});

describe('the endpoint allowlist', () => {
	it('finds one the engine documented', () => {
		expect(findEndpoint(GROUPS, 'GET /api/v1/content/{schema}/{id}')?.method).toBe('GET');
	});

	// An id is looked up in the document it came from, so a caller who invents
	// one gets nothing rather than a request.
	it('refuses an id the document does not carry', () => {
		expect(findEndpoint(GROUPS, 'GET /api/admin/users')).toBeNull();
		expect(findEndpoint(GROUPS, 'GET http://evil.example.com/')).toBeNull();
		expect(findEndpoint(GROUPS, '')).toBeNull();
	});

	it('keeps the two methods on one path apart', () => {
		const all = labEndpoints(GROUPS);
		expect(all).toHaveLength(2);
		expect(new Set(all.map((e) => e.id)).size).toBe(2);
		expect(endpointId('delete', '/x')).toBe('DELETE /x');
	});
});

describe('how much damage a send can do', () => {
	// DELETE is apart because its result cannot be inspected and undone by
	// sending something else.
	it('separates a delete from any other write', () => {
		expect(riskOf('GET')).toBe('read');
		expect(riskOf('POST')).toBe('write');
		expect(riskOf('PUT')).toBe('write');
		expect(riskOf('DELETE')).toBe('destructive');
		expect(riskTone('destructive')).toBe('danger');
		expect(riskTone('write')).toBe('warn');
		expect(riskTone('read')).toBe('success');
	});

	it('reads the method whatever case it arrives in', () => {
		expect(mutates('post')).toBe(true);
		expect(mutates('get')).toBe(false);
	});
});

describe('reading the answer', () => {
	it('pretty-prints JSON and says it was JSON', () => {
		const out = formatBody('{"a":1}', 'application/json; charset=utf-8');
		expect(out.json).toBe(true);
		expect(out.body).toBe('{\n  "a": 1\n}');
	});

	// A content type is a claim, not a guarantee. The malformed bytes are the
	// finding, so they are shown rather than replaced by a parse error.
	it('shows a malformed body as it arrived', () => {
		const out = formatBody('{not json', 'application/json');
		expect(out.json).toBe(false);
		expect(out.body).toBe('{not json');
	});

	it('keeps only the headers that explain the status', () => {
		const h = new Headers({
			'content-type': 'application/json',
			'retry-after': '30',
			'x-frame-options': 'DENY',
		});
		const picked = pickHeaders(h);
		expect(picked['content-type']).toBe('application/json');
		expect(picked['retry-after']).toBe('30');
		expect(picked['x-frame-options']).toBeUndefined();
	});

	// 402 is the one a tester meets and misreads as a broken request.
	it('says a 402 is the license and not the request', () => {
		expect(statusHint(402)).toContain('Changing the request does not help');
		expect(statusHint(503)).toContain('Send the request again later');
		expect(statusHint(418)).toBe('');
	});
});

describe('GraphQL', () => {
	// The label the page puts on the send, so it can ask before a write.
	it('spots a mutation whatever surrounds the keyword', () => {
		expect(graphqlMutates('mutation { deleteArticle(id: "1") }')).toBe(true);
		expect(graphqlMutates('  MUTATION Foo($x: ID!) { a }')).toBe(true);
		expect(graphqlMutates('query { articles { id } }')).toBe(false);
		expect(graphqlMutates('{ articles { id } }')).toBe(false);
	});

	// A field merely named "mutation" is not an operation keyword.
	it('does not call a field named mutation a mutation', () => {
		expect(graphqlMutates('query { auditLog { mutationCount } }')).toBe(false);
	});

	it('takes an object, an empty string, and nothing else', () => {
		expect(parseVariables('{"id":"a"}')).toEqual({ ok: true, value: { id: 'a' } });
		expect(parseVariables('   ')).toEqual({ ok: true, value: undefined });
		expect(parseVariables('[1,2]').ok).toBe(false);
		expect(parseVariables('null').ok).toBe(false);
		expect(parseVariables('{oops').ok).toBe(false);
	});
});

describe('isSameOriginPath', () => {
	it('accepts a rooted path', () => {
		expect(isSameOriginPath('/api/admin/users')).toBe(true);
		expect(isSameOriginPath('/api/v1/content/post?limit=5')).toBe(true);
	});

	it('refuses a protocol-relative path, which fetch reads as another host', () => {
		expect(isSameOriginPath('//example.invalid/api')).toBe(false);
	});

	it('refuses an absolute URL and a relative one', () => {
		expect(isSameOriginPath('https://example.invalid/api')).toBe(false);
		expect(isSameOriginPath('api/admin/users')).toBe(false);
		expect(isSameOriginPath('')).toBe(false);
	});

	it('accepts every path buildPath can produce from a rooted template', () => {
		const ep = {
			id: 'GET /api/v1/content/{schema}',
			groupId: 'content',
			groupLabel: 'Content',
			server: 'content',
			method: 'GET',
			path: '/api/v1/content/{schema}',
			summary: '',
			params: [],
		} as unknown as LabEndpoint;
		for (const hostile of ['/evil', '//evil.invalid', '../../etc/passwd', 'https://evil.invalid']) {
			const built = buildPath(ep, { schema: hostile });
			expect(built).not.toBeNull();
			expect(isSameOriginPath(built as string)).toBe(true);
		}
	});
});

describe('byteLength', () => {
	it('counts bytes, not UTF-16 units', () => {
		expect(byteLength('abc')).toBe(3);
		// One code point, three bytes: a cap read off .length admits three
		// times the payload it was set to admit.
		expect(byteLength('\u4e16')).toBe(3);
		expect('\u4e16'.length).toBe(1);
	});
});

describe('grpcRouteParts', () => {
	it('splits the shape the plugin declares', () => {
		expect(grpcRouteParts('POST /api/content/{schema}')).toEqual({
			method: 'POST',
			template: '/api/content/{schema}',
		});
	});

	it('refuses anything that is not a method and a rooted path', () => {
		for (const bad of ['', 'GET', '/api/schemas', 'GET api/schemas', ' /api/schemas']) {
			expect(grpcRouteParts(bad)).toBeNull();
		}
	});
});

describe('grpcRouteParams', () => {
	it('names every hole in order', () => {
		expect(grpcRouteParams('PUT /api/content/{schema}/{id}')).toEqual(['schema', 'id']);
		expect(grpcRouteParams('GET /api/schemas')).toEqual([]);
	});

	it('is empty for a route it cannot read, so the form asks for nothing', () => {
		expect(grpcRouteParams('nonsense')).toEqual([]);
	});
});

describe('grpcRouteTakesBody', () => {
	it('is true only where the transcoded handler reads one', () => {
		expect(grpcRouteTakesBody('POST /api/content/{schema}')).toBe(true);
		expect(grpcRouteTakesBody('PUT /api/content/{schema}/{id}')).toBe(true);
		expect(grpcRouteTakesBody('GET /api/content/{schema}')).toBe(false);
		expect(grpcRouteTakesBody('DELETE /api/content/{schema}/{id}')).toBe(false);
		expect(grpcRouteTakesBody('nonsense')).toBe(false);
	});
});

describe('labResultFromInvoke', () => {
	it('shows the transcoded handler status, not the engine call status', () => {
		const r = labResultFromInvoke({
			route: 'GET /api/content/{schema}',
			method: 'GET',
			path: '/api/content/post',
			status: 404,
			duration_ms: 7,
			body: '{"error":"schema not found"}',
		});
		expect(r.status).toBe(404);
		expect(r.method).toBe('GET');
		expect(r.path).toBe('/api/content/post');
		expect(r.durationMs).toBe(7);
		expect(r.json).toBe(true);
		expect(r.body).toContain('schema not found');
	});

	it('keeps a body that is not JSON as it arrived', () => {
		const r = labResultFromInvoke({
			route: 'GET /api/schemas',
			method: 'GET',
			path: '/api/schemas',
			status: 500,
			duration_ms: 1,
			body: 'not json at all',
		});
		expect(r.json).toBe(false);
		expect(r.body).toBe('not json at all');
	});
});

describe('documentedStatus', () => {
	const statuses = [
		{ code: '200', description: 'OK' },
		{ code: '404', description: 'Not found' },
		{ code: '5XX', description: 'Engine failure' },
	];
	it('names the documented status an answer matched', () => {
		expect(documentedStatus(statuses, 200)).toEqual({ code: '200', description: 'OK' });
		expect(documentedStatus(statuses, 503)).toEqual({ code: '5XX', description: 'Engine failure' });
	});
	it('says when an answer is not one the document lists', () => {
		expect(documentedStatus(statuses, 401)).toBe(false);
	});
	it('claims nothing when the document lists no status', () => {
		expect(documentedStatus(undefined, 200)).toBeNull();
		expect(documentedStatus([], 200)).toBeNull();
	});
});
