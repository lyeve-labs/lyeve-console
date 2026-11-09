import { beforeEach, describe, expect, it, vi } from 'vitest';

const authz = vi.hoisted(() => ({ requireRole: vi.fn(async () => ({})) }));
vi.mock('$lib/server/authz', async () => {
	const { createClient } = await vi.importActual<typeof import('@lyeve-labs/client')>('@lyeve-labs/client');
	return {
		requireRole: authz.requireRole,
		authedClient: (event: { fetch?: typeof fetch }) => createClient(event.fetch ?? globalThis.fetch),
	};
});

const api = vi.hoisted(() => ({
	listJobs: vi.fn(),
	listSchedules: vi.fn(),
	getSchemas: vi.fn(),
}));

vi.mock('@lyeve-labs/client-rest', () => ({ getSchemas: api.getSchemas }));
vi.mock('$lib/api/data-export', async (importOriginal) => ({
	...((await importOriginal()) as object),
	listJobs: api.listJobs,
	listSchedules: api.listSchedules,
}));

import { actions, load } from './+page.server';

function event(query = '') {
	return {
		depends: vi.fn(),
		parent: async () => ({ plugins: null }),
		url: new URL(`http://admin.test/admin/data-export${query}`),
	} as never;
}

type Loaded = {
	schedules: { ok: boolean; value?: unknown[]; gate?: { state: string } };
	schemas: { ok: boolean; value?: string[] };
	gate: { state: string };
};

beforeEach(() => {
	vi.clearAllMocks();
	api.listJobs.mockResolvedValue({ data: [], total_count: 0 });
	api.listSchedules.mockResolvedValue({ data: [], total_count: 0 });
	api.getSchemas.mockResolvedValue([{ name: 'page' }, { name: 'article' }]);
});

describe('data export load', () => {
	it('keeps a failed schedule read as a failure, not as no schedules', async () => {
		api.listSchedules.mockRejectedValue(new Error('boom'));

		const result = (await load(event())) as unknown as Loaded;

		expect(result.gate.state).toBe('ok');
		expect(result.schedules.ok).toBe(false);
		expect(result.schedules.gate?.state).toBe('error');
	});

	it('keeps a failed schema read as a failure, not as a tenant with no schemas', async () => {
		api.getSchemas.mockRejectedValue(new Error('boom'));

		const result = (await load(event())) as unknown as Loaded;

		expect(result.schemas.ok).toBe(false);
	});

	it('hands over the lists a read answered with', async () => {
		const result = (await load(event())) as unknown as Loaded;

		expect(result.schedules).toEqual({ ok: true, value: [] });
		expect(result.schemas).toEqual({ ok: true, value: ['article', 'page'] });
	});

	it('sends a page past the end back to the last page', async () => {
		api.listJobs.mockResolvedValue({ data: [], total_count: 60 });

		await expect(load(event('?offset=200'))).rejects.toMatchObject({
			status: 307,
			location: '/admin/data-export?offset=50',
		});
	});
});

type Call = { method: string; path: string; body: unknown };
type Failure = { status: number; data: { action: string; error: string } };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** An action event against a fake engine that records each request and answers it with `reply`. */
function write(fields: Record<string, string | string[]>, reply: Response = json({})) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		calls.push({ method: init?.method ?? 'GET', path: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return reply.clone();
	});
	const form = new FormData();
	form.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) form.append(k, one);
	const url = new URL('http://admin.test/admin/data-export');
	return { calls, event: { fetch, url, request: new Request(url, { method: 'POST', body: form }) } as never };
}

const EXPORT = { name: ' Nightly ', format: 'ndjson', schemas: ['page', 'article'], statuses: ['published', 'bogus'], include_media: 'true' };
const OUTAGE = json({ error: 'dial tcp 10.0.0.4:5432: connection refused' }, 503);

