import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	createRule: vi.fn(),
	updateRule: vi.fn(),
	deleteRule: vi.fn(),
	testRule: vi.fn(),
	getRules: vi.fn(),
	listAccessLog: vi.fn(),
}));

vi.mock('$lib/api/pii-mask', async (importOriginal) => ({
	...((await importOriginal()) as object),
	...api,
}));

const authz = vi.hoisted(() => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));
vi.mock('$lib/server/authz', () => authz);

import { actions, load } from './+page.server';

function formEvent(fields: Record<string, string>) {
	const body = new FormData();
	body.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return { request: new Request('http://admin/x', { method: 'POST', body }), cookies: {}, fetch: vi.fn() } as never;
}

function loadEvent() {
	return {
		url: new URL('http://admin.test/admin/settings/pii'),
		parent: async () => ({ plugins: null }),
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	api.getRules.mockResolvedValue({ presets: [], mask_tags: {} });
});

describe('pii rule actions', () => {
	// The page reads the failure from the error key. A bare string there left
	// every refused save without a word on screen.
	it('returns a refused save under the key the page reads', async () => {
		api.createRule.mockRejectedValue(new ApiError(400, 'pattern does not compile', { error: 'pattern does not compile', code: 'bad_request' }));
		const out = (await actions.create(formEvent({ name: 'X', pattern: '(', replacement: '*' }))) as {
			status: number;
			data: { error: string };
		};
		expect(out.data.error).toBe('pattern does not compile');
	});
});

describe('pii load', () => {
	it('reads the rules and nothing of the access log', async () => {
		expect(await load(loadEvent())).toEqual({ rules: { presets: [], mask_tags: {} }, gate: { state: 'ok' } });
		expect(api.listAccessLog).not.toHaveBeenCalled();
	});
});

type Failure = { status: number; data: { action: string; error: string } };

const RULE = { name: ' Card ', description: '', pattern: '\\d{16}', replacement: '****', priority: '', enabled: 'on' };

describe('pii rule writes', () => {
	it.each(['create', 'update', 'delete', 'test'] as const)('holds %s to an admin', async (name) => {
		authz.requireRole.mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403 }));
		const event = formEvent({ id: 'r1', ...RULE });
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(authz.requireRole).toHaveBeenCalledWith(event, ['admin', 'super_admin']);
		for (const fn of [api.createRule, api.updateRule, api.deleteRule, api.testRule]) expect(fn).not.toHaveBeenCalled();
	});

	it('creates a rule and reads an empty priority as the default, not zero', async () => {
		api.createRule.mockResolvedValue({});
		expect(await actions.create(formEvent(RULE))).toEqual({ saved: true });
		expect(api.createRule).toHaveBeenCalledWith(expect.anything(), {
			name: 'Card',
			description: '',
			pattern: '\\d{16}',
			replacement: '****',
			priority: 100,
			enabled: true,
		});
	});

	it('saves and deletes the named rule', async () => {
		api.updateRule.mockResolvedValue({});
		api.deleteRule.mockResolvedValue(undefined);
		expect(await actions.update(formEvent({ id: 'r1', ...RULE, priority: '5' }))).toEqual({ saved: true });
		expect(api.updateRule).toHaveBeenCalledWith(expect.anything(), 'r1', expect.objectContaining({ priority: 5 }));
		expect(await actions.delete(formEvent({ id: 'r1' }))).toEqual({ deleted: true });
		expect(api.deleteRule).toHaveBeenCalledWith(expect.anything(), 'r1');
	});

	it('keeps a typed priority of 0, which runs the rule before every preset', async () => {
		api.updateRule.mockResolvedValue({});
		await actions.update(formEvent({ id: 'r1', ...RULE, priority: '0' }));
		expect(api.updateRule).toHaveBeenCalledWith(expect.anything(), 'r1', expect.objectContaining({ priority: 0 }));
	});

	it('refuses a priority of 0 on create, which the plugin would store as 100', async () => {
		const out = (await actions.create(formEvent({ ...RULE, priority: '0' }))) as { status: number; data: { error: string } };
		expect(out.status).toBe(400);
		expect(out.data.error).toContain('cannot start at priority 0');
		expect(api.createRule).not.toHaveBeenCalled();
	});

	it.each(['update', 'delete'] as const)('names nothing to %s without a request', async (name) => {
		expect(((await actions[name](formEvent(RULE))) as Failure).data).toEqual({ action: name, error: 'This form is missing its rule. Reload the page and try again.' });
		expect(api.updateRule).not.toHaveBeenCalled();
		expect(api.deleteRule).not.toHaveBeenCalled();
	});

	it('runs a pattern against a sample and hands back what it masked', async () => {
		const result = { valid: true, matches: ['4111111111111111'], count: 1, masked: '****' };
		api.testRule.mockResolvedValue(result);
		const out = await actions.test(formEvent({ pattern: '\\d{16}', replacement: '****', sample: '4111111111111111' }));
		expect(api.testRule).toHaveBeenCalledWith(expect.anything(), '\\d{16}', '****', '4111111111111111');
		expect(out).toEqual({ test: result });
	});

	// The plugin answers a pattern that does not compile with 200 and valid
	// false, which the page shows as the test result rather than a failure.
	it('hands back a pattern the plugin could not compile as a result', async () => {
		api.testRule.mockResolvedValue({ valid: false, error: 'pattern does not compile' });
		expect(await actions.test(formEvent({ pattern: '(', replacement: '*', sample: 'x' }))).toEqual({
			test: { valid: false, error: 'pattern does not compile' },
		});
	});

	it.each([
		['update', 'updateRule', 'id must be a UUID'],
		['delete', 'deleteRule', 'id must be a UUID'],
		['test', 'testRule', 'body must be a JSON object with pattern, replacement and sample'],
	] as const)('relays the plugin refusal on %s under its action', async (name, fn, sentence) => {
		api[fn].mockRejectedValue(new ApiError(400, sentence, { error: sentence, code: 'bad_request' }));
		const out = (await actions[name](formEvent({ id: 'r1', ...RULE }))) as Failure;
		expect(out.data).toEqual({ action: name, error: sentence });
	});

	it.each([
		['create', 'createRule', 'Could not create the rule. Try again.'],
		['update', 'updateRule', 'Could not save the rule. Try again.'],
		['delete', 'deleteRule', 'Could not delete the rule. Try again.'],
		['test', 'testRule', 'Could not run the pattern. Try again.'],
	] as const)('keeps outage detail off the page on %s', async (name, fn, sentence) => {
		api[fn].mockRejectedValue(new ApiError(503, 'dial tcp 10.0.0.4:5432: connection refused'));
		expect(((await actions[name](formEvent({ id: 'r1', ...RULE }))) as Failure).data).toEqual({ action: name, error: sentence });
	});
});
