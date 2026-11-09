import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { actions, load } from './+page.server';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return {
		get: vi.fn(() => 'tok'),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

const TENANT = {
	id: 't1',
	slug: 'acme',
	name: 'Acme',
	plan: 'example',
	enabled: true,
	archived: false,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z',
};

/** The license the instance holds, read by the page itself. */
const LICENSE = { plan: 'example', state: 'active', features: ['search', 'flow'], tenant_quota: 0 };

type Call = { url: string; query: string; method: string; body: unknown };

/** An event whose fetch answers by route and records every call. */
function event(routes: Record<string, unknown>, form?: FormData) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		const asked = new URL(String(url), 'http://localhost');
		const path = asked.pathname;
		calls.push({ url: path, query: asked.search, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		const answers: Record<string, unknown> = {
			'GET /api/admin/entitlements': LICENSE,
			'GET /api/admin/auth/me': { roles: ['super_admin'] },
			...routes,
		};
		const hit = answers[`${method} ${path}`];
		if (hit === undefined) return json({ error: 'not found' }, 404);
		if (hit instanceof Response) return hit;
		return json(hit);
	}) as unknown as typeof globalThis.fetch;
	return {
		calls,
		event: {
			fetch,
			cookies: mockCookies(),
			params: { id: 't1' },
			url: new URL('http://localhost/admin/tenants/t1'),
			request: form ? new Request('http://localhost', { method: 'POST', body: form }) : undefined,
		} as never,
	};
}

const ME = { id: 'u0', email: 'root@example.com', roles: ['super_admin'] };

/** An account whose home is another tenant, so a grant here is a plain membership. */
const ADA = { id: 'u1', email: 'ada@example.com', roles: ['editor'], tenant_id: 'other', disabled: false };

