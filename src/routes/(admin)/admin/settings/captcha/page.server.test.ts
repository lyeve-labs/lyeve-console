import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	readCaptchaSettings: vi.fn(),
	saveCaptchaSettings: vi.fn(),
	clearCaptchaSettings: vi.fn(),
}));

vi.mock('$lib/api/captcha-settings', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	...api,
}));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { load, actions } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function loadEvent() {
	return {
		url: new URL('http://admin/admin/settings/captcha'),
		fetch: vi.fn(),
		cookies: {},
		parent: async () => ({ user: { roles: ['admin'] } }),
	} as never;
}

function formEvent(fields: Record<string, string>) {
	const body = new FormData();
	body.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		request: new Request('http://admin/admin/settings/captcha', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

beforeEach(() => vi.clearAllMocks());

describe('captcha settings load', () => {
	it('carries the settings the plugin read', async () => {
		const settings = { source: 'instance', tenant: null, instance: { provider: 'turnstile', site_key: 'k', enabled: true }, licensed: true };
		api.readCaptchaSettings.mockResolvedValue(settings);
		const result = (await load(loadEvent())) as Loaded;
		expect(result.gate).toEqual({ state: 'ok' });
		expect(result.settings).toEqual(settings);
	});

	it('reports a failed read as a failure', async () => {
		api.readCaptchaSettings.mockRejectedValue(new Error('down'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.gate.state).toBe('error');
		expect(result.settings).toBeNull();
	});
});

describe('captcha settings save', () => {
	// An empty secret keeps the stored one, so the form can be resaved without
	// the console ever holding the secret.
	it('sends an empty secret through so the stored one is kept', async () => {
		api.saveCaptchaSettings.mockResolvedValue({});
		await actions.save(formEvent({ provider: 'hcaptcha', site_key: 'site', secret_key: '' }));
		expect(api.saveCaptchaSettings).toHaveBeenCalledWith(expect.anything(), {
			provider: 'hcaptcha',
			site_key: 'site',
			secret_key: '',
			score_floor: null,
			failure_threshold: null,
		});
	});

	it('sends back the failure threshold the page read, which the form does not show', async () => {
		api.saveCaptchaSettings.mockResolvedValue({});
		await actions.save(formEvent({ provider: 'turnstile', site_key: 'site', secret_key: '', failure_threshold: '7' }));
		expect(api.saveCaptchaSettings).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ failure_threshold: 7 }));
	});

	it('sends the score floor for reCAPTCHA and drops it for any other provider', async () => {
		api.saveCaptchaSettings.mockResolvedValue({});
		await actions.save(formEvent({ provider: 'recaptcha', site_key: 's', secret_key: 'x', score_floor: '0.7' }));
		expect(api.saveCaptchaSettings).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ score_floor: 0.7 }));
		await actions.save(formEvent({ provider: 'turnstile', site_key: 's', secret_key: 'x', score_floor: '0.7' }));
		expect(api.saveCaptchaSettings).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ score_floor: null }));
	});

	it('refuses a score floor outside 0 to 1', async () => {
		const out = (await actions.save(formEvent({ provider: 'recaptcha', site_key: 's', score_floor: '2' }))) as { status: number };
		expect(out.status).toBe(400);
		expect(api.saveCaptchaSettings).not.toHaveBeenCalled();
	});

	it('returns the license refusal so the page renders it', async () => {
		api.saveCaptchaSettings.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_feature' }),
		);
		const out = (await actions.save(formEvent({ provider: 'turnstile', site_key: 's', secret_key: 'x' }))) as {
			status: number;
			data: { refused: { kind: string } };
		};
		expect(out.status).toBe(402);
		expect(out.data.refused.kind).toBe('feature');
	});

	it('clears the tenant settings', async () => {
		api.clearCaptchaSettings.mockResolvedValue(undefined);
		expect(await actions.clear(formEvent({}))).toEqual({ cleared: true });
	});
});
