import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
const session = vi.hoisted(() => ({ user: { roles: ['super_admin'] } as { roles: string[] } }));
vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
	loadUser: vi.fn(async () => session.user),
}));

import { actions, load } from './+page.server';

const bundle = {
	format: 'lyeve-config',
	version: 1,
	source: 'lyeve/staging',
	exported_at: '2026-10-02T09:00:00Z',
	sealing: {},
	sections: { schemas: {}, flows: [] },
};

const plan = {
	sections: {
		schemas: { changes: [{ key: 'articles', action: 'update' }] },
		flows: { changes: [{ key: 'notify', action: 'create' }] },
	},
	changes: 2,
	problems: 0,
};

function event(form: Record<string, string> = {}) {
	const data = new FormData();
	for (const [k, v] of Object.entries(form)) data.set(k, v);
	return { request: { formData: async () => data } } as never;
}

function loadEvent(roles: string[]) {
	session.user = { roles };
	return {} as never;
}

const sync = { bundle: JSON.stringify(bundle), passphrase: 'correct horse battery', prune: 'false' };

beforeEach(() => vi.clearAllMocks());

describe('config sync load', () => {
	it('refuses anyone but a super admin', async () => {
		await expect(load(loadEvent(['admin']))).rejects.toMatchObject({ status: 403, body: { message: 'Only a super admin can open this page.' } });
	});

	it('offers the page to a super admin and leaves the license to the engine', async () => {
		await expect(load(loadEvent(['super_admin']))).resolves.toEqual({});
	});
});

describe('config sync export', () => {
	it('asks for a long enough passphrase before it calls the engine', async () => {
		const out = (await actions.export(event({ passphrase: 'short' }))) as { status: number; data: { fields: Record<string, string> } };
		expect(out.status).toBe(400);
		expect(out.data.fields.passphrase).toContain('12');
		expect(engine.post).not.toHaveBeenCalled();
	});

	it('returns the bundle with a dated file name', async () => {
		engine.post.mockResolvedValue(bundle);
		const out = (await actions.export(event({ passphrase: 'correct horse battery' }))) as Record<string, unknown>;
		expect(engine.post).toHaveBeenCalledWith('/api/admin/config-sync/export', { passphrase: 'correct horse battery' });
		expect(out.filename).toBe('lyeve-config-2026-10-02.json');
		expect(JSON.parse(String(out.bundle)).format).toBe('lyeve-config');
		expect(out.sections).toEqual(['schemas', 'flows']);
	});

	it('returns the refusal when the license lacks the capability', async () => {
		engine.post.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_capability', upgrade_url: '' }),
		);
		const out = (await actions.export(event({ passphrase: 'correct horse battery' }))) as { status: number; data: Record<string, unknown> };
		expect(out.status).toBe(402);
		expect(out.data.refused).toEqual({ kind: 'feature', feature: 'example-capability', plugin: 'example', upgradeUrl: '' });
	});
});

describe('config sync diff and apply', () => {
	it('refuses a file that is not a bundle without calling the engine', async () => {
		const out = (await actions.diff(event({ ...sync, bundle: '{"schemas":[]}' }))) as { status: number; data: { fields: Record<string, string> } };
		expect(out.status).toBe(400);
		expect(out.data.fields.bundle).toContain('not a configuration bundle');
		expect(engine.post).not.toHaveBeenCalled();
	});

	it('sends the bundle, the passphrase and the prune choice to diff', async () => {
		engine.post.mockResolvedValue(plan);
		const out = (await actions.diff(event({ ...sync, prune: 'true' }))) as Record<string, unknown>;
		expect(engine.post).toHaveBeenCalledWith('/api/admin/config-sync/diff', { passphrase: 'correct horse battery', bundle, prune: true });
		expect(out).toMatchObject({ scope: 'sync', mode: 'diff', plan });
	});

	it('relays a wrong passphrase as the engine said it', async () => {
		engine.post.mockRejectedValue(new ApiError(422, 'the passphrase does not open this bundle', { error: 'the passphrase does not open this bundle', code: 'http_422' }));
		const out = (await actions.diff(event(sync))) as { status: number; data: Record<string, unknown> };
		expect(out.status).toBe(422);
		expect(out.data.error).toBe('the passphrase does not open this bundle');
	});

	it('asks the engine for a dry run and answers its plan', async () => {
		engine.post.mockResolvedValue({ applied: false, dry_run: true, plan });
		const out = (await actions.dryRun(event(sync))) as Record<string, unknown>;
		expect(engine.post.mock.calls[0][1]).toMatchObject({ dry_run: true });
		expect(out).toMatchObject({ mode: 'dry-run', plan });
	});

	it('shows the problems a dry run found rather than an error', async () => {
		const blocked = { ...plan, problems: 1, sections: { flows: { changes: [], problems: [{ key: 'big', message: 'needs example-capability', feature: 'example-capability' }] } } };
		engine.post.mockRejectedValue(new ApiError(422, '422', { applied: false, plan: blocked }));
		const out = (await actions.dryRun(event(sync))) as Record<string, unknown>;
		expect(out).toMatchObject({ mode: 'dry-run', plan: blocked });
	});

	it('answers what applied', async () => {
		const result = { applied: true, plan, schemas_applied: ['articles'], sections_applied: ['flows'] };
		engine.post.mockResolvedValue(result);
		const out = (await actions.apply(event(sync))) as Record<string, unknown>;
		expect(engine.post.mock.calls[0][1]).toMatchObject({ dry_run: false });
		expect(out).toMatchObject({ mode: 'apply', result });
	});

	it('keeps the section, the key and what applied when an apply stops part way', async () => {
		const result = {
			applied: false,
			plan,
			schemas_applied: ['articles'],
			not_applied: ['flows'],
			failed: { section: 'flows', key: 'notify', message: 'the section could not be written' },
		};
		engine.post.mockRejectedValue(new ApiError(409, '409', result));
		const out = (await actions.apply(event(sync))) as { status: number; data: Record<string, unknown> };
		expect(out.status).toBe(409);
		expect(out.data.result).toEqual(result);
		expect(out.data.error).toContain('stopped partway');
	});

	it('says nothing was written when the engine did not answer', async () => {
		engine.post.mockRejectedValue(new Error('socket hang up'));
		const out = (await actions.apply(event(sync))) as { status: number; data: Record<string, unknown> };
		expect(out.status).toBe(502);
		expect(out.data.error).toContain('Nothing was written');
	});
});
