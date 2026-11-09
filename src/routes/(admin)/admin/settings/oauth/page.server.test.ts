import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load } from './+page.server';
import { signedIn } from '$lib/server/test-support/signed-in';

const cookies = { get: () => 'tok', set: vi.fn(), delete: vi.fn(), getAll: () => [], serialize: () => '' } as unknown as Cookies;

function event(status: number, body: unknown) {
	return {
		fetch: signedIn(
			vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
			{ roles: ['super_admin'] }
		),
		cookies,
		url: new URL('http://admin/admin/settings/oauth'),
	} as never;
}

describe('OAuth providers load', () => {
	it('keeps a failed read apart from an instance with no providers', async () => {
		const out = (await load(event(500, { error: 'boom' }))) as { providers: { ok: boolean } };
		expect(out.providers.ok).toBe(false);
	});

	it('answers the providers the engine lists', async () => {
		const out = (await load(event(200, []))) as { providers: unknown };
		expect(out.providers).toEqual({ ok: true, value: [] });
	});
});

type Call = { method: string; path: string; body: unknown };
type Failure = { status: number; data: { action: string; error: string; refused?: unknown } };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * An action event against a fake engine. The session check answers with the
 * given roles, and every other request is recorded and answered with `reply`.
 */
function write(fields: Record<string, string>, opts: { roles?: string[]; reply?: Response } = {}) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const path = String(url);
		if (path.includes('/auth/me')) return json({ id: 'u1', roles: opts.roles ?? ['super_admin'], disabled: false });
		calls.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return opts.reply?.clone() ?? json({});
	});
	const form = new FormData();
	form.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	const url = new URL('http://admin/admin/settings/oauth');
	return { calls, event: { fetch, cookies, url, request: new Request(url, { method: 'POST', body: form }) } as never };
}

const PROVIDER = { id: 'o1', name: 'Google', client_id: 'cid', client_secret: 'shh', issuer_url: 'https://accounts.google.com', enabled: 'true' };

describe('OAuth provider writes', () => {
	it.each(['create', 'update', 'delete'] as const)('refuses %s to an admin before it reaches the engine', async (name) => {
		const { event, calls } = write(PROVIDER, { roles: ['admin'] });
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(calls).toEqual([]);
	});

	it('creates a provider with the default scopes and roles when none are given', async () => {
		const { event, calls } = write(PROVIDER);
		expect(await actions.create(event)).toEqual({ success: true });
		expect(calls).toEqual([
			{
				method: 'POST',
				path: '/api/admin/oauth-providers',
				body: {
					name: 'Google',
					client_id: 'cid',
					client_secret: 'shh',
					issuer_url: 'https://accounts.google.com',
					scopes: ['openid', 'email', 'profile'],
					roles_claim: 'roles',
					default_roles: ['editor'],
					enabled: true,
				},
			},
		]);
	});

	it('splits the scopes and roles a reader typed', async () => {
		const { event, calls } = write({ ...PROVIDER, scopes: 'openid, groups,', default_roles: 'viewer , editor' });
		await actions.create(event);
		expect(calls[0].body).toMatchObject({ scopes: ['openid', 'groups'], default_roles: ['viewer', 'editor'] });
	});

	it('keeps the stored secret when the edit leaves it empty', async () => {
		const { event, calls } = write({ ...PROVIDER, client_secret: '' });
		expect(await actions.update(event)).toEqual({ success: true });
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ method: 'PUT', path: '/api/admin/oauth-providers/o1' });
		expect(calls[0].body).not.toHaveProperty('client_secret');
	});

	it('deletes the named provider', async () => {
		const { event, calls } = write({ id: 'o1' });
		expect(await actions.delete(event)).toEqual({ success: true });
		expect(calls).toEqual([{ method: 'DELETE', path: '/api/admin/oauth-providers/o1', body: undefined }]);
	});

	it.each(['create', 'update', 'delete'] as const)('relays the engine refusal on %s under its action', async (name) => {
		const { event } = write(PROVIDER, { reply: json({ error: 'issuer_url must use https', code: 'http_422' }, 422) });
		const out = (await actions[name](event)) as Failure;
		expect(out.data).toEqual({ action: name, error: 'issuer_url must use https' });
	});

	it('carries a license refusal with its numbers', async () => {
		const { event } = write(PROVIDER, { reply: json({ error: 'cap_exceeded', cap: 'oauth.providers', limit: 1, current: 1 }, 402) });
		const out = (await actions.create(event)) as Failure;
		expect(out.status).toBe(402);
		expect(out.data.action).toBe('create');
		expect(out.data.refused).toMatchObject({ kind: 'cap', limit: 1, current: 1 });
	});

	it.each([
		['create', 'Could not create the provider. Try again.'],
		['update', 'Could not save the provider. Try again.'],
		['delete', 'Could not delete the provider. Try again.'],
	] as const)('keeps outage detail off the page on %s', async (name, sentence) => {
		const { event } = write(PROVIDER, { reply: json({ error: 'dial tcp 10.0.0.4:5432' }, 503) });
		expect(((await actions[name](event)) as Failure).data).toEqual({ action: name, error: sentence });
	});
});
