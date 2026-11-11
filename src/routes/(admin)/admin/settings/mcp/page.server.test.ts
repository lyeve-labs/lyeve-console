import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/authz', async () => {
	const { createClient } = await vi.importActual<typeof import('@lyeve-labs/client')>('@lyeve-labs/client');
	return { authedClient: (event: { fetch: typeof fetch }) => createClient(event.fetch) };
});

import { actions, load } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;
type Call = { method: string; path: string; body: unknown };

function json(body: unknown, status = 200): Response {
	return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const RUNNING = { state: 'named', running: ['mcp'], withheld: [] };
const AGENT = {
	kind: 'api_key',
	credential_id: '0b7f6c2e-1111-4111-8111-111111111111',
	person_id: 'u1',
	first_used_at: '2026-11-10T08:00:00Z',
	last_used_at: '2026-11-11T09:30:00Z',
};

/** A fake engine that answers by path and records each request. */
function engine(routes: Record<string, () => Response>) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const path = String(url);
		calls.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		for (const [needle, reply] of Object.entries(routes)) if (path.startsWith(needle)) return reply();
		return json({ error: 'not found', code: 'not_found' }, 404);
	});
	return { calls, fetch };
}

function loadEvent(routes: Record<string, () => Response>, plugins: unknown = RUNNING) {
	const { calls, fetch } = engine(routes);
	return {
		calls,
		event: { fetch, url: new URL('https://cms.example.com/admin/settings/mcp'), parent: async () => ({ plugins }) } as never,
	};
}

function actionEvent(fields: Record<string, string>, routes: Record<string, () => Response>) {
	const { calls, fetch } = engine(routes);
	const form = new FormData();
	form.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	const url = new URL('https://cms.example.com/admin/settings/mcp');
	return { calls, event: { fetch, url, request: new Request(url, { method: 'POST', body: form }) } as never };
}

const READS = {
	'/api/admin/mcp/settings/agents': () => json({ limit: 1, agents: [AGENT] }),
	'/api/admin/mcp/settings': () => json({ enabled: true }),
	'/api/admin/users': () => json({ data: [{ id: 'u1', email: 'ada@example.com', tenant_id: 't1' }] }),
};

describe('MCP settings load', () => {
	it('reads the switch, the agents and their limit, and the addresses on the console origin', async () => {
		const { event } = loadEvent(READS);
		const out = (await load(event)) as Loaded;
		expect(out.settings).toEqual({ ok: true, value: { enabled: true } });
		expect(out.agents).toEqual({ ok: true, value: { limit: 1, agents: [AGENT] } });
		expect(out.people).toEqual({ u1: 'ada@example.com' });
		expect(out.endpoints).toEqual({ content: 'https://cms.example.com/api/v1/mcp', admin: 'https://cms.example.com/api/admin/mcp' });
	});

	it('reads a limit of 0 as no limit, as the AI license sends it', async () => {
		const { event } = loadEvent({ ...READS, '/api/admin/mcp/settings/agents': () => json({ limit: 0, agents: [AGENT, AGENT] }) });
		const out = (await load(event)) as Loaded;
		expect(out.agents).toMatchObject({ ok: true, value: { limit: 0 } });
	});

	it('asks nothing of an engine that does not run the plugin', async () => {
		const { event, calls } = loadEvent(READS, { state: 'named', running: ['ai'], withheld: [] });
		const out = (await load(event)) as Loaded;
		expect(out.settings).toEqual({ ok: false, gate: { state: 'absent' } });
		expect(out.agents).toEqual({ ok: false, gate: { state: 'absent' } });
		expect(calls).toEqual([]);
	});

	it('keeps a failed read as a failure and never its text', async () => {
		const down = () => json({ error: 'dial tcp 10.0.0.4:5432: connection refused' }, 500);
		const { event } = loadEvent({ '/api/admin/mcp/settings/agents': down, '/api/admin/mcp/settings': down });
		const out = (await load(event)) as Loaded;
		expect(out.settings).toEqual({ ok: false, gate: { state: 'error', message: 'Could not load the MCP server setting.' } });
		expect(out.agents).toEqual({ ok: false, gate: { state: 'error', message: 'Could not load the connected agents.' } });
	});
});

describe('MCP settings writes', () => {
	it('turns the server on', async () => {
		const { event, calls } = actionEvent({ enabled: 'true' }, { '/api/admin/mcp/settings': () => json({ enabled: true }) });
		expect(await actions.toggle(event)).toEqual({ action: 'toggle', settings: { enabled: true } });
		expect(calls).toEqual([{ method: 'PUT', path: '/api/admin/mcp/settings', body: { enabled: true } }]);
	});

	it('sends nothing without a value to set', async () => {
		const { event, calls } = actionEvent({}, {});
		expect(await actions.toggle(event)).toMatchObject({ status: 400, data: { error: 'This form is missing its setting. Reload the page and try again.' } });
		expect(calls).toEqual([]);
	});

	it('names the roles the engine admits when it refuses the reader', async () => {
		const { event } = actionEvent({ enabled: 'false' }, { '/api/admin/mcp/settings': () => json({ error: 'insufficient permissions', code: 'forbidden' }, 403) });
		expect(await actions.toggle(event)).toMatchObject({ data: { error: 'Only an admin or a super admin can change this.' } });
	});

	it('disconnects the named agent', async () => {
		const { event, calls } = actionEvent({ kind: 'api_key', credential: 'k1' }, { '/api/admin/mcp/settings/agents/': () => json(null, 204) });
		expect(await actions.disconnect(event)).toEqual({ action: 'disconnect', disconnected: 'k1' });
		expect(calls).toEqual([{ method: 'DELETE', path: '/api/admin/mcp/settings/agents/api_key/k1', body: undefined }]);
	});

	it('says an agent already gone is no longer connected', async () => {
		const { event } = actionEvent({ kind: 'session', credential: 'u1' }, {});
		expect(await actions.disconnect(event)).toMatchObject({ status: 404, data: { error: 'This agent is no longer connected.' } });
	});

	it('gives a failed disconnect its own sentence and never the engine text', async () => {
		const { event } = actionEvent({ kind: 'session', credential: 'u1' }, { '/api/admin/mcp/settings/agents/': () => json({ error: 'pq: deadlock' }, 503) });
		expect(await actions.disconnect(event)).toMatchObject({ data: { error: 'Could not disconnect the agent. Try again.' } });
	});
});
