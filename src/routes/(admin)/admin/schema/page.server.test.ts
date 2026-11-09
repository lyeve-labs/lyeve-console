import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load, ssr } from './+page.server';
import { signedIn } from '$lib/server/test-support/signed-in';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return {
		get: vi.fn((name: string) => (name === 'csrf' ? 'csrf-token' : 'tok')),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** A fetch that answers by path, recording every call. */
function fetchFor(routes: Record<string, Route>) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const asked = String(url);
		calls.push({ url: asked, init });
		if (asked.includes('/auth/me')) return json({ id: 'u1', roles: ['super_admin'], disabled: false });
		for (const [needle, route] of Object.entries(routes)) {
			if (asked.includes(needle)) return route(asked, init);
		}
		return json({ error: 'no route' }, 404);
	}) as unknown as typeof globalThis.fetch;
	return { fetch, calls };
}

const presets = [
	{ id: 'notes', name: 'Notes', description: 'Short notes and their tags.', schemas: [{ name: 'notes', fields: [] }, { name: 'note_tags', fields: [] }] },
];

function loadEvent(routes: Record<string, Route>, roles: string[] = ['super_admin']) {
	const { fetch, calls } = fetchFor(routes);
	return {
		calls,
		event: {
			fetch: signedIn(fetch, { roles }),
			cookies: mockCookies(),
		} as never,
	};
}

function actionEvent(routes: Record<string, Route>, id: string) {
	const { fetch, calls } = fetchFor(routes);
	const form = new FormData();
	form.set('id', id);
	return {
		calls,
		event: {
			fetch,
			cookies: mockCookies(),
			request: { formData: async () => form },
			url: new URL('http://localhost/admin/schema'),
			params: {},
		} as never,
	};
}

type Loaded = {
	schemas: { name: string }[];
	presets: { id: string }[];
	presetsGate: { state: string } | null;
	loadGate: { state: string } | null;
	canvas: { licensed: boolean };
};

const schemaRoutes: Record<string, Route> = {
	'/api/admin/schemas/presets': () => json({ presets }),
	'/api/admin/schemas/canvas-layout': () => json({ positions: {}, licensed: false }),
	'/stats': () => json({ rows: 3 }),
	'/api/admin/schemas': () => json([{ name: 'posts', display_name: 'Posts', fields: [] }]),
};

describe('admin/schema rendering', () => {
	it('renders in the browser only, so the server build carries no schema diagram', () => {
		expect(ssr).toBe(false);
	});
});

describe('admin/schema load', () => {
	it('reads the presets beside the schemas', async () => {
		const { event } = loadEvent(schemaRoutes);
		const out = (await load(event)) as unknown as Loaded;
		expect(out.schemas.map((s) => s.name)).toEqual(['posts']);
		expect(out.presets.map((p) => p.id)).toEqual(['notes']);
		expect(out.presetsGate).toBeNull();
	});

	it('keeps the page when the presets route is missing, and says so when it fails', async () => {
		const missing = loadEvent({ ...schemaRoutes, '/api/admin/schemas/presets': () => json({ error: 'not found' }, 404) });
		const withoutRoute = (await load(missing.event)) as unknown as Loaded;
		expect(withoutRoute.presets).toEqual([]);
		expect(withoutRoute.presetsGate).toEqual({ state: 'absent' });

		const failing = loadEvent({ ...schemaRoutes, '/api/admin/schemas/presets': () => json({ error: 'db down' }, 503) });
		const failed = (await load(failing.event)) as unknown as Loaded;
		expect(failed.presets).toEqual([]);
		expect(failed.presetsGate).toEqual({ state: 'unavailable' });
	});

	it('keeps a failed schema list as a gate rather than an empty list', async () => {
		const { event } = loadEvent({ '/api/admin/schemas': () => json({ error: 'slow down' }, 429) });
		const out = (await load(event)) as unknown as Loaded;
		expect(out.loadGate).toEqual({ state: 'busy' });
		// The canvas is not drawn either, and says why rather than blaming the license.
		expect((out as unknown as { canvasGate: unknown }).canvasGate).toEqual({ state: 'busy' });
	});

	it('keeps the public delivery mark and private fields as the engine sent them', async () => {
		const marked = { name: 'posts', display_name: 'Posts', public_delivery: true, fields: [{ name: 'notes', field_type: 'text', private: true }] };
		const { event } = loadEvent({ ...schemaRoutes, '/api/admin/schemas': () => json([marked]) });
		const out = (await load(event)) as unknown as Loaded;
		expect(out.schemas).toEqual([marked]);
	});

	it('answers no gate for a list it read', async () => {
		const { event } = loadEvent(schemaRoutes);
		const out = (await load(event)) as unknown as Loaded;
		expect(out.loadGate).toBeNull();
		expect('loadError' in out).toBe(false);
	});

	it('reads neither the presets nor the canvas for a role that cannot use them', async () => {
		const { event, calls } = loadEvent(schemaRoutes, ['editor']);
		const out = (await load(event)) as unknown as Loaded;
		expect(out.schemas.map((s) => s.name)).toEqual(['posts']);
		expect(out.presetsGate).toBeNull();
		expect(out.presets).toEqual([]);
		expect(out.canvas.licensed).toBe(false);
		// The layout route admits an admin only, so the canvas says the role
		// cannot open it rather than that the license leaves it out.
		expect((out as unknown as { canvasGate: unknown }).canvasGate).toEqual({ state: 'forbidden' });
		expect(calls.some((c) => c.url.includes('/presets') || c.url.includes('/canvas-layout'))).toBe(false);
	});
});