describe('admin/tenants/[id] load', () => {
	it('offers what the engine serves and marks what is withheld', async () => {
		const { event: ev } = event({
			'GET /api/admin/tenants/t1': TENANT,
			'GET /api/admin/tenant-features/acme': { tenant: 'acme', withheld: ['search'], known: ['ai', 'flow', 'search'] },
			'GET /api/admin/tenant-members/acme': { members: [{ id: 'u1', email: 'a@x.io', disabled: false, home: true, roles: ['admin'] }], total: 1 },
		});
		const data = (await load(ev)) as Exclude<Awaited<ReturnType<typeof load>>, void>;
		expect(data.choices).toEqual({
			ok: true,
			value: [
				{ name: 'flow', available: true },
				{ name: 'search', available: false },
			],
		});
		expect(data.members.ok && data.members.value[0].email).toBe('a@x.io');
	});

	// The member list shows the roles a home membership sets. Only the account
	// says whether it holds super_admin.
	it('names the home rows whose account is a super admin the list leaves out', async () => {
		const { event: ev } = event({
			'GET /api/admin/tenants/t1': TENANT,
			'GET /api/admin/tenant-features/acme': { tenant: 'acme', withheld: [], known: [] },
			'GET /api/admin/tenant-members/acme': {
				members: [
					{ id: 'u1', email: 'root@acme.io', disabled: false, home: true, roles: ['editor'] },
					{ id: 'u2', email: 'ada@acme.io', disabled: false, home: true, roles: ['editor'] },
				],
				total: 2,
			},
			'GET /api/admin/users': [
				{ id: 'u1', email: 'root@acme.io', roles: ['super_admin'], tenant_id: 'acme', disabled: false },
				{ id: 'u2', email: 'ada@acme.io', roles: ['editor'], tenant_id: 'acme', disabled: false },
			],
		});
		const data = (await load(ev)) as Exclude<Awaited<ReturnType<typeof load>>, void>;
		expect(data.homeSuperAdmins).toEqual(['u1']);
	});

	it('keeps a failed account read as unknown rather than as no super admin', async () => {
		const { event: ev } = event({
			'GET /api/admin/tenants/t1': TENANT,
			'GET /api/admin/tenant-features/acme': { tenant: 'acme', withheld: [], known: [] },
			'GET /api/admin/tenant-members/acme': {
				members: [{ id: 'u1', email: 'root@acme.io', disabled: false, home: true, roles: ['editor'] }],
				total: 1,
			},
			'GET /api/admin/users': json({ error: 'database unavailable' }, 503),
		});
		const data = (await load(ev)) as Exclude<Awaited<ReturnType<typeof load>>, void>;
		expect(data.homeSuperAdmins).toBeNull();
	});

	it('keeps the features when the members read fails', async () => {
		const { event: ev } = event({
			'GET /api/admin/tenants/t1': TENANT,
			'GET /api/admin/tenant-features/acme': { tenant: 'acme', withheld: [], known: ['flow'] },
		});
		const data = (await load(ev)) as Exclude<Awaited<ReturnType<typeof load>>, void>;
		expect(data.members).toMatchObject({ ok: false, gate: { state: 'absent' } });
		expect(data.choices).toEqual({ ok: true, value: [{ name: 'flow', available: true }] });
	});

	// A tenant that exists is never reported missing because the engine or its
	// database did not answer.
	it('answers 404 only for the engine 404', async () => {
		const missing = event({});
		await expect(load(missing.event)).rejects.toMatchObject({ status: 404, body: { message: 'This tenant does not exist.' } });

		const down = event({ 'GET /api/admin/tenants/t1': json({ error: 'database unavailable' }, 503) });
		await expect(load(down.event)).rejects.toMatchObject({ status: 503 });

		const refused = event({ 'GET /api/admin/tenants/t1': json({ error: 'forbidden' }, 403) });
		await expect(load(refused.event)).rejects.toMatchObject({ status: 403 });
	});

	it('keeps a license that could not be read as its gate, never as nothing to offer', async () => {
		const { event: ev } = event({
			'GET /api/admin/tenants/t1': TENANT,
			'GET /api/admin/entitlements': json({ error: 'database unavailable' }, 503),
			'GET /api/admin/tenant-features/acme': { tenant: 'acme', withheld: [], known: ['flow'] },
			'GET /api/admin/tenant-members/acme': { members: [], total: 0 },
		});
		const data = (await load(ev)) as Exclude<Awaited<ReturnType<typeof load>>, void>;
		expect(data.choices).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('keeps an outage on the members read apart from a tenant with no members', async () => {
		const { event: ev } = event({
			'GET /api/admin/tenants/t1': TENANT,
			'GET /api/admin/tenant-features/acme': { tenant: 'acme', withheld: [], known: ['flow'] },
			'GET /api/admin/tenant-members/acme': json({ error: 'database unavailable' }, 503),
		});
		const data = (await load(ev)) as Exclude<Awaited<ReturnType<typeof load>>, void>;
		expect(data.members).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});
});

describe('admin/tenants/[id] features action', () => {
	it('withholds every offered name left unticked', async () => {
		const form = new FormData();
		for (const n of ['flow', 'search', 'ai']) form.append('offered', n);
		form.append('available', 'flow');
		const { event: ev, calls } = event(
			{
				'GET /api/admin/auth/me': ME,
				'GET /api/admin/tenants/t1': TENANT,
				'PUT /api/admin/tenant-features/acme': { tenant: 'acme', withheld: ['ai', 'search'], known: [] },
			},
			form,
		);
		const result = await actions.features(ev);
		expect(result).toEqual({ featuresSaved: 2 });
		const put = calls.find((c) => c.method === 'PUT');
		expect(put?.body).toEqual({ withheld: ['ai', 'search'] });
	});
});

describe('admin/tenants/[id] grant action', () => {
	function grantForm(roles: string): FormData {
		const form = new FormData();
		form.append('user_id', 'u1');
		form.append('roles', roles);
		return form;
	}

	function refused(body: Record<string, unknown>) {
		return event(
			{
				'GET /api/admin/auth/me': ME,
				'GET /api/admin/tenants/t1': TENANT,
				'GET /api/admin/users': [ADA],
				'PUT /api/admin/users/u1/memberships': json(body, 402),
			},
			grantForm('admin'),
		).event;
	}

	it('says every seat is taken when the grant is refused at the seat ceiling', async () => {
		const result = await actions.grant(
			refused({ error: 'cap_exceeded', cap: 'admin.seats', limit: 7, current: 7, upgrade_url: 'https://shop.example.com/pricing?utm_campaign=admin.seats' }),
		);
		expect(result).toEqual({
			status: 402,
			data: {
				action: 'grant',
				memberError:
					"Every admin seat is taken. You're using 7 of 7, the most this engine allows. A license that allows more lifts the limit. Removing the admin role from an account also frees a seat. Editors and viewers take no seat.",
				refused: { kind: 'cap', cap: 'admin.seats', limit: 7, current: 7, upgradeUrl: 'https://shop.example.com/pricing?utm_campaign=admin.seats' },
			},
		});
	});

	it('leaves a refusal at another cap to the usual message', async () => {
		const result = (await actions.grant(
			refused({ error: 'cap_exceeded', cap: 'example.items', limit: 4, current: 4 }),
		)) as { status: number; data: { memberError: string } };
		expect(result.status).toBe(400);
		expect(result.data.memberError).not.toContain('admin seat');
	});

	it('saves a grant the engine accepts', async () => {
		const { event: ev, calls } = event(
			{
				'GET /api/admin/auth/me': ME,
				'GET /api/admin/tenants/t1': TENANT,
				'GET /api/admin/users': [ADA],
				'PUT /api/admin/users/u1/memberships': { tenant_id: 'acme', roles: ['editor'] },
			},
			grantForm('editor'),
		);
		expect(await actions.grant(ev)).toEqual({ memberSaved: true });
		expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ tenant_id: 'acme', roles: ['editor'] });
	});

	/*
	 * A membership in an account's home tenant replaces its roles when it signs
	 * in there. Written for a super admin, it dropped super_admin or held it
	 * past a removal on the Users page.
	 */
	const ROOT_AT_HOME = { id: 'u1', email: 'root@acme.io', roles: ['super_admin'], tenant_id: 'acme', disabled: false };

	it('refuses a new member who is a super admin at home here', async () => {
		const form = new FormData();
		form.append('email', 'root@acme.io');
		form.append('roles', 'editor');
		const { event: ev, calls } = event(
			{ 'GET /api/admin/auth/me': ME, 'GET /api/admin/tenants/t1': TENANT, 'GET /api/admin/users': [ROOT_AT_HOME] },
			form,
		);
		expect(await actions.grant(ev)).toMatchObject({
			status: 409,
			data: { action: 'grant', memberError: 'root@acme.io is a super admin whose home tenant is this one. Change their roles on the Users page.', fields: { email: 'Managed on the Users page' } },
		});
		expect(calls.some((c) => c.method === 'PUT')).toBe(false);
	});

	it('refuses an edit of a super admin home row posted directly', async () => {
		const { event: ev, calls } = event(
			{ 'GET /api/admin/auth/me': ME, 'GET /api/admin/tenants/t1': TENANT, 'GET /api/admin/users': [ROOT_AT_HOME] },
			grantForm('super_admin'),
		);
		expect(await actions.grant(ev)).toMatchObject({ status: 409, data: { action: 'grant' } });
		expect(calls.some((c) => c.method === 'PUT')).toBe(false);
	});

	it('saves nothing for an account the lookup does not find', async () => {
		const { event: ev, calls } = event(
			{ 'GET /api/admin/auth/me': ME, 'GET /api/admin/tenants/t1': TENANT, 'GET /api/admin/users': [] },
			grantForm('editor'),
		);
		expect(await actions.grant(ev)).toEqual({
			status: 404,
			data: { action: 'grant', memberError: 'This account no longer exists.' },
		});
		expect(calls.some((c) => c.method === 'PUT')).toBe(false);
	});

	it('saves nothing when the account cannot be read', async () => {
		const { event: ev, calls } = event(
			{ 'GET /api/admin/auth/me': ME, 'GET /api/admin/tenants/t1': TENANT, 'GET /api/admin/users': json({ error: 'down' }, 503) },
			grantForm('editor'),
		);
		expect(await actions.grant(ev)).toMatchObject({ status: 400, data: { action: 'grant' } });
		expect(calls.some((c) => c.method === 'PUT')).toBe(false);
	});
});

