import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

// The session client is left real and runs over the event's fetch, so every
// read and write lands in one call log with the headers it would send. It
// throws on a non-2xx: a fake that resolved whatever the engine answered would
// turn a refused write into a passing test.
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	requireUser: vi.fn(async () => ({ id: 'u1', email: 'admin@test.invalid' }) as never),
	stripProtectedFields: vi.fn((v: unknown) => v)
}));

vi.mock('@lyeve-labs/client-rest', () => ({
	getSchema: vi.fn(async () => ({ name: 'article', with_draft_publish: true, fields: [] }))
}));

import { isHttpError } from '@sveltejs/kit';
import { load, actions } from './+page.server';
import { getSchema } from '@lyeve-labs/client-rest';
import { buildFromData, serialize } from '$lib/utils/content-form';
import type { PluginSet } from '$lib/plugins';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function mockCookies(): Cookies {
	return {
		get: vi.fn((name: string) => (name === '__Host-csrf' ? 'csrf-tok' : 'token'))
	} as unknown as Cookies;
}

const entry = { id: 'e1', created_at: '', updated_at: '', title: 'One', body: {}, status: 'draft' };

/**
 * Route fetch by path so the three concurrent calls in load do not depend on
 * the order they resolve in.
 */
function fetchWith(revisionsBody: unknown, revisionsStatus = 200) {
	return vi.fn(async (path: string) => {
		if (path.includes('/revisions')) return json(revisionsBody, revisionsStatus);
		if (path.includes('/api/admin/content?')) return json({ data: [] });
		return json(entry);
	}) as unknown as typeof globalThis.fetch;
}

const none: PluginSet = { state: 'named', running: [], withheld: [] };
const localized: PluginSet = { state: 'named', running: ['localization'], withheld: [] };

async function loadWith(revisionsBody: unknown, revisionsStatus = 200, plugins = none) {
	return (await load({
		fetch: fetchWith(revisionsBody, revisionsStatus),
		cookies: mockCookies(),
		params: { schema: 'article', id: 'e1' },
		parent: async () => ({ plugins })
	} as never)) as { revisions: unknown[]; localization: unknown };
}

describe('content editor load, translations', () => {
	it('reads nothing from the localization plugin while it does not run', async () => {
		const fetchFn = fetchWith({ data: [], total: 0 });
		await load({
			fetch: fetchFn,
			cookies: mockCookies(),
			params: { schema: 'article', id: 'e1' },
			parent: async () => ({ plugins: none })
		} as never);
		const paths = (fetchFn as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0]);
		expect(paths.some((p) => p.includes('/translations') || p.includes('/localization/'))).toBe(false);
		expect((await loadWith({ data: [], total: 0 })).localization).toBeNull();
	});

	it('loads the locales and the entry\'s translations while the plugin runs', async () => {
		const fetchFn = vi.fn(async (path: string) => {
			if (path.includes('/localization/locales')) {
				return json({ default_locale: 'en', enabled_locales: ['en', 'fr'] });
			}
			if (path.includes('/translations')) {
				return json({ data: [{ locale: 'fr', title: 'Un', body: {}, translation_status: 'outdated' }], total: 1 });
			}
			if (path.includes('/revisions')) return json({ data: [], total: 0 });
			return json(entry);
		}) as unknown as typeof globalThis.fetch;
		const result = (await load({
			fetch: fetchFn,
			cookies: mockCookies(),
			params: { schema: 'article', id: 'e1' },
			parent: async () => ({ plugins: localized })
		} as never)) as { localization: { locales: unknown; translations: { locale: string }[]; unavailable: boolean } };
		expect(result.localization.unavailable).toBe(false);
		expect(result.localization.locales).toEqual({ default_locale: 'en', enabled_locales: ['en', 'fr'], fallback_chain: [] });
		expect(result.localization.translations.map((t) => t.locale)).toEqual(['fr']);
	});

	it('keeps the panel, marked unavailable, when the running plugin does not answer', async () => {
		const fetchFn = vi.fn(async (path: string) => {
			if (path.includes('/localization/') || path.includes('/translations')) return json({ error: 'x' }, 503);
			if (path.includes('/revisions')) return json({ data: [], total: 0 });
			return json(entry);
		}) as unknown as typeof globalThis.fetch;
		const result = (await load({
			fetch: fetchFn,
			cookies: mockCookies(),
			params: { schema: 'article', id: 'e1' },
			parent: async () => ({ plugins: localized })
		} as never)) as { localization: { unavailable: boolean } };
		expect(result.localization.unavailable).toBe(true);
	});
});

