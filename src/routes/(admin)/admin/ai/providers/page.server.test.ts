import { describe, expect, it } from 'vitest';
import { actions, load } from './+page.server';
import { fixtureLocalProvider, fixtureProvider } from '$lib/components/ai/test-support/fixtures';
import type { AiProvider } from '$lib/api/ai';
import { actionEvent, formOf, json, loadEvent, refused, sentBody } from '$lib/components/ai/test-support/events';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

describe('admin/ai/providers load', () => {
	it('lists the providers and reads the dashboard beside them', async () => {
		const { event, calls } = loadEvent({
			'/api/admin/ai/providers': () => json({ data: [fixtureProvider, fixtureLocalProvider], total: 2 }),
			'/api/admin/ai/dashboard': () => json({ total_calls: 3, total_cost: '0.01', avg_latency_ms: 200, enabled_providers: 1, total_providers: 2 }),
		});
		const out = (await load(event)) as Loaded;
		expect(out.gate).toEqual({ state: 'ok' });
		expect(out.providers.map((p: AiProvider) => p.name)).toEqual(['openai-primary', 'ollama']);
		expect(out.total).toBe(2);
		expect(out.dashboard?.enabled_providers).toBe(1);
		expect(calls[0].url).toContain('/api/admin/ai/providers?limit=51&offset=0');
	});

	it('stands without the dashboard', async () => {
		const { event } = loadEvent({
			'/api/admin/ai/providers': () => json({ data: [fixtureProvider], total: 1 }),
			'/api/admin/ai/dashboard': () => refused(500, 'boom'),
		});
		const out = (await load(event)) as Loaded;
		expect(out.providers).toHaveLength(1);
		expect(out.dashboard).toBeNull();
	});

	it.each([
		[402, 'locked'],
		[403, 'forbidden'],
		[404, 'off'],
		[503, 'no_provider'],
	])('sorts a %i into the %s state and reads nothing else', async (status, state) => {
		const { event, calls } = loadEvent({ '/api/admin/ai/providers': () => refused(status, status === 503 ? 'no enabled AI provider configured' : 'refused') });
		const out = (await load(event)) as Loaded;
		expect(out.gate.state).toBe(state);
		expect(out.providers).toEqual([]);
		expect(calls.some((c) => c.url.includes('/dashboard'))).toBe(false);
	});

	it('keeps the engine banner for a 500 and never its text', async () => {
		const { event } = loadEvent({ '/api/admin/ai/providers': () => refused(500, 'pq: connection refused') });
		const out = (await load(event)) as Loaded;
		expect(out.gate).toEqual({ state: 'error', message: expect.stringContaining('Could not load') });
		expect(JSON.stringify(out.gate)).not.toContain('pq:');
	});
});

describe('admin/ai/providers create', () => {
	it('posts the form as the plugin input and lands on the new row', async () => {
		const { event, calls } = actionEvent(
			{ '/api/admin/ai/providers': () => json({ ...fixtureProvider, id: 'new-id' }, 201) },
			formOf({ name: 'primary', kind: 'openai', api_key: 'sk-1', modalities: ['text', 'embed'], priority: '5', enabled: 'true' })
		);
		await expect(actions.create(event)).rejects.toMatchObject({ status: 303, location: '/admin/ai/providers/new-id' });
		expect(sentBody(calls, '/api/admin/ai/providers')).toMatchObject({ name: 'primary', kind: 'openai', api_key: 'sk-1', modalities: ['text', 'embed'], priority: 5 });
	});

	it('refuses a tenant admin before the engine is asked', async () => {
		const { event, calls } = actionEvent({}, formOf({ name: 'x', kind: 'openai', api_key: 'k', modalities: 'text' }), { roles: ['admin'] });
		await expect(actions.create(event)).rejects.toMatchObject({ status: 403 });
		expect(calls.some((c) => c.url.includes('/api/admin/ai/providers'))).toBe(false);
	});

	it('relays the plugin reason for a refused write', async () => {
		const { event } = actionEvent(
			{ '/api/admin/ai/providers': () => refused(400, 'base_url does not resolve to a public address; allow_private is required for a private one') },
			formOf({ name: 'local', kind: 'openai_compatible', base_url: 'http://10.0.0.5/v1', modalities: 'text' })
		);
		const out = await actions.create(event);
		expect(out).toMatchObject({ status: 400, data: { error: expect.stringContaining('allow_private is required') } });
	});

	it('says the feature is not enabled on a 402', async () => {
		const { event } = actionEvent(
			{ '/api/admin/ai/providers': () => refused(402, 'payment_required') },
			formOf({ name: 'x', kind: 'openai', api_key: 'k', modalities: 'text' })
		);
		expect(await actions.create(event)).toMatchObject({ status: 400, data: { error: 'AI is not enabled on this engine.' } });
	});
});
