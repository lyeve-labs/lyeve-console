import { describe, expect, it, vi } from 'vitest';

const authz = vi.hoisted(() => ({ requireRole: vi.fn() }));
vi.mock('$lib/server/authz', async () => {
	const { createClient } = await vi.importActual<typeof import('@lyeve-labs/client')>('@lyeve-labs/client');
	return {
		requireRole: authz.requireRole,
		authedClient: (event: { fetch: typeof fetch }) => createClient(event.fetch),
	};
});

import { actions, load } from './+page.server';

function event(body: unknown, search: string) {
	return {
		fetch: vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })),
		url: new URL(`http://admin/admin/settings/saml${search}`),
		parent: async () => ({ plugins: { state: 'named', running: ['saml'], withheld: [] } }),
	} as never;
}

describe('SAML load', () => {
	// The list names each template, and only the template itself carries the
	// settings the drawer fills in.
	it('reads each template with the settings it fills', async () => {
		const okta = { key: 'okta', name: 'Okta', description: 'd', config: { name_id_format: 'urn:x', attributes_mapping: { email: 'email' } } };
		const fetch = vi.fn(async (url: string) => {
			const path = String(url);
			const body = path.startsWith('/api/admin/saml-templates/okta')
				? okta
				: path.startsWith('/api/admin/saml-templates')
					? [{ key: 'okta', name: 'Okta', description: 'd' }]
					: { data: [], total_count: 0 };
			return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
		});
		const out = (await load({
			fetch,
			url: new URL('http://admin/admin/settings/saml'),
			parent: async () => ({ plugins: { state: 'named', running: ['saml'], withheld: [] } }),
		} as never)) as { templates: unknown };
		expect(out.templates).toEqual([okta]);
	});

	it('sends a page past the end back to the last page that holds providers', async () => {
		await expect(load(event({ data: [], total_count: 30 }, '?offset=75&limit=25'))).rejects.toMatchObject({
			status: 307,
			location: '/admin/settings/saml?offset=25&limit=25',
		});
	});
});

type Call = { method: string; path: string; body: unknown };
type Failure = { status: number; data: { action: string; error: string } };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** An action event against a fake engine that records each request and answers it with `reply`. */
function write(fields: Record<string, string>, reply: Response = json({})) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		calls.push({ method: init?.method ?? 'GET', path: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return reply.clone();
	});
	const form = new FormData();
	form.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	const url = new URL('http://admin/admin/settings/saml');
	return { calls, event: { fetch, url, request: new Request(url, { method: 'POST', body: form }) } as never };
}

const PROVIDER = {
	name: ' Okta ',
	entity_id: 'https://idp.example.com',
	sso_url: 'https://idp.example.com/sso',
	idp_cert: 'MIIC',
	want_assertions_signed: 'true',
	enabled: 'true',
	attributes_mapping: 'email = mail\nbroken line\n=orphan\nname=displayName',
};

const OUTAGE = json({ error: 'dial tcp 10.0.0.4:5432: connection refused' }, 503);

describe('SAML writes', () => {
	it.each(['create', 'update', 'delete', 'prepare', 'rollover'] as const)('holds %s to a super admin', async (name) => {
		authz.requireRole.mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403 }));
		const { event, calls } = write({ id: 'p1', ...PROVIDER });
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(authz.requireRole).toHaveBeenLastCalledWith(event, ['super_admin']);
		expect(calls).toEqual([]);
	});

	it('creates a provider and keeps only the attribute lines that name a pair', async () => {
		const { event, calls } = write(PROVIDER);
		expect(await actions.create(event)).toEqual({ saved: 'Okta' });
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			method: 'POST',
			path: '/api/admin/saml-providers',
			body: {
				name: 'Okta',
				entity_id: 'https://idp.example.com',
				sso_url: 'https://idp.example.com/sso',
				idp_cert: 'MIIC',
				want_assertions_signed: true,
				want_response_signed: false,
				enabled: true,
				attributes_mapping: { email: 'mail', name: 'displayName' },
			},
		});
	});

	it.each([
		['name', 'Enter a name for the provider.'],
		['entity_id', 'Enter the entity ID.'],
		['sso_url', 'Enter the sign-on URL.'],
		['idp_cert', "Paste the identity provider's signing certificate."],
	])('asks for %s before it creates anything', async (field, sentence) => {
		const { event, calls } = write({ ...PROVIDER, [field]: ' ' });
		expect(((await actions.create(event)) as Failure).data).toEqual({ action: 'create', error: sentence });
		expect(calls).toEqual([]);
	});

	it('keeps the stored certificate when the edit leaves it empty', async () => {
		const { event, calls } = write({ ...PROVIDER, id: 'p1', idp_cert: '' });
		expect(await actions.update(event)).toEqual({ saved: 'Okta' });
		expect(calls[0]).toMatchObject({ method: 'PUT', path: '/api/admin/saml-providers/p1' });
		expect(calls[0].body).not.toHaveProperty('idp_cert');
	});

	it('sends an emptied logout URL as a clear, so the stored one goes', async () => {
		const { event, calls } = write({ ...PROVIDER, id: 'p1', slo_url: '' });
		expect(await actions.update(event)).toEqual({ saved: 'Okta' });
		expect(calls[0].body).toHaveProperty('slo_url', '');
	});

	it.each([
		['entity_id', 'Enter the entity ID.'],
		['sso_url', 'Enter the sign-on URL.'],
	])('refuses an edit that empties %s before it saves anything', async (field, sentence) => {
		const { event, calls } = write({ ...PROVIDER, id: 'p1', [field]: ' ' });
		expect(((await actions.update(event)) as Failure).data).toEqual({ action: 'update', error: sentence });
		expect(calls).toEqual([]);
	});

	it.each([
		['delete', 'DELETE', '/api/admin/saml-providers/p1', { removed: 'p1' }],
		['prepare', 'POST', '/api/admin/saml-providers/p1/prepare-cert', { prepared: 'p1' }],
		['rollover', 'POST', '/api/admin/saml-providers/p1/rollover-cert', { rolled: 'p1' }],
	] as const)('sends %s for the named provider', async (name, method, path, answer) => {
		const { event, calls } = write({ id: 'p1' });
		expect(await actions[name](event)).toEqual(answer);
		expect(calls).toEqual([expect.objectContaining({ method, path })]);
	});

	it.each(['update', 'delete', 'prepare', 'rollover'] as const)('names nothing to %s without a request', async (name) => {
		const { event, calls } = write({ ...PROVIDER });
		expect(((await actions[name](event)) as Failure).data).toEqual({ action: name, error: 'This form is missing its provider. Reload the page and try again.' });
		expect(calls).toEqual([]);
	});

	it('relays the plugin refusal of a rollover with nothing prepared', async () => {
		const { event } = write({ id: 'p1' }, json({ error: 'no next certificate configured', code: 'bad_request' }, 400));
		const out = (await actions.rollover(event)) as Failure;
		expect(out.data).toEqual({ action: 'rollover', error: 'no next certificate configured' });
	});

	it.each([
		['create', 'Could not create the provider. Try again.'],
		['update', 'Could not save the provider. Try again.'],
		['delete', 'Could not delete the provider. Try again.'],
		['prepare', 'Could not prepare a new certificate. Try again.'],
		['rollover', 'Could not promote the certificate. Try again.'],
	] as const)('keeps outage detail off the page on %s', async (name, sentence) => {
		const { event } = write({ ...PROVIDER, id: 'p1' }, OUTAGE);
		expect(((await actions[name](event)) as Failure).data).toEqual({ action: name, error: sentence });
	});
});