describe('content editor load, revisions', () => {
	it('unwraps the paginated envelope the endpoint answers with', async () => {
		const result = await loadWith({ data: [{ id: 'r2' }, { id: 'r1' }], total: 2 });

		// Handed through whole, the page reads `.length` off the envelope, finds
		// undefined, and renders no History control for any entry.
		expect(Array.isArray(result.revisions)).toBe(true);
		expect(result.revisions).toHaveLength(2);
	});

	it('accepts a bare array as well as the envelope', async () => {
		const result = await loadWith([{ id: 'r1' }]);
		expect(result.revisions).toHaveLength(1);
	});

	it('says the history could not be read rather than failing the page when the call errors', async () => {
		const result = (await loadWith({ error: 'nope' }, 503)) as unknown as { revisions: unknown[]; revisionsFailed: boolean };
		expect(result.revisions).toEqual([]);
		expect(result.revisionsFailed).toBe(true);
	});

	it('reports no revisions when the envelope carries none', async () => {
		const result = (await loadWith({ data: [], total: 0 })) as unknown as { revisions: unknown[]; revisionsFailed: boolean };
		expect(result.revisions).toEqual([]);
		expect(result.revisionsFailed).toBe(false);
	});
});

describe('content editor load, the entry read', () => {
	async function entryAnswering(status: number) {
		const fetchFn = vi.fn(async (path: string) => {
			if (path.includes('/revisions')) return json({ data: [] });
			if (path.includes('/api/admin/content?')) return json({ data: [] });
			return json({ error: 'x' }, status);
		}) as unknown as typeof globalThis.fetch;
		return Promise.resolve(
			load({
				fetch: fetchFn,
				cookies: mockCookies(),
				params: { schema: 'article', id: 'e1' },
				parent: async () => ({ plugins: none })
			} as never),
		).catch((err: unknown) => err);
	}

	// The load starts every read at once. When the entry read fails, the load
	// throws its own error, and a read derived from the entry that nobody
	// awaits by then rejects with no handler: a server-side unhandled
	// rejection on every missing entry.
	it('leaves no read unsettled when the entry read fails', async () => {
		const unhandled: unknown[] = [];
		const note = (reason: unknown) => unhandled.push(reason);
		process.on('unhandledRejection', note);
		try {
			await entryAnswering(404);
			await new Promise((resolve) => setImmediate(resolve));
		} finally {
			process.off('unhandledRejection', note);
		}
		expect(unhandled).toEqual([]);
	});

	// The form shows and saves the schema's fields, which live in the body.
	// Meta is kept beside them, so a meta key named like a field must not
	// stand in for that field's value, or a save would copy it into the body.
	it('fills the form from the body and never from meta', async () => {
		const stored = {
			...entry,
			body: { contact: 'ada@example.com', summary: 'Hello' },
			meta: { contact: 'from meta', seo_title: 'Home' },
		};
		const fetchFn = vi.fn(async (path: string) => {
			if (path.includes('/revisions')) return json({ data: [] });
			if (path.includes('/api/admin/content?')) return json({ data: [] });
			return json(stored);
		}) as unknown as typeof globalThis.fetch;
		const out = (await load({
			fetch: fetchFn,
			cookies: mockCookies(),
			params: { schema: 'article', id: 'e1' },
			parent: async () => ({ plugins: none }),
		} as never)) as { item: { data: Record<string, unknown> } };
		expect(out.item.data).toEqual({ contact: 'ada@example.com', summary: 'Hello', title: 'One', _status: 'draft' });
	});

	it('answers 404 when the engine says the entry does not exist', async () => {
		const thrown = await entryAnswering(404);
		expect(isHttpError(thrown) && thrown.status).toBe(404);
	});

	it('reports an outage as an outage, never as an entry that is not there', async () => {
		const thrown = await entryAnswering(503);
		expect(isHttpError(thrown) && thrown.status).toBe(503);
	});

	it('reports a refused role as a refusal', async () => {
		const thrown = await entryAnswering(403);
		expect(isHttpError(thrown) && thrown.status).toBe(403);
	});
});