describe('admin/tenants/[id] members paging', () => {
	it('asks for the window the address names', async () => {
		const { event: ev, calls } = event({
			'GET /api/admin/tenants/t1': TENANT,
			'GET /api/admin/tenant-features/acme': { tenant: 'acme', withheld: [], known: [] },
			'GET /api/admin/tenant-members/acme': { members: [{ id: 'u1', email: 'a@x.io', disabled: false, home: true, roles: ['admin'] }], total: 51 },
		});
		(ev as { url: URL }).url = new URL('http://localhost/admin/tenants/t1?limit=50&offset=50');
		const data = (await load(ev)) as Exclude<Awaited<ReturnType<typeof load>>, void>;
		expect(data.offset).toBe(50);
		const members = calls.find((c) => c.url === '/api/admin/tenant-members/acme');
		expect(new URLSearchParams(members?.query).get('limit')).toBe('50');
		expect(new URLSearchParams(members?.query).get('offset')).toBe('50');
	});

	it('sends a page past the end back to the last page that holds rows', async () => {
		const { event: ev } = event({
			'GET /api/admin/tenants/t1': TENANT,
			'GET /api/admin/tenant-features/acme': { tenant: 'acme', withheld: [], known: [] },
			'GET /api/admin/tenant-members/acme': { members: [], total: 3 },
		});
		(ev as { url: URL }).url = new URL('http://localhost/admin/tenants/t1?limit=50&offset=100');
		await expect(load(ev)).rejects.toMatchObject({ status: 307, location: '/admin/tenants/t1?limit=50&offset=0' });
	});
});

