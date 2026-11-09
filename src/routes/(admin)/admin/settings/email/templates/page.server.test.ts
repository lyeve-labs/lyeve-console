import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load } from './+page.server';
import type { PluginSet } from '$lib/plugins';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return { get: vi.fn(() => 'tok'), set: vi.fn(), delete: vi.fn(), getAll: vi.fn(() => []), serialize: vi.fn(() => '') } as unknown as Cookies;
}

type Route = (url: string, init?: RequestInit) => Response;

function fetchFor(routes: Record<string, Route>) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const asked = String(url);
		calls.push({ url: asked, init });
		if (asked.includes('/auth/me')) return json({ id: 'u1', roles: ['admin'], disabled: false });
		for (const [needle, route] of Object.entries(routes)) if (asked.includes(needle)) return route(asked, init);
		return json({ error: 'no route' }, 404);
	}) as unknown as typeof globalThis.fetch;
	return { fetch, calls };
}

const withEmail: PluginSet = { state: 'named', running: ['email'], withheld: [] };
const URL_ = new URL('http://localhost/admin/settings/email/templates');

function loadEvent(routes: Record<string, Route>, plugins = withEmail) {
	const { fetch, calls } = fetchFor(routes);
	return { calls, event: { fetch, cookies: mockCookies(), url: URL_, parent: async () => ({ plugins }) } as never };
}

function actionEvent(entries: Record<string, string>, routes: Record<string, Route>) {
	const fd = new FormData();
	fd.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(entries)) fd.append(k, v);
	const { fetch, calls } = fetchFor(routes);
	return { calls, event: { fetch, cookies: mockCookies(), request: { formData: async () => fd, clone: () => ({ formData: async () => fd }) }, url: URL_, params: {} } as never };
}

const reset = { id: 't1', key: 'password-reset', subject: 'Reset', mjml_source: '<mjml/>', status: 'active', required: true };
const sale = { id: 't2', key: 'spring-sale', subject: 'Sale', mjml_source: '<mjml/>', status: 'draft', required: false };

const routes: Record<string, Route> = {
	'/api/admin/email-templates/limits': () => json({ templates: { limit: 5, current: 2 } }),
	'/api/admin/email-templates/starters': () => json({ data: [{ key: 'welcome', subject: 'Hi', mjml_source: '<mjml/>', required: false }] }),
	'/api/admin/email-templates': () => json({ data: [reset, sale], total: 2 }),
};