describe('content editor load, relation pickers', () => {
	it('says when a related collection is larger than the picker, and when its read failed', async () => {
		const { getSchema } = await import('@lyeve-labs/client-rest');
		vi.mocked(getSchema).mockResolvedValueOnce({
			name: 'article',
			fields: [
				{ name: 'author', field_type: 'relation', relation_type: 'belongs_to', relation_to: 'author' },
				{ name: 'tags', field_type: 'relation', relation_type: 'many_to_many', relation_to: 'tag' },
			],
		} as never);
		const fetchFn = vi.fn(async (path: string) => {
			if (path.includes('schema=author')) return json({ data: [{ id: 'a1', title: 'Ada' }], total_count: 900 });
			if (path.includes('schema=tag')) return json({ error: 'x' }, 503);
			if (path.includes('/revisions')) return json({ data: [] });
			return json(entry);
		}) as unknown as typeof globalThis.fetch;
		const result = (await load({
			fetch: fetchFn,
			cookies: mockCookies(),
			params: { schema: 'article', id: 'e1' },
			parent: async () => ({ plugins: none })
		} as never)) as unknown as { relations: Record<string, { items: unknown[]; total: number; failed: boolean }> };

		expect(result.relations.author.total).toBe(900);
		expect(result.relations.author.items).toHaveLength(1);
		expect(result.relations.tag.failed).toBe(true);
	});

	it('hands the media picker null when the library could not be read', async () => {
		const { getSchema } = await import('@lyeve-labs/client-rest');
		vi.mocked(getSchema).mockResolvedValueOnce({
			name: 'article',
			fields: [{ name: 'cover', field_type: 'media' }],
		} as never);
		const fetchFn = vi.fn(async (path: string) => {
			if (path.includes('/api/admin/media')) return json({ error: 'x' }, 503);
			if (path.includes('/revisions')) return json({ data: [] });
			return json(entry);
		}) as unknown as typeof globalThis.fetch;
		const result = (await load({
			fetch: fetchFn,
			cookies: mockCookies(),
			params: { schema: 'article', id: 'e1' },
			parent: async () => ({ plugins: none })
		} as never)) as unknown as { mediaChoices: unknown };

		expect(result.mediaChoices).toBeNull();
	});

	it('flattens the row columns into the one data object the panel reads', async () => {
		// A revision carries title, body, meta and status as separate columns.
		// Passed through as they arrive, `data` is absent, and the panel's
		// summary calls Object.keys on it, which throws during hydration and
		// leaves the History control toggling nothing.
		const result = await loadWith({
			data: [
				{
					id: 'r1',
					revision_num: 2,
					created_at: '2026-01-01T00:00:00Z',
					created_by: 'u1',
					title: 'Two',
					body: { body: 'v2' },
					meta: { locale: 'en' },
					status: 'published'
				}
			],
			total: 1
		});

		expect(result.revisions[0]).toEqual({
			id: 'r1',
			revision_num: 2,
			created_at: '2026-01-01T00:00:00Z',
			created_by: 'u1',
			data: { body: 'v2', title: 'Two', locale: 'en', _status: 'published' }
		});
	});

	it('gives a row with no body an empty data object rather than none', async () => {
		const result = await loadWith({ data: [{ id: 'r1', revision_num: 1 }], total: 1 });
		const rev = result.revisions[0] as { data: Record<string, unknown> };
		expect(rev.data).toEqual({ _status: 'published' });
	});
});

// save: many_to_many reconcile

interface Call {
	method: string;
	path: string;
	body?: string;
	csrf?: string;
}

/**
 * A fetch that records what the action asked for and answers the relationship
 * listing with `held`.
 */