describe('admin/schema load reads what this install allows', () => {
	type Allowed = { canSavePresets: boolean; canvas: { positions: Record<string, unknown>; licensed: boolean } };

	it('takes the canvas and the preset save from the plugin', async () => {
		const { event } = loadEvent({
			...schemaRoutes,
			'/api/admin/schemas/presets': () => json({ presets, can_save: true }),
			'/api/admin/schemas/canvas-layout': () => json({ positions: { posts: { x: 10, y: 20 }, bad: { x: 'a' } }, licensed: true }),
		});
		const out = (await load(event)) as unknown as Allowed;
		expect(out.canSavePresets).toBe(true);
		expect(out.canvas).toEqual({ positions: { posts: { x: 10, y: 20 } }, licensed: true });
	});

	it('draws no canvas and offers no save when the plugin does not say so', async () => {
		const { event } = loadEvent({ ...schemaRoutes, '/api/admin/schemas/canvas-layout': () => json({ error: 'db down' }, 503) });
		const out = (await load(event)) as unknown as Allowed & { canvasGate: unknown };
		expect(out.canSavePresets).toBe(false);
		expect(out.canvas).toEqual({ positions: {}, licensed: false });
		// An outage is kept as one, never drawn as a license without the canvas.
		expect(out.canvasGate).toEqual({ state: 'unavailable' });
	});

	it('answers no canvas gate for a layout it read', async () => {
		const { event } = loadEvent(schemaRoutes);
		const out = (await load(event)) as unknown as { canvasGate: unknown };
		expect(out.canvasGate).toBeNull();
	});
});

describe('admin/schema layout action', () => {
	it('sends the whole layout and keeps only real positions', async () => {
		const { event, calls } = formEvent(
			{ '/api/admin/schemas/canvas-layout': () => json({ positions: {} }) },
			{ positions: JSON.stringify({ posts: { x: 1, y: 2 }, junk: 'x' }) },
		);
		expect(await actions.saveLayout(event)).toEqual({ layoutSaved: true });
		const put = calls.find((c) => c.url.endsWith('/api/admin/schemas/canvas-layout'));
		expect(put?.init?.method).toBe('PUT');
		expect(JSON.parse(String(put?.init?.body))).toEqual({ positions: { posts: { x: 1, y: 2 } } });
	});

	it('relays the license refusal', async () => {
		const { event } = formEvent(
			{ '/api/admin/schemas/canvas-layout': () => json({ error: 'payment_required', plugin: 'schema', feature: 'feature:example_feature' }, 402) },
			{ positions: '{}' },
		);
		expect(await actions.saveLayout(event)).toMatchObject({ status: 402, data: { refused: { kind: 'feature' } } });
	});
});

