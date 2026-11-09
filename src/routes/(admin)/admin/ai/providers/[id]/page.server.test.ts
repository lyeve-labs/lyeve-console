import { describe, expect, it } from 'vitest';
import { actions, load } from './+page.server';
import { fixtureProvider, fixtureSettings } from '$lib/components/ai/test-support/fixtures';
import { actionEvent, formOf, json, loadEvent, refused, sentBody } from '$lib/components/ai/test-support/events';

const id = fixtureProvider.id;
const path = `/admin/ai/providers/${id}`;
type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

describe('admin/ai/providers/[id] load', () => {
	it('reads the provider', async () => {
		const { event } = loadEvent({ [`/api/admin/ai/providers/${id}`]: () => json(fixtureProvider) }, { path, params: { id } });
		const out = (await load(event)) as Loaded;
		expect(out.gate).toEqual({ state: 'ok' });
		expect(out.provider?.name).toBe('openai-primary');
	});

	it('tells a missing row from the tenant switch by what the settings read said', async () => {
		const routes = { [`/api/admin/ai/providers/${id}`]: () => refused(404, 'not found') };
		const on = loadEvent(routes, { path, params: { id } });
		await expect(load(on.event)).rejects.toMatchObject({ status: 404, body: { message: 'This provider no longer exists.' } });
		const off = loadEvent(routes, { path, params: { id }, settings: { ...fixtureSettings, enabled: false } });
		expect(((await load(off.event)) as Loaded).gate).toEqual({ state: 'off' });
	});

	it.each([
		[402, 'locked'],
		[403, 'forbidden'],
		[503, 'no_provider'],
	])('sorts a %i into the %s state', async (status, state) => {
		const { event } = loadEvent({ [`/api/admin/ai/providers/${id}`]: () => refused(status, status === 503 ? 'no enabled AI provider configured' : 'refused') }, { path, params: { id } });
		expect(((await load(event)) as Loaded).gate.state).toBe(state);
	});
});

describe('admin/ai/providers/[id] actions', () => {
	it('keeps the stored key when the form leaves it blank', async () => {
		const { event, calls } = actionEvent(
			{ [`/api/admin/ai/providers/${id}`]: (_url, init) => json(init?.method === 'PUT' ? { ...fixtureProvider, name: 'renamed' } : fixtureProvider) },
			formOf({ name: 'renamed', kind: 'openai', modalities: ['text'], priority: '10' }),
			{ path, params: { id } }
		);
		expect(await actions.update(event)).toEqual({ scope: 'config', saved: true });
		const body = sentBody(calls, `/api/admin/ai/providers/${id}`) as Record<string, unknown>;
		expect(body.name).toBe('renamed');
		expect(body).not.toHaveProperty('api_key');
	});

	it('lists the models the provider answers with', async () => {
		const { event } = actionEvent({ [`/providers/${id}/models`]: () => json({ models: ['gpt-4o', 'gpt-4o-mini'] }) }, new FormData(), { path, params: { id } });
		expect(await actions.models(event)).toEqual({ scope: 'models', models: ['gpt-4o', 'gpt-4o-mini'] });
	});

	// The plugin answers a vendor that did not list its models with a 503, which
	// is not the tenant missing a provider.
	it('says the provider did not answer when the model list answers 503', async () => {
		const { event } = actionEvent({ [`/providers/${id}/models`]: () => refused(503, 'failed to list models') }, new FormData(), { path, params: { id } });
		expect(await actions.models(event)).toMatchObject({ status: 400, data: { scope: 'models', error: 'Could not load the models from this provider.' } });
	});

	it('asks capabilities for the model named in the form', async () => {
		const { event, calls } = actionEvent(
			{ [`/providers/${id}/capabilities`]: () => json({ model: 'gpt-4o', kind: 'openai', max_tokens: 128000, text: true, embed: false, image: true, vision: true }) },
			formOf({ model: 'gpt-4o' }),
			{ path, params: { id } }
		);
		const out = await actions.capabilities(event);
		expect(out).toMatchObject({ scope: 'capabilities', capabilities: { vision: true } });
		expect(calls.find((c) => c.url.includes('/capabilities'))?.url).toContain('model=gpt-4o');
	});

	// Saving and deleting a provider are a super admin's alone. The refusal
	// comes before the engine is asked, so nothing is sent.
	it.each(['update', 'delete'] as const)('refuses %s to an admin and sends nothing', async (name) => {
		const { event, calls } = actionEvent(
			{ [`/api/admin/ai/providers/${id}`]: () => json(fixtureProvider) },
			formOf({ name: 'renamed', kind: 'openai', modalities: ['text'], priority: '10' }),
			{ path, params: { id }, roles: ['admin'] }
		);
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(calls.some((c) => c.init?.method === 'PUT' || c.init?.method === 'DELETE')).toBe(false);
	});

	it('deletes and returns to the list', async () => {
		const { event } = actionEvent({ [`/api/admin/ai/providers/${id}`]: () => new Response(null, { status: 204 }) }, new FormData(), { path, params: { id } });
		await expect(actions.delete(event)).rejects.toMatchObject({ status: 303, location: '/admin/ai/providers' });
	});
});