function relationFetch(held: { id: string; target_id: string }[]) {
	const calls: Call[] = [];
	const fn = vi.fn(async (path: string, init?: RequestInit) => {
		calls.push({
			method: init?.method ?? 'GET',
			path,
			body: typeof init?.body === 'string' ? init.body : undefined,
			csrf: (init?.headers as Record<string, string> | undefined)?.['X-CSRF-Token']
		});
		if (path.includes('/relationships?')) return json({ data: held, total: held.length });
		return json({ ok: true });
	}) as unknown as typeof globalThis.fetch;
	return { fn, calls };
}

function saveEvent(fetchFn: typeof globalThis.fetch, m2m: Record<string, string[]>) {
	const fd = new FormData();
	fd.set('data', JSON.stringify({ title: 'One' }));
	fd.set('m2m_relations', JSON.stringify(m2m));
	return {
		fetch: fetchFn,
		cookies: mockCookies(),
		params: { schema: 'article', id: 'e1' },
		request: { formData: async () => fd }
	} as never;
}

async function runSave(event: never) {
	// A successful save ends in a redirect, which SvelteKit throws.
	try {
		const result = await actions.save(event);
		return result as { data?: { error?: string } } | undefined;
	} catch (e) {
		const err = e as { status?: number; location?: string };
		if (err.status === 303) return undefined;
		throw e;
	}
}

describe('content editor save, many_to_many fields', () => {
	it('adds the newly selected targets and removes the deselected ones', async () => {
		const { fn, calls } = relationFetch([
			{ id: 'rel-keep', target_id: 't1' },
			{ id: 'rel-drop', target_id: 't2' }
		]);

		const failure = await runSave(saveEvent(fn, { tags: ['t1', 't3'] }));
		expect(failure, 'a save carrying a many_to_many field must not fail').toBeUndefined();

		const deletes = calls.filter((c) => c.method === 'DELETE');
		expect(deletes.map((c) => c.path)).toEqual([
			'/api/admin/content/e1/relationships/rel-drop'
		]);

		// Both writes carry the double-submit token. Without it the engine answers
		// 403 to a same-origin call, and every save of a many_to_many field fails
		// for a reason that names the content route rather than the caller.
		for (const call of [...deletes, ...calls.filter((c) => c.method === 'POST')]) {
			expect(call.csrf, `${call.method} ${call.path} must carry the CSRF token`).toBe(
				'csrf-tok'
			);
		}

		const posts = calls.filter((c) => c.method === 'POST');
		expect(posts).toHaveLength(1);
		expect(JSON.parse(posts[0].body ?? '{}')).toMatchObject({
			target_id: 't3',
			field_name: 'tags',
			rel_type: 'many_to_many'
		});
	});

	it('never names a field where the route expects a relationship id', async () => {
		const { fn, calls } = relationFetch([]);
		await runSave(saveEvent(fn, { tags: ['t1'] }));

		// A PUT of the whole set to .../relationships/tags answers `invalid UUID
		// for parameter "relID"` and fails every save of an entry carrying a
		// many_to_many field.
		expect(calls.some((c) => c.path.endsWith('/relationships/tags'))).toBe(false);
		expect(calls.some((c) => c.method === 'PUT' && c.path.includes('/relationships'))).toBe(false);
	});

	it('reports a link the plugin refused instead of redirecting as a success', async () => {
		const fn = vi.fn(async (path: string, init?: RequestInit) => {
			if (path.includes('/relationships?')) return json({ data: [], total: 0 });
			if (init?.method === 'POST') return json({ error: 'failed to create relationship' }, 503);
			return json({ ok: true });
		}) as unknown as typeof globalThis.fetch;

		const failure = await runSave(saveEvent(fn, { tags: ['t1'] }));

		expect(failure?.data?.error).toBe('Entry saved. Could not add 1 link in tags.');
	});

	it('leaves a set that has not changed alone', async () => {
		const { fn, calls } = relationFetch([{ id: 'rel-1', target_id: 't1' }]);
		await runSave(saveEvent(fn, { tags: ['t1'] }));

		expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
		expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
	});
});


// restore: the rollback payload

