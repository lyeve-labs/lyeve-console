import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const introspect = vi.fn();
const listPersisted = vi.fn();
const registerPersisted = vi.fn();
const togglePersisted = vi.fn();
const deletePersisted = vi.fn();
vi.mock('$lib/server/authz', () => ({ authedClient: () => ({}), requireUser: async () => ({}) }));
vi.mock('$lib/api/graphql', async (orig) => ({
	...(await orig<typeof import('$lib/api/graphql')>()),
	introspect: (...a: unknown[]) => introspect(...a),
	listPersisted: (...a: unknown[]) => listPersisted(...a),
	registerPersisted: (...a: unknown[]) => registerPersisted(...a),
	togglePersisted: (...a: unknown[]) => togglePersisted(...a),
	deletePersisted: (...a: unknown[]) => deletePersisted(...a),
}));

const { load, actions } = await import('./+page.server');

const event = (running: string[], search = '') =>
	({
		url: new URL(`http://localhost/admin/settings/graphql/persisted${search}`),
		parent: async () => ({ plugins: { state: 'named', running, withheld: [] }, user: { roles: ['admin'] } }),
	}) as never;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('persisted queries load', () => {
	it('asks nothing while the GraphQL plugin does not run', async () => {
		const data = (await load(event([]))) as { gate: { state: string } };
		expect(data.gate.state).toBe('absent');
		expect(listPersisted).not.toHaveBeenCalled();
	});

	it('keeps a failed allowlist read to its section, and asks nothing of the schema', async () => {
		listPersisted.mockRejectedValue(new Error('down'));
		const data = (await load(event(['graphql']))) as Record<string, unknown>;
		expect(data.gate).toEqual({ state: 'ok' });
		expect(data.persisted).toMatchObject({ ok: false, gate: { state: 'error' } });
		expect(introspect).not.toHaveBeenCalled();
	});

	it('keeps a refused allowlist as forbidden rather than as no queries', async () => {
		listPersisted.mockRejectedValue(new ApiError(403, 'forbidden'));
		const data = (await load(event(['graphql']))) as Record<string, unknown>;
		expect(data.persisted).toEqual({ ok: false, gate: { state: 'forbidden' } });
	});
});
describe('register', () => {
	it('refuses an empty query before asking the engine', async () => {
		const form = new FormData();
		form.set('query', '  ');
		const res = await actions.register({ request: new Request('http://x', { method: 'POST', body: form }) } as never);
		expect((res as { status: number }).status).toBe(400);
		expect(registerPersisted).not.toHaveBeenCalled();
	});
});

describe('switching and deleting a persisted query', () => {
	const post = (hash: string) => {
		const form = new FormData();
		form.set('confirmed', 'yes');
		form.set('hash', hash);
		return { request: new Request('http://x', { method: 'POST', body: form }) } as never;
	};

	it('switches and deletes the named query', async () => {
		togglePersisted.mockResolvedValue({});
		deletePersisted.mockResolvedValue(undefined);
		expect(await actions.toggle(post('abc'))).toEqual({ toggled: 'abc' });
		expect(togglePersisted).toHaveBeenCalledWith(expect.anything(), 'abc');
		expect(await actions.delete(post('abc'))).toEqual({ deleted: 'abc' });
		expect(deletePersisted).toHaveBeenCalledWith(expect.anything(), 'abc');
	});

	it('names nothing to switch or delete without a query', async () => {
		expect(await actions.toggle(post(''))).toMatchObject({ status: 400, data: { action: 'toggle', error: 'This form is missing its query. Reload the page and try again.' } });
		expect(await actions.delete(post(''))).toMatchObject({ status: 400, data: { action: 'delete', error: 'This form is missing its query. Reload the page and try again.' } });
	});

	it('relays the plugin refusal under its action', async () => {
		togglePersisted.mockRejectedValue(new ApiError(404, 'persisted query not found', { error: 'persisted query not found', code: 'not_found' }));
		deletePersisted.mockRejectedValue(new ApiError(404, 'persisted query not found', { error: 'persisted query not found', code: 'not_found' }));
		expect(await actions.toggle(post('abc'))).toMatchObject({ data: { action: 'toggle', error: 'persisted query not found' } });
		expect(await actions.delete(post('abc'))).toMatchObject({ data: { action: 'delete', error: 'persisted query not found' } });
	});

	it('keeps an outage body off the page', async () => {
		togglePersisted.mockRejectedValue(new ApiError(503, 'dial tcp: connection refused'));
		deletePersisted.mockRejectedValue(new ApiError(503, 'dial tcp: connection refused'));
		expect(await actions.toggle(post('abc'))).toMatchObject({ data: { error: 'Could not enable or disable the query. Try again.' } });
		expect(await actions.delete(post('abc'))).toMatchObject({ data: { error: 'Could not delete the query. Try again.' } });
	});
});

describe('the persisted query total', () => {
	it('hands over how many the plugin holds beside the page it read', async () => {
		listPersisted.mockResolvedValue({ data: [{ hash: 'h1' }], total: 340 });
		const data = (await load(event(['graphql']))) as Record<string, unknown>;
		expect(data.persistedTotal).toBe(340);
	});

	it('reads the window the URL names, so every query can be reached', async () => {
		listPersisted.mockResolvedValue({ data: [{ hash: 'h51' }], total: 340 });
		const data = (await load(event(['graphql'], '?limit=50&offset=50'))) as Record<string, unknown>;
		expect(listPersisted).toHaveBeenCalledWith(expect.anything(), 50, 50);
		expect(data).toMatchObject({ limit: 50, offset: 50 });
	});

	it('sends a page past the end back to the last page that holds queries', async () => {
		listPersisted.mockResolvedValue({ data: [], total: 60 });
		await expect(load(event(['graphql'], '?limit=50&offset=200'))).rejects.toMatchObject({
			status: 307,
			location: '/admin/settings/graphql/persisted?limit=50&offset=50',
		});
	});
});