describe('admin/schema preset action', () => {
	it('posts the preset id and answers with the schemas the engine created', async () => {
		const { event, calls } = actionEvent(
			{ '/api/admin/schemas/presets/notes': () => json({ created: ['notes', 'note_tags'] }, 201) },
			'notes'
		);
		const out = await actions.preset(event);
		expect(out).toEqual({ preset: 'notes', created: ['notes', 'note_tags'] });
		const post = calls.find((c) => c.url.includes('/api/admin/schemas/presets/notes'));
		expect(post?.init?.method).toBe('POST');
	});

	it('relays a 409 beside the preset it refused', async () => {
		const { event } = actionEvent(
			{ '/api/admin/schemas/presets/notes': () => json({ error: 'schema "notes" already exists', code: 'conflict' }, 409) },
			'notes'
		);
		const out = await actions.preset(event);
		expect(out).toMatchObject({ status: 409, data: { action: 'preset', error: 'schema "notes" already exists', preset: 'notes' } });
	});

	it('names an unknown preset as one the install does not ship', async () => {
		const { event } = actionEvent({ '/api/admin/schemas/presets/blog': () => json({ error: 'not found' }, 404) }, 'blog');
		const out = await actions.preset(event);
		expect(out).toMatchObject({ status: 404, data: { error: 'This preset is not included in this build.', preset: 'blog' } });
	});

	it('refuses a role the plugin refuses before asking the engine', async () => {
		const calls: string[] = [];
		const fetch = vi.fn(async (url: string) => {
			calls.push(String(url));
			if (String(url).includes('/auth/me')) return json({ id: 'u2', roles: ['editor'], disabled: false });
			return json({ created: ['notes'] }, 201);
		}) as unknown as typeof globalThis.fetch;
		const form = new FormData();
		form.set('id', 'notes');
		const event = {
			fetch,
			cookies: mockCookies(),
			request: { formData: async () => form },
			url: new URL('http://localhost/admin/schema'),
			params: {},
		} as never;

		await expect(actions.preset(event)).rejects.toMatchObject({ status: 403 });
		expect(calls.filter((c) => c.includes('/presets'))).toEqual([]);
	});

	it('refuses an empty id before asking the engine', async () => {
		const { event, calls } = actionEvent({}, '');
		const out = await actions.preset(event);
		expect(out).toMatchObject({ status: 400 });
		expect(calls.filter((c) => c.url.includes('/presets'))).toEqual([]);
	});
});

function formEvent(routes: Record<string, Route>, fields: Record<string, string>) {
	const { fetch, calls } = fetchFor(routes);
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	return {
		calls,
		event: {
			fetch,
			cookies: mockCookies(),
			request: { formData: async () => form },
			url: new URL('http://localhost/admin/schema'),
			params: {},
		} as never,
	};
}

const posts = { name: 'posts', display_name: 'Posts', fields: [{ name: 'headline', field_type: 'text', required: false, unique: false, indexed: false }] };

