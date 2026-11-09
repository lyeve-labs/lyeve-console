import { describe, expect, it } from 'vitest';
import { load } from './+page.server';
import { fixtureDefaultPrompt, fixturePrompt } from '$lib/components/ai/test-support/fixtures';
import type { PromptView } from '$lib/api/ai';
import { json, loadEvent, refused } from '$lib/components/ai/test-support/events';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

describe('admin/ai/prompts load', () => {
	it('lists every use case with its default and versions', async () => {
		const { event } = loadEvent({ '/api/admin/ai/prompts': () => json({ prompts: [fixturePrompt, fixtureDefaultPrompt] }) }, { path: '/admin/ai/prompts' });
		const out = (await load(event)) as Loaded;
		expect(out.gate).toEqual({ state: 'ok' });
		expect(out.prompts.map((p: PromptView) => [p.use_case, p.active_version])).toEqual([
			['summarize', 2],
			['translate', 0],
		]);
	});

	it.each([
		[402, 'locked'],
		[403, 'forbidden'],
		[404, 'off'],
		[503, 'no_provider'],
	])('sorts a %i into the %s state', async (status, state) => {
		const { event } = loadEvent({ '/api/admin/ai/prompts': () => refused(status, status === 503 ? 'no enabled AI provider configured' : 'refused') }, { path: '/admin/ai/prompts' });
		const out = (await load(event)) as Loaded;
		expect(out.gate.state).toBe(state);
		expect(out.prompts).toEqual([]);
	});
});
