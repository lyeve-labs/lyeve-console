import { describe, expect, it } from 'vitest';
import { buildReference, collapseContentPath, statusesOf, VALUES_SHOWN, type OpenAPIDocument } from './openapi';
import { staticGroups } from './reference';

const bearer: Record<string, unknown[]>[] = [{ bearerAuth: [] }];
const both: Record<string, unknown[]>[] = [{ bearerAuth: [] }, { cookieAuth: [] }];

/** The shape the engine serves, reduced to what the builder reads. */
function document(collections: string[]): OpenAPIDocument {
	const paths: OpenAPIDocument['paths'] = {
		'/api/admin/setup': {
			get: { tags: ['Admin / Auth'], summary: 'Check setup status' },
			post: {
				tags: ['Admin / Auth'],
				summary: 'Run first-boot setup',
				requestBody: { content: { 'application/json': { schema: { example: { email: 'a@b.c' } } } } },
			},
		},
		'/api/admin/tenants': {
			get: { tags: ['Admin / Tenants'], summary: 'List tenants', security: both },
		},
		'/api/admin/schemas/export': {
			get: {
				tags: ['Admin / Schemas'],
				summary: 'Export schemas',
				security: both,
				parameters: [
					{ name: 'format', in: 'query', schema: { type: 'string', enum: ['yaml', 'json'] } },
					{
						name: 'kind',
						in: 'query',
						schema: { type: 'string', enum: Array.from({ length: 30 }, (_, i) => `k${i}`) },
					},
				],
			},
		},
	};
	for (const c of collections) {
		paths[`/api/v1/content/${c}`] = {
			get: {
				tags: [`Content / ${c}`],
				summary: `List ${c} records`,
				security: bearer,
				parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
			},
			post: { tags: [`Content / ${c}`], summary: `Create ${c}`, security: bearer },
		};
		paths[`/api/v1/content/${c}/{id}`] = {
			get: {
				tags: [`Content / ${c}`],
				summary: `Get one ${c}`,
				security: bearer,
				parameters: [
					{ name: 'schema', in: 'path', required: true, schema: { type: 'string', enum: collections } },
					{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
				],
			},
		};
	}
	return { paths };
}

describe('collapseContentPath', () => {
	it('folds a collection path onto the {schema} family and names the collection', () => {
		expect(collapseContentPath('/api/v1/content/posts')).toEqual({ path: '/api/v1/content/{schema}', collection: 'posts' });
		expect(collapseContentPath('/api/v1/content/posts/{id}/revisions')).toEqual({
			path: '/api/v1/content/{schema}/{id}/revisions',
			collection: 'posts',
		});
	});
	it('leaves the generic family and everything else alone', () => {
		expect(collapseContentPath('/api/v1/content/{schema}/{id}')).toEqual({ path: '/api/v1/content/{schema}/{id}', collection: null });
		expect(collapseContentPath('/api/admin/users')).toEqual({ path: '/api/admin/users', collection: null });
	});
});

describe('buildReference', () => {
	it('documents the content API once however many collections the engine expanded it for', () => {
		const few = buildReference(document(['a', 'b']), staticGroups);
		const many = buildReference(document(Array.from({ length: 200 }, (_, i) => `c${i}`)), staticGroups);
		const count = (m: typeof few) => m.groups.reduce((n, g) => n + g.endpoints.length, 0);
		expect(count(many)).toBe(count(few));
		expect(many.collections).toBe(200);
		const content = many.groups.find((g) => g.id === 'api-content');
		expect(content?.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual([
			'GET /api/v1/content/{schema}',
			'POST /api/v1/content/{schema}',
			'GET /api/v1/content/{schema}/{id}',
		]);
	});

	it('states the collection count on the schema parameter and never the names', () => {
		const m = buildReference(document(['posts', 'pages']), staticGroups);
		const getOne = m.groups.flatMap((g) => g.endpoints).find((e) => e.path === '/api/v1/content/{schema}/{id}');
		const schema = getOne?.params?.find((p) => p.name === 'schema');
		expect(schema?.description).toBe('Content type name. This engine has 2 content types. See the Schema builder.');
		expect(schema?.values).toBeUndefined();
		expect(JSON.stringify(m)).not.toContain('posts, pages');
	});

	it('takes the route set from the engine and the prose from the catalog', () => {
		const m = buildReference(document([]), staticGroups);
		const all = m.groups.flatMap((g) => g.endpoints);
		// A route the catalog does not write up appears too, from the engine.
		const tenants = all.find((e) => e.path === '/api/admin/tenants');
		expect(tenants?.summary).toBe('List tenants');
		expect(tenants?.auth).toBe('bearer-or-cookie');
		// A route both know keeps the catalog's words.
		const setup = all.find((e) => e.method === 'POST' && e.path === '/api/admin/setup');
		const written = staticGroups.flatMap((g) => g.endpoints).find((e) => e.method === 'POST' && e.path === '/api/admin/setup');
		expect(setup?.summary).toBe(written?.summary);
		expect(setup?.roles).toEqual(written?.roles);
		// A route the catalog writes up but the engine does not serve is left out.
		expect(all.find((e) => e.path === '/api/admin/users')).toBeUndefined();
	});

	it('maps security to the gate and carries enumerated values', () => {
		const m = buildReference(document(['a']), staticGroups);
		const all = m.groups.flatMap((g) => g.endpoints);
		expect(all.find((e) => e.method === 'GET' && e.path === '/api/admin/setup')?.auth).toBe('none');
		const exp = all.find((e) => e.path === '/api/admin/schemas/export');
		expect(exp?.params?.find((p) => p.name === 'format')?.values).toEqual(['yaml', 'json']);
		expect(exp?.params?.find((p) => p.name === 'kind')?.values?.length).toBeGreaterThan(VALUES_SHOWN);
		const id = all.find((e) => e.path === '/api/v1/content/{schema}/{id}')?.params?.find((p) => p.name === 'id');
		expect(id).toMatchObject({ in: 'path', required: true, type: 'uuid' });
	});

	it('keeps the catalog order, puts plugins last, and spells every group label the same way', () => {
		const doc = document(['a']);
		doc.paths['/api/admin/waf/config'] = { get: { tags: ['Plugin / waf'], summary: 'GET /api/admin/waf/config', security: both } };
		const m = buildReference(doc, staticGroups);
		const ids = m.groups.map((g) => g.id);
		expect(ids.indexOf('admin-auth')).toBeLessThan(ids.indexOf('api-content'));
		expect(ids.indexOf('plugin-waf')).toBe(ids.length - 1);
		expect(m.groups.find((g) => g.id === 'admin-tenants')?.label).toBe('Admin · Tenants');
		expect(m.groups.every((g) => !g.label.includes('/'))).toBe(true);
	});
});

describe('statusesOf', () => {
	it('lists the documented statuses in code order', () => {
		expect(statusesOf({ '404': { description: 'Not found' }, '200': { description: 'OK' } })).toEqual([
			{ code: '200', description: 'OK' },
			{ code: '404', description: 'Not found' },
		]);
		expect(statusesOf(undefined)).toBeUndefined();
		expect(statusesOf({})).toBeUndefined();
	});

	it('carries them onto the reference', () => {
		const doc: OpenAPIDocument = {
			paths: { '/api/checkout': { post: { tags: ['Flow endpoints'], responses: { '200': { description: 'OK' }, '402': { description: 'Needs an example capability' } } } } },
		};
		const ep = buildReference(doc, []).groups.flatMap((g) => g.endpoints).find((e) => e.path === '/api/checkout');
		expect(ep?.statuses?.map((s) => s.code)).toEqual(['200', '402']);
	});

	it('keeps a PATCH operation', () => {
		const doc: OpenAPIDocument = { paths: { '/api/checkout': { patch: { tags: ['Flow endpoints'] } } } };
		expect(buildReference(doc, []).groups.flatMap((g) => g.endpoints).map((e) => e.method)).toEqual(['PATCH']);
	});
});