describe('data export writes', () => {
	const all = ['start', 'cancel', 'createSchedule', 'toggleSchedule', 'deleteSchedule'] as const;

	it.each(all)('holds %s to an admin', async (name) => {
		authz.requireRole.mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403 }));
		const { event, calls } = write({ id: 'j1', ...EXPORT, cron_expression: '0 3 * * *' });
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(authz.requireRole).toHaveBeenLastCalledWith(event, ['admin', 'super_admin']);
		expect(calls).toEqual([]);
	});

	it('starts an export with its filters and drops a status the plugin does not know', async () => {
		const { event, calls } = write(EXPORT, json({ id: 'j9' }));
		expect(await actions.start(event)).toEqual({ started: 'j9' });
		expect(calls).toEqual([
			{
				method: 'POST',
				path: '/api/admin/data-export/start',
				body: {
					name: 'Nightly',
					format: 'ndjson',
					filter: { schemas: ['page', 'article'], statuses: ['published'] },
					include_schemas: false,
					include_media: true,
				},
			},
		]);
	});

	it('asks for a name and a format before it starts anything', async () => {
		const unnamed = write({ ...EXPORT, name: ' ' });
		expect(((await actions.start(unnamed.event)) as Failure).data).toEqual({
			action: 'start',
			error: 'Enter a name for the export.',
		});
		const unknown = write({ ...EXPORT, format: 'xlsx' });
		expect(((await actions.start(unknown.event)) as Failure).data).toEqual({ action: 'start', error: 'Choose a format.' });
		expect([...unnamed.calls, ...unknown.calls]).toEqual([]);
	});

	it('cancels the named job', async () => {
		const { event, calls } = write({ id: 'j1' });
		expect(await actions.cancel(event)).toEqual({ canceled: 'j1' });
		expect(calls).toEqual([{ method: 'POST', path: '/api/admin/data-export/jobs/j1/cancel', body: {} }]);
	});

	it('creates a schedule around the export it runs', async () => {
		const { event, calls } = write({ ...EXPORT, cron_expression: ' 0 3 * * * ', enabled: 'true' });
		expect(await actions.createSchedule(event)).toEqual({ scheduled: 'Nightly' });
		expect(calls).toEqual([
			{
				method: 'POST',
				path: '/api/admin/data-export/schedules',
				body: {
					name: 'Nightly',
					cron_expression: '0 3 * * *',
					enabled: true,
					export_config: {
						format: 'ndjson',
						filter: { schemas: ['page', 'article'], statuses: ['published'] },
						include_schemas: false,
						include_media: true,
					},
				},
			},
		]);
	});

	it('asks when a schedule runs before it creates one', async () => {
		const { event, calls } = write({ ...EXPORT, cron_expression: '' });
		expect(((await actions.createSchedule(event)) as Failure).data).toEqual({ action: 'createSchedule', error: 'Choose when the schedule runs.' });
		expect(calls).toEqual([]);
	});

	it('pauses and deletes the named schedule', async () => {
		const paused = write({ id: 's1', enabled: 'false' });
		expect(await actions.toggleSchedule(paused.event)).toEqual({ toggled: 's1', enabled: false });
		expect(paused.calls).toEqual([{ method: 'PUT', path: '/api/admin/data-export/schedules/s1', body: { enabled: false } }]);
		const deleted = write({ id: 's1' });
		expect(await actions.deleteSchedule(deleted.event)).toEqual({ deleted: 's1' });
		expect(deleted.calls).toEqual([{ method: 'DELETE', path: '/api/admin/data-export/schedules/s1', body: undefined }]);
	});

	it.each([
		['cancel', 'This form is missing its export. Reload the page and try again.'],
		['toggleSchedule', 'This form is missing its schedule. Reload the page and try again.'],
		['deleteSchedule', 'This form is missing its schedule. Reload the page and try again.'],
	] as const)('names nothing to %s without a request', async (name, sentence) => {
		const { event, calls } = write({});
		expect(((await actions[name](event)) as Failure).data).toEqual({ action: name, error: sentence });
		expect(calls).toEqual([]);
	});

	it.each(all)('relays the engine refusal on %s under its action', async (name) => {
		const { event } = write({ id: 'j1', ...EXPORT, cron_expression: '0 3 * * *' }, json({ error: 'cron_expression is not valid', code: 'http_422' }, 422));
		const out = (await actions[name](event)) as Failure;
		expect(out.data).toEqual({ action: name, error: 'cron_expression is not valid' });
	});

	it('says to retry when every export slot is taken', async () => {
		const { event } = write(EXPORT, json({ error: 'too many concurrent exports running, try again later' }, 503));
		expect(((await actions.start(event)) as Failure).data).toEqual({
			action: 'start',
			error: 'Too many exports are running. Wait for one to finish, then start this one.',
		});
	});

	it('reads any other 503 on start as an outage', async () => {
		const { event } = write(EXPORT, json({ error: 'service unavailable' }, 503));
		expect(((await actions.start(event)) as Failure).data).toEqual({ action: 'start', error: 'Could not start the export. Try again.' });
	});

	it.each([
		['start', 'Could not start the export. Try again.'],
		['cancel', 'Could not cancel the export. Try again.'],
		['createSchedule', 'Could not create the schedule. Try again.'],
		['toggleSchedule', 'Could not save the schedule. Try again.'],
		['deleteSchedule', 'Could not delete the schedule. Try again.'],
	] as const)('keeps outage detail off the page on %s', async (name, sentence) => {
		const { event } = write({ id: 'j1', ...EXPORT, cron_expression: '0 3 * * *' }, OUTAGE);
		expect(((await actions[name](event)) as Failure).data).toEqual({ action: name, error: sentence });
	});
});