function restoreEvent(fetchFn: typeof globalThis.fetch, revNum: string) {
	const fd = new FormData();
	fd.set('rev_num', revNum);
	return {
		fetch: fetchFn,
		cookies: mockCookies(),
		params: { schema: 'article', id: 'e1' },
		request: { formData: async () => fd }
	} as never;
}

async function runRestore(event: never) {
	try {
		return (await actions.restore(event)) as { data?: { error?: string } } | undefined;
	} catch (e) {
		const err = e as { status?: number };
		if (err.status === 303) return undefined;
		throw e;
	}
}

describe('content editor save, a schema refusal', () => {
	// The plugin answers a value the schema refuses with an errors array and no
	// error key. Relayed as the client's message, the banner showed the JSON.
	it('marks each refused field and keeps the body out of the banner', async () => {
		const { getSchema } = await import('@lyeve-labs/client-rest');
		vi.mocked(getSchema).mockResolvedValueOnce({
			name: 'article',
			fields: [{ name: 'email', field_type: 'email' }],
		} as never);
		const errors = [{ field: 'email', message: 'must be a valid email', code: 'email', rule: 'email' }];
		const fn = vi.fn(async () => json({ errors }, 422)) as unknown as typeof globalThis.fetch;

		const failure = (await runSave(saveEvent(fn, {}))) as {
			status: number;
			data: { error: string; fieldErrors: Record<string, string> };
		};

		expect(failure.status).toBe(422);
		expect(failure.data.fieldErrors).toEqual({ email: 'must be a valid email' });
		expect(failure.data.error).toBe('Check the highlighted fields.');
	});
});

describe('content editor restore', () => {
	it('names the revision by its number under the key the route reads', async () => {
		const { fn, calls } = relationFetch([]);

		const failure = await runRestore(restoreEvent(fn, '2'));
		expect(failure, 'restoring a listed revision must not fail').toBeUndefined();

		const rollback = calls.find((c) => c.path.endsWith('/rollback'));
		expect(rollback?.method).toBe('POST');
		// The route reads the sequence number under `to_revision` and no other
		// key.
		expect(JSON.parse(rollback?.body ?? '{}')).toEqual({ to_revision: 2 });
	});

	it('refuses a submission that names no revision instead of calling rollback', async () => {
		const { fn, calls } = relationFetch([]);

		const failure = await runRestore(restoreEvent(fn, ''));
		expect(failure?.data?.error).toBeTruthy();
		expect(calls.some((c) => c.path.endsWith('/rollback'))).toBe(false);
	});
});

/**
 * Records the PUT payloads and answers every call with `status`.
 */
function putRecorder(status = 200) {
	const puts: { path: string; body: Record<string, unknown> }[] = [];
	const fn = (async (path: string, init?: RequestInit) => {
		if (init?.method === 'PUT') puts.push({ path, body: JSON.parse(String(init.body)) });
		return new Response(JSON.stringify({ ok: true }), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	}) as unknown as typeof globalThis.fetch;
	return { fn, puts };
}

function titleSaveEvent(fetchFn: typeof globalThis.fetch) {
	const fd = new FormData();
	fd.set('data', JSON.stringify({ title: 'Edited', summary: 'kept in body' }));
	return {
		fetch: fetchFn,
		cookies: mockCookies(),
		params: { schema: 'article', id: 'e1' },
		request: { formData: async () => fd }
	} as never;
}

describe('content editor save, the title column', () => {
	it('sends title as the column and keeps it in the body the schema validates', async () => {
		const { fn, puts } = putRecorder();

		expect(await runSave(titleSaveEvent(fn))).toBeUndefined();

		const put = puts.find((c) => c.path.includes('/api/admin/content/e1'));
		expect(put, 'the save must PUT the entry').toBeDefined();

		// The load overlays the title column on top of body, so a title only in
		// body is written where nothing reads it and the edit vanishes on the
		// next render.
		expect(put!.body.title, 'title must be sent as the column the API declares').toBe('Edited');

		const body = put!.body.body as Record<string, unknown>;
		expect(body.summary, 'other fields still belong in body').toBe('kept in body');
		// The engine validates body against the schema, and title is one of the
		// schema's fields. Lifted out of body, a schema that declares it required
		// refuses the whole write and nothing is saved at all.
		expect(body.title, 'title is a schema field, so body must still carry it').toBe('Edited');
	});

	it('reports a failure rather than redirecting when the engine refuses the write', async () => {
		const { fn } = putRecorder(422);

		const failure = await runSave(titleSaveEvent(fn));

		expect(failure?.data?.error, 'a refused PUT must not read as a saved entry').toBeTruthy();
	});
});

function translationEvent(fetchFn: typeof globalThis.fetch, fields: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		fetch: fetchFn,
		cookies: mockCookies(),
		params: { schema: 'article', id: 'e1' },
		request: { formData: async () => fd }
	} as never;
}

