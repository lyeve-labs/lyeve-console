import { describe, expect, it } from 'vitest';
import { load } from './+page.server';
import { fixtureTranscript } from '$lib/components/ai/test-support/fixtures';
import { json, loadEvent, refused } from '$lib/components/ai/test-support/events';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

describe('admin/ai/transcripts load', () => {
	it('lists the window and forwards the filters', async () => {
		const { event, calls } = loadEvent(
			{ '/api/admin/ai/transcripts': () => json({ data: [fixtureTranscript], total: 1 }) },
			{ path: '/admin/ai/transcripts?kind=assistant&subject_kind=content&subject_id=post-1&limit=10' }
		);
		const out = (await load(event)) as Loaded;
		expect(out.transcripts).toHaveLength(1);
		expect(out.kind).toBe('assistant');
		expect(out.subjectKind).toBe('content');
		const url = calls[0].url;
		expect(url).toContain('limit=11');
		expect(url).toContain('kind=assistant');
		expect(url).toContain('subject_kind=content');
		expect(url).toContain('subject_id=post-1');
	});

	it('drops a kind the plugin does not know rather than sending it', async () => {
		const { event, calls } = loadEvent({ '/api/admin/ai/transcripts': () => json({ data: [], total: 0 }) }, { path: '/admin/ai/transcripts?kind=bogus' });
		const out = (await load(event)) as Loaded;
		expect(out.kind).toBe('');
		expect(calls[0].url).not.toContain('kind=');
	});

	it('steps back to the last page when the offset is past the end', async () => {
		const { event } = loadEvent({ '/api/admin/ai/transcripts': () => json({ data: [], total: 3 }) }, { path: '/admin/ai/transcripts?limit=2&offset=10' });
		await expect(load(event)).rejects.toMatchObject({ status: 307, location: expect.stringContaining('offset=2') });
	});

	it.each([
		[402, 'locked'],
		[403, 'forbidden'],
		[404, 'off'],
		[503, 'no_provider'],
	])('sorts a %i into the %s state', async (status, state) => {
		const { event } = loadEvent({ '/api/admin/ai/transcripts': () => refused(status, status === 503 ? 'no enabled AI provider configured' : 'refused') }, { path: '/admin/ai/transcripts' });
		const out = (await load(event)) as Loaded;
		expect(out.gate.state).toBe(state);
		expect(out.transcripts).toEqual([]);
	});
});