describe('admin/tenants/[id] revoke, archive and restore', () => {
	function revokeForm(): FormData {
		const form = new FormData();
		form.set('confirmed', 'yes');
		form.append('user_id', 'u2');
		return form;
	}

	function archiveForm(): FormData {
		const form = new FormData();
		form.set('confirmed', 'yes');
		return form;
	}

	const ADMIN = { id: 'u9', email: 'admin@example.com', roles: ['admin'] };

	it('removes a membership the engine accepts', async () => {
		const { event: ev, calls } = event(
			{ 'GET /api/admin/auth/me': ME, 'GET /api/admin/tenants/t1': TENANT, 'DELETE /api/admin/users/u2/memberships/acme': {} },
			revokeForm(),
		);
		expect(await actions.revoke(ev)).toEqual({ memberRevoked: true });
		expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/admin/users/u2/memberships/acme')).toBe(true);
	});

	it('relays the refusal of a home tenant removal under its action', async () => {
		const { event: ev } = event(
			{
				'GET /api/admin/auth/me': ME,
				'GET /api/admin/tenants/t1': TENANT,
				'DELETE /api/admin/users/u2/memberships/acme': json({ error: 'the home tenant has no membership to revoke', code: 'conflict' }, 409),
			},
			revokeForm(),
		);
		expect(await actions.revoke(ev)).toEqual({
			status: 400,
			data: { action: 'revoke', memberError: 'the home tenant has no membership to revoke' },
		});
	});

	it('keeps driver text out of a removal during an outage', async () => {
		const { event: ev } = event(
			{
				'GET /api/admin/auth/me': ME,
				'GET /api/admin/tenants/t1': TENANT,
				'DELETE /api/admin/users/u2/memberships/acme': json({ error: 'pq: connection refused' }, 503),
			},
			revokeForm(),
		);
		expect(await actions.revoke(ev)).toMatchObject({ data: { memberError: 'Could not remove the membership. Try again.' } });
	});

	it('archives nothing on a post that skipped the question', async () => {
		const unasked = event({ 'GET /api/admin/auth/me': ME }, new FormData());
		expect(await actions.archive(unasked.event)).toMatchObject({ unconfirmed: { question: 'Archive this tenant?', label: 'Archive', fields: [] } });
		expect(unasked.calls).toEqual([]);
	});

	it('archives and restores a tenant the engine accepts', async () => {

		const archive = event({ 'GET /api/admin/auth/me': ME, 'POST /api/admin/tenants/t1/archive': { ...TENANT, archived: true } }, archiveForm());
		expect(await actions.archive(archive.event)).toEqual({ archived: true });
		const restore = event({ 'GET /api/admin/auth/me': ME, 'POST /api/admin/tenants/t1/restore': TENANT });
		expect(await actions.restore(restore.event)).toEqual({ restored: true });
	});

	it('relays a refused archive and restore, and hides an outage behind a sentence', async () => {
		const refused = event({ 'GET /api/admin/auth/me': ME, 'POST /api/admin/tenants/t1/archive': json({ error: 'tenant is already archived', code: 'conflict' }, 409) }, archiveForm());
		expect(await actions.archive(refused.event)).toEqual({ status: 400, data: { stateError: 'tenant is already archived' } });
		const down = event({ 'GET /api/admin/auth/me': ME, 'POST /api/admin/tenants/t1/restore': json({ error: 'pq: timeout' }, 503) });
		expect(await actions.restore(down.event)).toEqual({ status: 400, data: { stateError: 'Could not restore the tenant. Try again.' } });
		const downArchive = event({ 'GET /api/admin/auth/me': ME, 'POST /api/admin/tenants/t1/archive': json({ error: 'pq: timeout' }, 503) }, archiveForm());
		expect(await actions.archive(downArchive.event)).toEqual({ status: 400, data: { stateError: 'Could not archive the tenant. Try again.' } });
		const refusedRestore = event({ 'GET /api/admin/auth/me': ME, 'POST /api/admin/tenants/t1/restore': json({ error: 'tenant is not archived', code: 'conflict' }, 409) });
		expect(await actions.restore(refusedRestore.event)).toEqual({ status: 400, data: { stateError: 'tenant is not archived' } });
	});

	it.each(['revoke', 'archive', 'restore'] as const)('refuses %s to an admin', async (name) => {
		const { event: ev, calls } = event({ 'GET /api/admin/auth/me': ADMIN }, revokeForm());
		await expect(actions[name](ev)).rejects.toMatchObject({ status: 403 });
		expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
	});
});
