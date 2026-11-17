import { beforeEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
const gate = vi.hoisted(() => ({ requireUser: vi.fn() }));

vi.mock('#lib/server/authz.ts', () => ({
	requireUser: gate.requireUser,
	authedClient: vi.fn(() => engine),
}));

import { actions, load } from './+page.server';

const none = { state: 'named', running: [] as string[], withheld: [] as string[] };
const running = { ...none, running: ['localization'] };

function event(plugins: typeof none, form: Record<string, string> = {}) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(form)) fd.set(k, v);
	return {
		parent: async () => ({ plugins }),
		request: { formData: async () => fd },
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	gate.requireUser.mockResolvedValue({ id: 'u1' });
});

describe('locales load', () => {
	it('reads nothing while the plugin does not run', async () => {
		const data = await load(event(none));
		expect(engine.get).not.toHaveBeenCalled();
		expect(data).toEqual({ locales: { ok: false, gate: { state: 'absent' } } });
	});

	it('reads the preferences while the plugin runs', async () => {
		engine.get.mockResolvedValue({ default_locale: 'en', enabled_locales: ['en', 'fr'], fallback_chain: ['fr'] });
		const data = await load(event(running));
		expect(engine.get).toHaveBeenCalledWith('/api/admin/localization/locales');
		expect(data).toEqual({
			locales: { ok: true, value: { default_locale: 'en', enabled_locales: ['en', 'fr'], fallback_chain: ['fr'] } },
		});
	});

	it('keeps a failed read as a failure, never as no locales', async () => {
		engine.get.mockRejectedValue(new Error('503'));
		expect(await load(event(running))).toMatchObject({ locales: { ok: false, gate: { state: 'error' } } });
	});
});

describe('locales save', () => {
	it('writes the preferences and returns what the plugin holds', async () => {
		engine.put.mockResolvedValue({ default_locale: 'en', enabled_locales: ['en', 'fr'], fallback_chain: ['fr'] });
		const out = await actions.save(event(running, { default_locale: 'en', enabled_locales: '["fr"]', fallback_chain: '["fr"]' }));
		expect(engine.put).toHaveBeenCalledWith('/api/admin/localization/locales', {
			default_locale: 'en',
			enabled_locales: ['en', 'fr'],
			fallback_chain: ['fr'],
		});
		expect(out).toMatchObject({ saved: true, locales: { fallback_chain: ['fr'] } });
	});

	it('fails without writing when the form does not parse', async () => {
		const out = (await actions.save(event(running, { default_locale: '' }))) as { status: number };
		expect(out.status).toBe(400);
		expect(engine.put).not.toHaveBeenCalled();
	});
});
