import { describe, expect, it } from 'vitest';
import { actions, load } from './+page.server';
import { fixturePrompt, fixtureSettings } from '$lib/components/ai/test-support/fixtures';
import { actionEvent, formOf, json, loadEvent, refused, sentBody } from '$lib/components/ai/test-support/events';

const path = '/admin/ai/prompts/summarize';
const params = { use_case: 'summarize' };
type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

describe('admin/ai/prompts/[use_case] load', () => {
	it('reads the use case', async () => {
		const { event } = loadEvent({ '/api/admin/ai/prompts/summarize': () => json(fixturePrompt) }, { path, params });
		const out = (await load(event)) as Loaded;
		expect(out.prompt?.active_version).toBe(2);
	});

	it('tells an unknown use case from the tenant switch', async () => {
		const routes = { '/api/admin/ai/prompts/summarize': () => refused(404, 'unknown prompt use case') };
		await expect(load(loadEvent(routes, { path, params }).event)).rejects.toMatchObject({ status: 404, body: { message: 'This use case no longer exists.' } });
		const off = loadEvent(routes, { path, params, settings: { ...fixtureSettings, enabled: false } });
		expect(((await load(off.event)) as Loaded).gate).toEqual({ state: 'off' });
	});

	it.each([
		[402, 'locked'],
		[403, 'forbidden'],
		[503, 'no_provider'],
	])('sorts a %i into the %s state', async (status, state) => {
		const { event } = loadEvent({ '/api/admin/ai/prompts/summarize': () => refused(status, status === 503 ? 'no enabled AI provider configured' : 'refused') }, { path, params });
		expect(((await load(event)) as Loaded).gate.state).toBe(state);
	});
});

describe('admin/ai/prompts/[use_case] actions', () => {
	it('saves the body as a new version', async () => {
		const { event, calls } = actionEvent(
			{ '/api/admin/ai/prompts/summarize': () => json({ ...fixturePrompt.versions[0], version: 3 }, 201) },
			formOf({ body: 'Summarize in one line.' }),
			{ path, params, roles: ['admin'] }
		);
		expect(await actions.save(event)).toEqual({ scope: 'save', version: 3 });
		expect(sentBody(calls, '/api/admin/ai/prompts/summarize')).toEqual({ body: 'Summarize in one line.' });
	});

	it('refuses an empty body before the engine is asked', async () => {
		const { event, calls } = actionEvent({}, formOf({ body: '   ' }), { path, params });
		expect(await actions.save(event)).toMatchObject({ status: 400, data: { error: 'Enter a prompt.' } });
		expect(calls.some((c) => c.url.includes('/ai/prompts'))).toBe(false);
	});

	it('makes an older version current by saving its text again', async () => {
		const { event, calls } = actionEvent(
			{
				'/api/admin/ai/prompts/summarize': (_url, init) =>
					init?.method === 'POST' ? json({ ...fixturePrompt.versions[1], version: 3 }, 201) : json(fixturePrompt),
			},
			formOf({ version: '1' }),
			{ path, params }
		);
		expect(await actions.restore(event)).toEqual({ scope: 'restore', version: 3, from: 1 });
		expect(sentBody(calls, '/api/admin/ai/prompts/summarize')).toEqual({ body: 'Summarize briefly.' });
	});

	it('restores the shipped default as version 0', async () => {
		const { event, calls } = actionEvent(
			{
				'/api/admin/ai/prompts/summarize': (_url, init) =>
					init?.method === 'POST' ? json({ ...fixturePrompt.versions[1], version: 3 }, 201) : json(fixturePrompt),
			},
			formOf({ version: '0' }),
			{ path, params }
		);
		expect(await actions.restore(event)).toMatchObject({ from: 0 });
		expect(sentBody(calls, '/api/admin/ai/prompts/summarize')).toEqual({ body: fixturePrompt.default });
	});

	it('names a version that does not exist', async () => {
		const { event } = actionEvent({ '/api/admin/ai/prompts/summarize': () => json(fixturePrompt) }, formOf({ version: '9' }), { path, params });
		expect(await actions.restore(event)).toMatchObject({ status: 404, data: { error: 'Version 9 does not exist. Reload the page.' } });
	});
});