describe('admin/schema save action', () => {
	it('renames the field through the rename route before it saves the definition', async () => {
		const { event, calls } = formEvent(
			{
				'/fields/title/rename': () => json({ schema: 'posts', old_field: 'title', new_field: 'headline' }),
				'/api/admin/schemas': () => json(posts),
			},
			{ schema: JSON.stringify(posts), original: 'posts', renames: JSON.stringify([{ from: 'title', to: 'headline' }]) },
		);
		const out = await actions.save(event);
		expect(out).toEqual({ scope: 'save', saved: posts });
		const writes = calls.filter((c) => c.init?.method === 'PUT' || c.init?.method === 'POST');
		expect(writes.map((c) => `${c.init?.method} ${new URL(c.url, 'http://x').pathname}`)).toEqual([
			'PUT /api/admin/schemas/posts/fields/title/rename',
			'POST /api/admin/schemas',
		]);
		expect(JSON.parse(String(writes[0].init?.body))).toEqual({ new_name: 'headline' });
	});

	it('says which renames already ran when the save after them fails', async () => {
		const { event } = formEvent(
			{
				'/fields/title/rename': () => json({}),
				'/api/admin/schemas': () => json({ error: 'invalid schema: field "x"', code: 'http_422' }, 422),
			},
			{ schema: JSON.stringify(posts), original: 'posts', renames: JSON.stringify([{ from: 'title', to: 'headline' }]) },
		);
		const out = (await actions.save(event)) as { status: number; data: { error: string; renamed: unknown[] } };
		expect(out.status).toBe(422);
		expect(out.data.error).toBe('invalid schema: field "x" These fields were renamed: title to headline.');
		expect(out.data.renamed).toEqual([{ from: 'title', to: 'headline' }]);
	});

	it('names the version it opened on the first write, and each version a rename answered on the next', async () => {
		const { event, calls } = formEvent(
			{
				'/fields/title/rename': () => json({ schema: 'posts', old_field: 'title', new_field: 'headline', version: 'v2' }),
				'/fields/body/rename': () => json({ schema: 'posts', old_field: 'body', new_field: 'text', version: 'v3' }),
				'/api/admin/schemas': () => json({ ...posts, version: 'v4' }),
			},
			{
				schema: JSON.stringify(posts),
				original: 'posts',
				version: 'v1',
				renames: JSON.stringify([
					{ from: 'title', to: 'headline' },
					{ from: 'body', to: 'text' },
				]),
			},
		);
		const out = await actions.save(event);
		expect(out).toEqual({ scope: 'save', saved: { ...posts, version: 'v4' } });
		const writes = calls.filter((c) => c.init?.method === 'PUT' || c.init?.method === 'POST');
		expect(writes.map((c) => new Headers(c.init?.headers).get('If-Match'))).toEqual(['"v1"', '"v2"', '"v3"']);
	});

	it('says the content type changed since it was opened, in its own words, when the engine refuses the version', async () => {
		const { event } = formEvent(
			{
				'/fields/title/rename': () => json({ version: 'v2' }),
				'/api/admin/schemas': () => json({ error: 'the schema changed since the version this write was sent with', code: 'SCHEMA_VERSION_MISMATCH' }, 412),
			},
			{ schema: JSON.stringify(posts), original: 'posts', version: 'v1', renames: JSON.stringify([{ from: 'title', to: 'headline' }]) },
		);
		const out = (await actions.save(event)) as { status: number; data: { error: string; stale: boolean; version: string; renamed: unknown[] } };
		expect(out.status).toBe(412);
		expect(out.data.stale).toBe(true);
		expect(out.data.error).toBe(
			'Someone changed this schema after you opened it. Reload it to see the latest version, then make your change again. These fields were renamed: title to headline.',
		);
		expect(out.data.version).toBe('v2');
		expect(out.data.renamed).toEqual([{ from: 'title', to: 'headline' }]);
	});

	it('stops at a rename the engine refuses for the version, before the definition is sent', async () => {
		const { event, calls } = formEvent(
			{
				'/fields/title/rename': () => json({ error: 'the schema changed', code: 'SCHEMA_VERSION_MISMATCH' }, 412),
				'/api/admin/schemas': () => json(posts),
			},
			{ schema: JSON.stringify(posts), original: 'posts', version: 'v1', renames: JSON.stringify([{ from: 'title', to: 'headline' }]) },
		);
		const out = (await actions.save(event)) as { status: number; data: { error: string; stale: boolean } };
		expect(out.status).toBe(412);
		expect(out.data.stale).toBe(true);
		expect(out.data.error).toBe('Someone changed this schema after you opened it. Reload it to see the latest version, then make your change again.');
		expect(calls.filter((c) => c.init?.method === 'POST')).toEqual([]);
	});

	it('creates a new content type only, never over one of the same name', async () => {
		const { event, calls } = formEvent({ '/api/admin/schemas': () => json({ ...posts, version: 'v1' }) }, { schema: JSON.stringify(posts), original: '', renames: '[]' });
		const out = await actions.save(event);
		expect(out).toEqual({ scope: 'save', saved: { ...posts, version: 'v1' } });
		const post = calls.find((c) => c.init?.method === 'POST');
		expect(new Headers(post?.init?.headers).get('If-None-Match')).toBe('*');
		expect(new Headers(post?.init?.headers).get('If-Match')).toBeNull();
	});

	it('says a content type of that name exists when the engine refuses the create', async () => {
		const { event } = formEvent(
			{ '/api/admin/schemas': () => json({ error: 'a schema of this name exists', code: 'SCHEMA_EXISTS' }, 412) },
			{ schema: JSON.stringify(posts), original: '', renames: '[]' },
		);
		const out = (await actions.save(event)) as { status: number; data: { error: string; stale: boolean } };
		expect(out.status).toBe(412);
		expect(out.data.error).toBe('A schema named posts already exists. Open it from the list, or give this one another machine name.');
		expect(out.data.stale).toBe(false);
	});

	it('sends the public delivery mark and a private field as the builder set them', async () => {
		const marked = { ...posts, public_delivery: true, fields: [{ ...posts.fields[0], private: true }] };
		const { event, calls } = formEvent({ '/api/admin/schemas': () => json(marked) }, { schema: JSON.stringify(marked), original: 'posts', renames: '[]' });
		const out = await actions.save(event);
		expect(out).toEqual({ scope: 'save', saved: marked });
		const post = calls.find((c) => c.init?.method === 'POST');
		const sent = JSON.parse(String(post?.init?.body));
		expect(sent.public_delivery).toBe(true);
		expect(sent.fields[0].private).toBe(true);
	});

	it('refuses a machine name edited in the definition of a saved schema', async () => {
		const { event, calls } = formEvent({}, { schema: JSON.stringify(posts), original: 'articles', renames: '[]' });
		const out = (await actions.save(event)) as { status: number };
		expect(out.status).toBe(400);
		expect(calls.filter((c) => c.init?.method === 'POST')).toEqual([]);
	});

	it('repeats a save once when another instance holds the DDL lock', async () => {
		vi.useFakeTimers();
		try {
			let tries = 0;
			const { event } = formEvent(
				{
					'/api/admin/schemas': () => (++tries === 1 ? json({ error: 'another instance is applying DDL' }, 503) : json(posts)),
				},
				{ schema: JSON.stringify(posts), original: '', renames: '[]' },
			);
			const pending = actions.save(event);
			await vi.advanceTimersByTimeAsync(1000);
			expect(await pending).toEqual({ scope: 'save', saved: posts });
			expect(tries).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('admin/schema preview, delete and rename actions', () => {
	it('answers the statements a save would run', async () => {
		const statements = [{ description: 'add column', sql: 'ALTER TABLE _posts ADD headline TEXT' }];
		const { event } = formEvent({ '/preview-ddl': () => json({ statements }) }, { schema: JSON.stringify(posts), intent: 'save' });
		expect(await actions.preview(event)).toEqual({ scope: 'preview', intent: 'save', statements });
	});

	it('hides a server failure behind a sentence', async () => {
		const { event } = formEvent({ '/api/admin/schemas/posts': () => json({ error: 'pq: relation missing' }, 500) }, { name: 'posts' });
		const out = (await actions.delete(event)) as { data: { error: string } };
		expect(out.data.error).toBe('Could not delete the schema. Try again.');
	});

	it('moves the table through the rename route', async () => {
		const renamed = { ...posts, name: 'articles' };
		const { event, calls } = formEvent({ '/posts/rename': () => json(renamed) }, { from: 'posts', to: 'articles' });
		expect(await actions.rename(event)).toEqual({ scope: 'rename', from: 'posts', saved: renamed });
		expect(calls.some((c) => c.init?.method === 'PUT' && c.url.includes('/api/admin/schemas/posts/rename'))).toBe(true);
	});
});

describe('admin/schema preview of a save with renames', () => {
	it('asks the engine about the renamed fields under their old names', async () => {
		const { event, calls } = formEvent(
			{ '/preview-ddl': () => json({ statements: [] }) },
			{ schema: JSON.stringify(posts), intent: 'save', renames: JSON.stringify([{ from: 'title', to: 'headline' }]) },
		);
		expect(await actions.preview(event)).toEqual({ scope: 'preview', intent: 'save', statements: [] });
		const sent = JSON.parse(String(calls.find((c) => c.url.includes('/preview-ddl'))?.init?.body));
		expect(sent.fields.map((f: { name: string }) => f.name)).toEqual(['title']);
	});
});

describe('admin/schema history and queued changes', () => {
	it('reads the history of one schema', async () => {
		const entries = [{ version: 2, description: 'drop column sku', up_sql: 'ALTER TABLE _posts DROP COLUMN sku', state: 'pending', created_at: '2026-09-24T00:00:00Z' }];
		const { event } = formEvent({ '/posts/history': () => json({ entries, pending: 1, limit: 200 }) }, { name: 'posts' });
		expect(await actions.history(event)).toEqual({ scope: 'history', name: 'posts', entries, pending: 1, limit: 200 });
	});

	it('says so when the engine serves no history route', async () => {
		const { event } = formEvent({ '/posts/history': () => json({ error: 'not found' }, 404) }, { name: 'posts' });
		const out = (await actions.history(event)) as { status: number; data: { error: string } };
		expect(out.status).toBe(404);
		expect(out.data.error).toBe('There is no saved schema named posts, so it has no history.');
	});

	it('applies the queue for that schema only', async () => {
		const { event, calls } = formEvent({ '/posts/apply-pending': () => json({ applied: 2, canceled: 1 }) }, { name: 'posts' });
		expect(await actions.applyPending(event)).toEqual({ scope: 'applyPending', name: 'posts', applied: 2, canceled: 1 });
		expect(calls.some((c) => c.init?.method === 'POST' && c.url.includes('/api/admin/schemas/posts/apply-pending'))).toBe(true);
	});
});

describe('admin/schema import', () => {
	const plan = { schemas: [{ name: 'articles', action: 'create', ddl: ['CREATE TABLE _articles (...)'] }] };

	it('asks for the plan first and sends the paste with its source', async () => {
		const { event, calls } = formEvent(
			{ '/api/admin/schemas/import': () => json({ applied: false, plan, notes: [], renamed: {} }) },
			{ text: '{"schemas":[]}', source: 'strapi', apply: 'false' },
		);
		const out = await actions.import(event);
		expect(out).toEqual({ scope: 'import', applied: false, plan, renamed: {}, notes: [] });
		const post = calls.find((c) => c.url.includes('/api/admin/schemas/import'));
		expect(post?.url).toContain('from=strapi');
		expect(post?.url).not.toContain('apply=true');
		expect((post?.init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
	});

	it('runs the plan when asked to apply', async () => {
		const { event, calls } = formEvent(
			{ '/api/admin/schemas/import': () => json({ applied: true, plan }) },
			{ text: 'schemas: []', source: 'lyeve', apply: 'true' },
		);
		expect(await actions.import(event)).toMatchObject({ applied: true });
		expect(calls.find((c) => c.url.includes('/import'))?.url).toContain('apply=true');
	});

	it('relays what the engine says is wrong with the file and hides a server failure', async () => {
		const bad = formEvent({ '/api/admin/schemas/import': () => json({ error: 'line 3: unknown field_type "strng"' }, 422) }, { text: 'x', source: 'lyeve' });
		expect(((await actions.import(bad.event)) as { data: { error: string } }).data.error).toBe('line 3: unknown field_type "strng"');
		const broken = formEvent({ '/api/admin/schemas/import': () => json({ error: 'pq: deadlock' }, 500) }, { text: 'x', source: 'lyeve' });
		expect(((await actions.import(broken.event)) as { data: { error: string } }).data.error).toBe('Could not import the definitions. Try again.');
	});

	it('refuses an empty form and an unknown source before calling the engine', async () => {
		const empty = formEvent({}, { source: 'lyeve' });
		expect(((await actions.import(empty.event)) as { status: number }).status).toBe(400);
		const odd = formEvent({}, { text: 'x', source: 'drupal' });
		expect(((await actions.import(odd.event)) as { status: number }).status).toBe(400);
		expect([...empty.calls, ...odd.calls].filter((c) => c.url.includes('/import'))).toEqual([]);
	});
});

describe('admin/schema load streams the row counts', () => {
	it('answers the schemas before the counts, and leaves out a count that failed', async () => {
		const { event } = loadEvent({
			'/api/admin/schemas/presets': () => json({ presets: [] }),
			'/api/admin/schemas/posts/stats': () => json({ rows: 3 }),
			'/api/admin/schemas/pages/stats': () => json({ error: 'x' }, 503),
			'/api/admin/schemas': () => json([{ name: 'posts', fields: [] }, { name: 'pages', fields: [] }]),
		});
		const out = (await load(event)) as unknown as { rowCounts: Promise<Record<string, number>>; isSuperAdmin: boolean };
		expect(out.rowCounts).toBeInstanceOf(Promise);
		expect(await out.rowCounts).toEqual({ posts: 3 });
		expect(out.isSuperAdmin).toBe(true);
	});
});

describe('admin/schema saved presets', () => {
	it('saves a preset from a URL and sends only the URL', async () => {
		const { event, calls } = formEvent(
			{ '/api/admin/schemas/presets': () => json({ id: 'blog', name: 'Blog', schemas: [], source: 'saved' }, 201) },
			{ url: 'https://example.com/blog.json' },
		);
		const out = await actions.savePreset(event);
		expect(out).toEqual({ savedPreset: 'blog' });
		const post = calls.find((c) => c.url.endsWith('/api/admin/schemas/presets'));
		expect(post?.init?.method).toBe('POST');
		expect(JSON.parse(String(post?.init?.body))).toEqual({ url: 'https://example.com/blog.json' });
	});

	it('saves a pasted document as the document', async () => {
		const { event, calls } = formEvent(
			{ '/api/admin/schemas/presets': () => json({ id: 'blog', name: 'Blog', schemas: [] }, 201) },
			{ document: 'id: blog' },
		);
		await actions.savePreset(event);
		const post = calls.find((c) => c.url.endsWith('/api/admin/schemas/presets'));
		expect(JSON.parse(String(post?.init?.body))).toEqual({ document: 'id: blog' });
	});

	it('refuses nothing, and both, before asking the engine', async () => {
		for (const fields of [{}, { url: 'https://example.com/x', document: '{}' }] as Record<string, string>[]) {
			const { event, calls } = formEvent({}, fields);
			expect(await actions.savePreset(event)).toMatchObject({ status: 400 });
			expect(calls.filter((c) => c.url.includes('/presets'))).toEqual([]);
		}
	});

	it('names a built-in id and an unreachable URL for what they are', async () => {
		const clash = formEvent({ '/api/admin/schemas/presets': () => json({ error: 'a built-in preset already uses that id' }, 409) }, { document: '{}' });
		expect(await actions.savePreset(clash.event)).toMatchObject({ status: 409, data: { saveError: expect.stringContaining('built-in') } });
		const gone = formEvent({ '/api/admin/schemas/presets': () => json({ error: 'bad gateway' }, 502) }, { url: 'https://example.com/x' });
		expect(await actions.savePreset(gone.event)).toMatchObject({ status: 502 });
	});

	it('relays the license refusal of a save', async () => {
		const { event } = formEvent(
			{ '/api/admin/schemas/presets': () => json({ error: 'payment_required', plugin: 'schema', feature: 'feature:example_feature' }, 402) },
			{ url: 'https://example.com/blog.json' },
		);
		expect(await actions.savePreset(event)).toMatchObject({ status: 402, data: { refused: { kind: 'feature' }, saveError: expect.any(String) } });
	});

	it('deletes a saved preset by id', async () => {
		const { event, calls } = formEvent({ '/api/admin/schemas/presets/blog': () => new Response(null, { status: 204 }) }, { id: 'blog' });
		expect(await actions.deletePreset(event)).toEqual({ deletedPreset: 'blog' });
		expect(calls.find((c) => c.url.includes('/presets/blog'))?.init?.method).toBe('DELETE');
	});
});