describe('email templates load', () => {
	it('reads the list before the count, so the required templates are counted', async () => {
		const { event, calls } = loadEvent(routes);
		const out = (await load(event)) as Loaded;
		expect(out.templates.ok && out.templates.value.map((t: { key: string; required: boolean }) => [t.key, t.required])).toEqual([
			['password-reset', true],
			['spring-sale', false],
		]);
		expect(out.limits).toEqual({ limit: 5, current: 2 });
		expect(out.starters.ok && out.starters.value.map((s: { key: string }) => s.key)).toEqual(['welcome']);
		const order = calls.map((c) => c.url).filter((u) => u.includes('email-templates'));
		expect(order[0]).toContain('/api/admin/email-templates?limit=200');
	});

	it('takes the session from the layout rather than asking the engine again', async () => {
		const { event, calls } = loadEvent(routes);
		await load(event);
		expect(calls.some((c) => c.url.includes('/auth/me'))).toBe(false);
		expect(calls.every((c) => (c.init?.headers as Record<string, string>).Authorization === 'Bearer tok')).toBe(true);
	});

	it('says the list failed rather than drawing an empty one', async () => {
		const { event } = loadEvent({ '/api/admin/email-templates?': () => json({ error: 'db down' }, 503), ...routes });
		const out = (await load(event)) as Loaded;
		expect(out.templates).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('keeps a failed starters read apart from a list of none', async () => {
		const { event } = loadEvent({ ...routes, '/api/admin/email-templates/starters': () => json({ error: 'boom' }, 500) });
		const out = (await load(event)) as Loaded;
		expect(out.starters.ok).toBe(false);
		expect(out.templates.ok).toBe(true);
	});

	it('asks nothing while the plugin does not run', async () => {
		const { event, calls } = loadEvent(routes, { state: 'named', running: [], withheld: [] });
		await load(event);
		expect(calls.filter((c) => c.url.includes('email-templates'))).toEqual([]);
	});
});

describe('email templates save', () => {
	it('creates under the name with the body as typed', async () => {
		const body = '  <mjml>{{.Vars.name}}</mjml>\n';
		const { event, calls } = actionEvent(
			{ key: 'order-shipped', subject: 'Shipped', mjml_source: body, status: 'active' },
			{ '/api/admin/email-templates': () => json({ ...sale, id: 't9' }, 201) },
		);
		expect(await actions.save(event)).toEqual({ saved: 't9' });
		const post = calls.find((c) => c.init?.method === 'POST');
		expect(JSON.parse(String(post?.init?.body))).toEqual({ key: 'order-shipped', subject: 'Shipped', mjml_source: body, status: 'active' });
	});

	it('refuses a name the plugin would not route before asking it', async () => {
		const { event, calls } = actionEvent({ key: 'Order Shipped', subject: 'S', mjml_source: '' }, {});
		expect(await actions.save(event)).toMatchObject({ status: 400 });
		expect(calls.filter((c) => c.url.includes('email-templates'))).toEqual([]);
	});

	it('updates by id and relays the sentence a refused body gets', async () => {
		const { event } = actionEvent(
			{ id: 't1', subject: 'Reset', mjml_source: '<mjml/>', status: 'active' },
			{ '/api/admin/email-templates/t1': () => json({ error: 'This template is required, and its body has to include {{.Vars.reset_link}}, the link the mail delivers.', code: 'http_422' }, 422) },
		);
		expect(await actions.save(event)).toMatchObject({ status: 422, data: { error: expect.stringContaining('{{.Vars.reset_link}}') } });
	});

	it('relays the ceiling with its numbers', async () => {
		const { event } = actionEvent(
			{ key: 'sixth', subject: 'S', mjml_source: '' },
			{ '/api/admin/email-templates': () => json({ error: 'cap_exceeded', cap: 'email.templates', limit: 5, current: 5 }, 402) },
		);
		expect(await actions.save(event)).toMatchObject({ status: 402, data: { refused: { kind: 'cap', limit: 5, current: 5 } } });
	});

	it('names a taken name', async () => {
		const { event } = actionEvent({ key: 'welcome', subject: 'S', mjml_source: '' }, { '/api/admin/email-templates': () => json({ error: 'exists' }, 409) });
		expect(await actions.save(event)).toMatchObject({ status: 409, data: { error: 'A template with that name already exists.' } });
	});
});

describe('email templates delete and preview', () => {
	it('relays the refusal to delete a required template', async () => {
		const { event } = actionEvent({ id: 't1' }, { '/api/admin/email-templates/t1': () => json({ error: 'This template is required: the sign-in mails are sent from it. Edit it instead.', code: 'conflict' }, 409) });
		expect(await actions.delete(event)).toMatchObject({ status: 409, data: { error: expect.stringContaining('required') } });
	});

	it('renders with sample values and answers the subject and the HTML', async () => {
		const { event, calls } = actionEvent({ key: 'password-reset' }, { '/preview': () => json({ subject: 'Reset', html: '<p>hi</p>' }) });
		expect(await actions.preview(event)).toEqual({ preview: { key: 'password-reset', subject: 'Reset', html: '<p>hi</p>' } });
		const sent = JSON.parse(String(calls.find((c) => c.url.includes('/preview'))?.init?.body));
		expect(sent.vars.reset_link).toMatch(/^https:/);
	});
});