async function runAction(name: 'saveTranslation' | 'markTranslated', event: never) {
	try {
		return (await actions[name](event)) as { status?: number; data?: { error?: string } } | undefined;
	} catch (e) {
		const err = e as { status?: number; location?: string };
		if (err.status === 303) return { status: 303, location: err.location } as never;
		throw e;
	}
}

describe('content editor translations', () => {
	it('creates the row for a locale that has none and updates one that exists', async () => {
		const { fn, calls } = relationFetch([]);
		const data = JSON.stringify({ title: 'Un', body: '<p>Salut</p>' });

		let out = await runAction('saveTranslation', translationEvent(fn, { locale: 'fr', exists: 'false', data }));
		expect(out).toMatchObject({ status: 303, location: '/admin/content/article/e1' });
		expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/api/admin/content/e1/translations' });
		expect(JSON.parse(calls.at(-1)?.body ?? '{}')).toEqual({
			locale: 'fr',
			title: 'Un',
			body: { title: 'Un', body: '<p>Salut</p>' }
		});

		out = await runAction('saveTranslation', translationEvent(fn, { locale: 'fr', exists: 'true', data }));
		expect(out).toMatchObject({ status: 303 });
		expect(calls.at(-1)).toMatchObject({ method: 'PUT', path: '/api/admin/content/e1/translations/fr' });
		// A save carries no status, so an outdated row stays outdated until marked.
		expect(JSON.parse(calls.at(-1)?.body ?? '{}')).not.toHaveProperty('translation_status');
	});

	it('marks a locale translated without sending its text', async () => {
		const { fn, calls } = relationFetch([]);
		const out = await runAction('markTranslated', translationEvent(fn, { locale: 'de' }));
		expect(out).toMatchObject({ status: 303 });
		expect(calls.at(-1)).toMatchObject({ method: 'PUT', path: '/api/admin/content/e1/translations/de' });
		expect(JSON.parse(calls.at(-1)?.body ?? '{}')).toEqual({ translation_status: 'translated' });
	});

	it('returns the refusal against the locale it was about', async () => {
		const fn = vi.fn(async () => json({ error: 'nope' }, 402)) as unknown as typeof globalThis.fetch;
		const out = await runAction('saveTranslation', translationEvent(fn, { locale: 'fr', exists: 'true', data: '{}' }));
		expect(out?.status).toBe(402);
		expect(out?.data).toMatchObject({ translationLocale: 'fr' });
		expect(out?.data?.error).toBeTruthy();
	});

	// The plugin refuses a new locale past its unlicensed ceiling with the bare code
	// cap_exceeded and the numbers beside it.
	it('reads the locale ceiling into its numbers instead of the bare code', async () => {
		const fn = vi.fn(async () =>
			json({ error: 'cap_exceeded', cap: 'locales', limit: 2, current: 2 }, 402)
		) as unknown as typeof globalThis.fetch;
		const out = await runAction('saveTranslation', translationEvent(fn, { locale: 'de', exists: 'false', data: JSON.stringify({ title: 'Eins' }) }));
		expect(out?.status).toBe(402);
		expect(out?.data?.error).toContain('2 of 2');
		expect(out?.data?.error).not.toContain('cap_exceeded');
		expect(out?.data).toMatchObject({ translationLocale: 'de' });
	});

	// The plugin refuses a new translation with no title. Left empty, the
	// locale's reader gets the source, so the first save sends the source title.
	it('sends the source title on the first save when the title was left empty', async () => {
		const calls: Call[] = [];
		const fn = vi.fn(async (path: string, init?: RequestInit) => {
			calls.push({ method: init?.method ?? 'GET', path, body: typeof init?.body === 'string' ? init.body : undefined });
			return path === '/api/admin/content/e1' ? json(entry) : json({ ok: true }, 201);
		}) as unknown as typeof globalThis.fetch;
		const out = await runAction(
			'saveTranslation',
			translationEvent(fn, { locale: 'fr', exists: 'false', data: JSON.stringify({ title: '', body: '<p>Salut</p>' }) })
		);
		expect(out).toMatchObject({ status: 303 });
		const post = calls.find((c) => c.method === 'POST');
		const sent = JSON.parse(post?.body ?? '{}');
		expect(sent).toMatchObject({ title: 'One', body: { body: '<p>Salut</p>' } });
		// An empty title in the body would be laid over the title column.
		expect(sent.body).not.toHaveProperty('title');
	});
});

