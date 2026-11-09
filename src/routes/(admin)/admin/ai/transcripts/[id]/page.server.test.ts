import { describe, expect, it } from 'vitest';
import { actions, load } from './+page.server';
import { fixtureSettings, fixtureTranscript } from '$lib/components/ai/test-support/fixtures';
import { actionEvent, json, loadEvent, refused } from '$lib/components/ai/test-support/events';

const id = fixtureTranscript.id;
const path = `/admin/ai/transcripts/${id}`;
const params = { id };
type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

describe('admin/ai/transcripts/[id] load', () => {
	it('reads the transcript with its messages', async () => {
		const { event } = loadEvent({ [`/api/admin/ai/transcripts/${id}`]: () => json(fixtureTranscript) }, { path, params });
		const out = (await load(event)) as Loaded;
		expect(out.transcript?.messages).toHaveLength(2);
	});

	it('tells a missing transcript from the tenant switch', async () => {
		const routes = { [`/api/admin/ai/transcripts/${id}`]: () => refused(404, 'ai transcript not found') };
		await expect(load(loadEvent(routes, { path, params }).event)).rejects.toMatchObject({ status: 404, body: { message: 'This transcript no longer exists.' } });
		const off = loadEvent(routes, { path, params, settings: { ...fixtureSettings, enabled: false } });
		expect(((await load(off.event)) as Loaded).gate).toEqual({ state: 'off' });
	});

	it.each([
		[402, 'locked'],
		[403, 'forbidden'],
		[503, 'no_provider'],
	])('sorts a %i into the %s state', async (status, state) => {
		const { event } = loadEvent({ [`/api/admin/ai/transcripts/${id}`]: () => refused(status, status === 503 ? 'no enabled AI provider configured' : 'refused') }, { path, params });
		expect(((await load(event)) as Loaded).gate.state).toBe(state);
	});
});

describe('admin/ai/transcripts/[id] recap', () => {
	it('answers with the recap the plugin wrote', async () => {
		const { event, calls } = actionEvent(
			{ [`/transcripts/${id}/recap`]: () => json({ id, recap: 'The intro was tightened.', model: 'gpt-4o', tokens_in: 50, tokens_out: 12, cost_estimate: '0.0002' }) },
			new FormData(),
			{ path, params, roles: ['admin'] }
		);
		expect(await actions.recap(event)).toEqual({ recap: 'The intro was tightened.' });
		expect(calls.find((c) => c.url.includes('/recap'))?.init?.method).toBe('POST');
	});

	it('says when there is nothing to recap and when no provider can', async () => {
		const empty = actionEvent({ [`/transcripts/${id}/recap`]: () => refused(422, 'transcript has no messages to recap') }, new FormData(), { path, params });
		expect(await actions.recap(empty.event)).toMatchObject({ status: 422, data: { error: 'The transcript has no messages to recap.' } });
		const none = actionEvent({ [`/transcripts/${id}/recap`]: () => refused(503, 'no enabled AI provider configured') }, new FormData(), { path, params });
		expect(await actions.recap(none.event)).toMatchObject({ status: 400, data: { error: expect.stringContaining('No AI provider is enabled') } });
	});
});
