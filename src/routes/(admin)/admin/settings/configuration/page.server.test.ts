import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

vi.mock('@lyeve-labs/client', () => {
	return {
		createClient: vi.fn(),
		ApiError: class ApiError extends Error {
			status: number;
			body: unknown;
			constructor(status: number, message: string, body?: unknown) {
				super(message);
				this.status = status;
				this.body = body;
			}
		},
	};
});

import { load, actions } from './+page.server';
import { createClient, ApiError } from '@lyeve-labs/client';

function mockCookies(initial: Record<string, string> = {}): Cookies {
	const store = { ...initial };
	return {
		get: vi.fn((name: string) => store[name] ?? undefined),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

const authed = () => mockCookies({ '__Host-sys_session': 'token' });

function request(fields: Record<string, string>): Request {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.append(k, v);
	return { formData: async () => data } as unknown as Request;
}

const mockedCreateClient = vi.mocked(createClient);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('configuration load', () => {
	it('returns the provenance report', async () => {
		const provenance = {
			settings: [{ key: 'STORAGE_DRIVER', source: 'file', value: 'local', editable: true }],
			counts: { file: 1 },
		};
		mockedCreateClient.mockReturnValue({ get: vi.fn(async () => provenance) } as never);

		const result = await load({ fetch: vi.fn(), cookies: authed(), url: new URL('http://admin.test/admin/settings/configuration') } as never);
		expect(result).toEqual({ provenance: { ok: true, value: provenance }, plugin: null });
	});

	// A role refusal is a normal state for an admin. The page says so through
	// the forbidden notice and draws no settings.
	it('keeps a role refusal as the forbidden state', async () => {
		mockedCreateClient.mockReturnValue({
			get: vi.fn(async () => {
				throw new ApiError(403, 'forbidden');
			}),
		} as never);

		const result = await load({ fetch: vi.fn(), cookies: authed(), url: new URL('http://admin.test/admin/settings/configuration') } as never);
		expect(result).toEqual({ provenance: { ok: false, gate: { state: 'forbidden' } }, plugin: null });
	});

	// An engine whose database is down is not a reader without the role. Told
	// so, a super admin would go looking for a role they already hold.
	it('reports an outage as unavailable, not as a missing role', async () => {
		mockedCreateClient.mockReturnValue({
			get: vi.fn(async () => {
				throw new ApiError(503, 'database unavailable');
			}),
		} as never);

		const result = await load({ fetch: vi.fn(), cookies: authed(), url: new URL('http://admin.test/admin/settings/configuration') } as never);
		expect(result).toEqual({ provenance: { ok: false, gate: { state: 'unavailable' } }, plugin: null });
	});

	// Opened for one plugin, the list gains the keys its schema declares that
	// nothing has read yet, and names which keys belong to the plugin.
	it('scopes the list to a plugin and adds its unread settings', async () => {
		const provenance = { settings: [{ key: 'SMTP_HOST', source: 'env', value: 'mail', editable: false }], counts: { env: 1 } };
		const get = vi.fn(async (path: string) => {
			if (path === '/api/admin/config') return provenance;
			return { type: 'object', properties: { smtp_host: { description: 'Relay host.' }, smtp_port: { default: 587 } } };
		});
		mockedCreateClient.mockReturnValue({ get } as never);
		const result = (await load({ fetch: vi.fn(), cookies: authed(), url: new URL('http://admin.test/x?plugin=email') } as never)) as {
			provenance: { value: { settings: { key: string; source: string }[] } };
			plugin: { name: string; keys: string[]; found: boolean };
		};
		expect(result.plugin).toEqual({ name: 'email', keys: ['SMTP_HOST', 'SMTP_PORT'], found: true, failed: false });
		expect(result.provenance.value.settings.map((s) => [s.key, s.source])).toEqual([['SMTP_HOST', 'env'], ['SMTP_PORT', 'default']]);
	});
});

describe('configuration load for a plugin', () => {
	async function loadWith(schemaError: Error) {
		const get = vi.fn(async (path: string) => {
			if (path === '/api/admin/config') return { settings: [], counts: {} };
			throw schemaError;
		});
		mockedCreateClient.mockReturnValue({ get } as never);
		return (await load({ fetch: vi.fn(), cookies: authed(), url: new URL('http://admin.test/x?plugin=email') } as never)) as {
			plugin: { found: boolean; failed: boolean };
		};
	}

	it('reads only a 404 as a plugin with no settings', async () => {
		expect((await loadWith(new ApiError(404, 'not found'))).plugin).toMatchObject({ found: false, failed: false });
	});

	it('reports a failed schema read as a failure, not as no settings', async () => {
		expect((await loadWith(new ApiError(503, 'down'))).plugin).toMatchObject({ found: false, failed: true });
		expect((await loadWith(new ApiError(429, 'busy'))).plugin).toMatchObject({ failed: true });
	});
});

describe('configuration save', () => {
	it('reads the refusal from a 409 whose only key was refused', async () => {
		mockedCreateClient.mockReturnValue({
			put: vi.fn(async () => {
				throw new ApiError(409, '{"refused":[...]}', {
					refused: [{ key: 'APP_ENV', reason: 'set by the environment', origin: 'APP_ENV' }],
				});
			}),
		} as never);

		const result = (await actions.save({
			request: request({ key: 'APP_ENV', value: 'development', secret: 'false' }),
			fetch: vi.fn(),
			cookies: authed(),
		} as never)) as { status: number; data: { error: string } };

		expect(result.status).toBe(409);
		expect(result.data.error).toBe('set by the environment (APP_ENV)');
	});

	it('sends one setting', async () => {
		const put = vi.fn(async () => ({ saved: [{ key: 'STORAGE_DRIVER' }] }));
		mockedCreateClient.mockReturnValue({ put } as never);

		const result = await actions.save({
			request: request({ key: 'STORAGE_DRIVER', value: 's3', secret: 'false' }),
			fetch: vi.fn(),
			cookies: authed(),
		} as never);

		expect(put).toHaveBeenCalledWith('/api/admin/config', {
			values: { STORAGE_DRIVER: 's3' },
		});
		expect(result).toEqual({ success: true, key: 'STORAGE_DRIVER' });
	});

	// A blank secret is how the engine is told to unset one, so an empty
	// submission is refused here rather than silently clearing the credential.
	it('refuses to submit a blank credential', async () => {
		const put = vi.fn();
		mockedCreateClient.mockReturnValue({ put } as never);

		const result = await actions.save({
			request: request({ key: 'SMTP_PASS', value: '', secret: 'true' }),
			fetch: vi.fn(),
			cookies: authed(),
		} as never);

		expect(put).not.toHaveBeenCalled();
		expect(result).toMatchObject({ status: 400 });
	});

	it('reports a refusal with the layer that holds the key', async () => {
		mockedCreateClient.mockReturnValue({
			put: vi.fn(async () => ({
				refused: [{ key: 'APP_ENV', reason: 'pinned by the configuration file', origin: 'lyeve.yaml:3' }],
			})),
		} as never);

		const result = (await actions.save({
			request: request({ key: 'APP_ENV', value: 'development', secret: 'false' }),
			fetch: vi.fn(),
			cookies: authed(),
		} as never)) as { status: number; data: { error: string } };

		expect(result.status).toBe(409);
		expect(result.data.error).toContain('lyeve.yaml:3');
	});

	// The engine's own failure text can carry driver detail, so it never
	// reaches the page. A refusal written for the operator still does.
	it('keeps an engine failure out of the message', async () => {
		mockedCreateClient.mockReturnValue({
			put: vi.fn(async () => {
				throw new ApiError(500, 'pq: relation "sys_config" does not exist');
			}),
		} as never);

		const result = (await actions.save({
			request: request({ key: 'APP_ENV', value: 'development', secret: 'false' }),
			fetch: vi.fn(),
			cookies: authed(),
		} as never)) as { status: number; data: { error: string } };

		expect(result.status).toBe(502);
		expect(result.data.error).not.toContain('sys_config');
		expect(result.data.error).toBe('Could not save the setting. Try again.');
	});

	it('relays a refusal written for the operator', async () => {
		mockedCreateClient.mockReturnValue({
			put: vi.fn(async () => {
				throw new ApiError(400, 'APP_ENV must be one of development, production', { error: 'APP_ENV must be one of development, production', code: 'bad_request' });
			}),
		} as never);

		const result = (await actions.save({
			request: request({ key: 'APP_ENV', value: 'nope', secret: 'false' }),
			fetch: vi.fn(),
			cookies: authed(),
		} as never)) as { status: number; data: { error: string } };

		expect(result.status).toBe(400);
		expect(result.data.error).toBe('APP_ENV must be one of development, production');
	});

	it('requires a session', async () => {
		const result = await actions.save({
			request: request({ key: 'STORAGE_DRIVER', value: 's3' }),
			fetch: vi.fn(),
			cookies: mockCookies(),
		} as never);
		expect(result).toMatchObject({ status: 401 });
	});

	it('requires a setting name', async () => {
		const result = await actions.save({
			request: request({ value: 's3' }),
			fetch: vi.fn(),
			cookies: authed(),
		} as never);
		expect(result).toMatchObject({ status: 400 });
	});
});