describe('content editor load, releases', () => {
	function releasesFetch(membership: () => Response) {
		return vi.fn(async (path: string) => {
			if (path.includes('/api/admin/content/releases/r1')) return membership();
			if (path.includes('/api/admin/content/releases')) return json({ data: [{ id: 'r1', name: 'Spring', status: 'draft' }] });
			if (path.includes('/revisions')) return json([]);
			if (path.includes('/api/admin/content?')) return json({ data: [] });
			return json(entry);
		}) as unknown as typeof globalThis.fetch;
	}

	async function releasesWith(membership: () => Response) {
		const out = (await load({
			fetch: releasesFetch(membership),
			cookies: mockCookies(),
			params: { schema: 'article', id: 'e1' },
			parent: async () => ({ plugins: none }),
		} as never)) as { releases: { open: unknown[]; holding: string[]; failed: boolean } | null };
		return out.releases;
	}

	// A release whose items could not be read was counted as one that does not
	// hold the entry, so Add to release offered a release that already held it.
	it('says the releases could not be read when one of them could not', async () => {
		const releases = await releasesWith(() => json({ error: 'unavailable' }, 503));
		expect(releases).toMatchObject({ failed: true, holding: [] });
	});

	it('reads a release that holds the entry as holding it', async () => {
		const releases = await releasesWith(() => json({ id: 'r1', name: 'Spring', status: 'draft', items: [{ entry_id: 'e1' }] }));
		expect(releases).toMatchObject({ failed: false, holding: ['r1'] });
	});
});

