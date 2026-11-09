import { beforeEach, describe, expect, it, vi } from 'vitest';

const introspect = vi.fn();
const listPersisted = vi.fn();
vi.mock('$lib/server/authz', () => ({ authedClient: () => ({}), requireUser: async () => ({}) }));
vi.mock('$lib/api/graphql', async (orig) => ({
	...(await orig<typeof import('$lib/api/graphql')>()),
	introspect: (...a: unknown[]) => introspect(...a),
	listPersisted: (...a: unknown[]) => listPersisted(...a),
}));

const { load } = await import('./+page.server');

const event = (running: string[]) =>
	({
		url: new URL('http://localhost/admin/settings/graphql'),
		parent: async () => ({ plugins: { state: 'named', running, withheld: [] }, user: { roles: ['admin'] } }),
	}) as never;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('graphql schema load', () => {
	it('asks nothing while the GraphQL plugin does not run', async () => {
		const data = (await load(event([]))) as { gate: { state: string } };
		expect(data.gate.state).toBe('absent');
		expect(introspect).not.toHaveBeenCalled();
	});

	it('keeps a failed schema read to its section, so the endpoints still show', async () => {
		introspect.mockRejectedValue(new Error('down'));
		const data = (await load(event(['graphql']))) as Record<string, unknown>;
		expect(data.gate).toEqual({ state: 'ok' });
		expect(data.schema).toMatchObject({ ok: false, gate: { state: 'error' } });
	});

	it('reads the schema alone, and leaves the allowlist to its own tab', async () => {
		introspect.mockResolvedValue({ roots: { query: [], mutation: [], subscription: [] }, refused: null });
		const data = (await load(event(['graphql']))) as Record<string, unknown>;
		expect(data.schema).toMatchObject({ ok: true });
		expect(listPersisted).not.toHaveBeenCalled();
	});
});