describe('content editor load, mentions', () => {
	// The engine mails only accounts of the entry's own tenant and refuses a
	// comment that mentions anyone else, the first super admin included, who
	// belongs to no tenant. The directory a super admin reads holds them all.
	it('offers to mention only accounts of the entry\'s tenant, and still names every author', async () => {
		const fetchFn = vi.fn(async (path: string) => {
			if (path.includes('/api/admin/users')) {
				return json([
					{ id: 'setup', email: 'setup@test.invalid', tenant_id: '' },
					{ id: 'ana', email: 'ana@test.invalid', tenant_id: 't1' },
					{ id: 'bo', email: 'bo@test.invalid', tenant_id: 't2' },
				]);
			}
			if (path.includes('/comments')) return json({ data: [] });
			if (path.includes('/revisions')) return json([]);
			if (path.includes('/api/admin/content?')) return json({ data: [] });
			return json({ ...entry, tenant_id: 't1' });
		}) as unknown as typeof globalThis.fetch;
		const out = (await load({
			fetch: fetchFn,
			cookies: mockCookies(),
			params: { schema: 'article', id: 'e1' },
			parent: async () => ({ plugins: none }),
		} as never)) as { comments: { people: { id: string }[]; mentionable: { id: string }[] } };
		expect(out.comments.mentionable.map((p) => p.id)).toEqual(['ana']);
		expect(out.comments.people.map((p) => p.id)).toEqual(['setup', 'ana', 'bo']);
	});

	// The directory is one page of every tenant's accounts, oldest first, so a
	// tenant created after two hundred others has none of its people on it.
	// The tenancy plugin lists the entry's tenant alone. A member whose home is
	// another tenant may act here, but the engine refuses to mention them.
	it('reads the entry\'s tenant from the tenancy plugin when the directory page holds none of it', async () => {
		const others = Array.from({ length: 200 }, (_, i) => ({ id: `o${i}`, email: `o${i}@test.invalid`, tenant_id: 't1' }));
		const fetchFn = vi.fn(async (path: string) => {
			if (path.includes('/api/admin/users')) return json(others);
			if (path.includes('/api/admin/tenant-members/late')) {
				return json({
					members: [
						{ id: 'ana', email: 'ana@test.invalid', disabled: false, home: true, roles: ['editor'] },
						{ id: 'guest', email: 'guest@test.invalid', disabled: false, home: false, roles: ['editor'] },
					],
					total: 2,
				});
			}
			if (path.includes('/comments')) return json({ data: [] });
			if (path.includes('/revisions')) return json([]);
			if (path.includes('/api/admin/content?')) return json({ data: [] });
			return json({ ...entry, tenant_id: 'late' });
		}) as unknown as typeof globalThis.fetch;
		const out = (await load({
			fetch: fetchFn,
			cookies: mockCookies(),
			params: { schema: 'article', id: 'e1' },
			parent: async () => ({ plugins: { state: 'named', running: ['multitenant'], withheld: [] } }),
		} as never)) as { comments: { people: { id: string }[]; mentionable: { id: string }[] } };
		expect(out.comments.mentionable.map((p) => p.id)).toEqual(['ana']);
		expect(out.comments.people.map((p) => p.id)).toContain('ana');
	});
});

describe('content editor, an integer past 2^53', () => {
	const fields = [
		{ name: 'title', field_type: 'text', required: false, unique: false, indexed: false },
		{ name: 'views', field_type: 'integer', required: false, unique: false, indexed: false },
		{ name: 'price', field_type: 'decimal', precision: 10, scale: 2, required: false, unique: false, indexed: false },
		{ name: 'stats', field_type: 'json', required: false, unique: false, indexed: false },
	] as const;
	const stored =
		'{"id":"e1","created_at":"","updated_at":"","title":"Old","status":"draft",' +
		'"body":{"title":"Old","views":9007199254740993,"price":"19.90","stats":{"big":1790000000000000000}}}';

	it('saves a title-only edit with the stored digits, and a json number stays a number', async () => {
		vi.mocked(getSchema).mockResolvedValueOnce({ name: 'article', fields: [...fields] } as never);
		const puts: string[] = [];
		const fetchFn = vi.fn(async (path: string, init?: RequestInit) => {
			if (init?.method === 'PUT') {
				puts.push(String(init.body));
				return json({ ok: true });
			}
			if (path.includes('/revisions')) {
				return new Response('{"data":[{"id":"r1","revision_num":1,"title":"Old","body":{"views":9007199254740993,"stats":{"big":1790000000000000000}}}],"total_count":1}');
			}
			if (path.includes('/api/admin/content?')) return json({ data: [] });
			return new Response(stored, { headers: { 'content-type': 'application/json' } });
		}) as unknown as typeof globalThis.fetch;
		const event = {
			fetch: fetchFn,
			cookies: mockCookies(),
			params: { schema: 'article', id: 'e1' },
			parent: async () => ({ plugins: none }),
		};

		const page = (await load(event as never)) as {
			item: { data: Record<string, unknown> };
			revisions: { data: Record<string, unknown> }[];
		};
		expect(page.item.data.views).toBe('9007199254740993');
		expect(page.revisions[0].data.views).toBe('9007199254740993');

		const form = buildFromData([...fields], page.item.data);
		form.title = 'New';
		const fd = new FormData();
		fd.set('data', serialize([...fields], form));
		await runSave({ ...event, request: { formData: async () => fd } } as never);

		expect(puts).toEqual([
			'{"title":"New","body":{"title":"New","views":"9007199254740993","price":"19.90","stats":{"big":1790000000000000000}}}',
		]);
	});
});
