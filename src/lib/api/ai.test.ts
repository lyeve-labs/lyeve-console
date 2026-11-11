import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import { aiFreeTier, getCapabilities, listProviders, retentionDays, listTranscripts, providerKindLabel, savePromptVersion, transcriptExportPath, transcriptTotals } from './ai';
import { fixtureProvider, fixtureSettings, fixtureTranscript } from '$lib/components/ai/test-support/fixtures';

function client(answer: unknown) {
	const get = vi.fn(async () => answer);
	const post = vi.fn(async () => answer);
	return { client: { get, post, put: vi.fn(), patch: vi.fn(), delete: vi.fn() } as unknown as HttpClient, get, post };
}

describe('ai api paths', () => {
	it('reads an envelope or a bare array as one page', async () => {
		const enveloped = client({ data: [fixtureProvider], total: 7 });
		expect(await listProviders(enveloped.client, { limit: 10, offset: 20 })).toEqual({ rows: [fixtureProvider], total: 7, ceiling: null });
		expect(enveloped.get).toHaveBeenCalledWith('/api/admin/ai/providers?limit=10&offset=20');
		const bare = client([fixtureTranscript]);
		expect(await listTranscripts(bare.client, { kind: 'node', subject_id: '' })).toEqual({ rows: [fixtureTranscript], total: null });
		expect(bare.get).toHaveBeenCalledWith('/api/admin/ai/transcripts?kind=node');
	});

	it('reads the provider ceiling the list states, and none from an older plugin', async () => {
		const url = 'https://lyeve.com/pricing?skus=plugin-ai-pro';
		const free = client({ data: [], total_count: 0, limit: 10, offset: 0, provider_limit: 1, upgrade_url: url });
		expect((await listProviders(free.client)).ceiling).toEqual({ limit: 1, upgradeUrl: url });
		const pro = client({ data: [], total_count: 0, limit: 10, offset: 0, provider_limit: 0 });
		expect((await listProviders(pro.client)).ceiling).toEqual({ limit: 0, upgradeUrl: '' });
		const older = client({ data: [], total_count: 0, limit: 10, offset: 0 });
		expect((await listProviders(older.client)).ceiling).toBeNull();
		const odd = client({ data: [], provider_limit: 'one' });
		expect((await listProviders(odd.client)).ceiling).toBeNull();
	});

	it('encodes the id and the model in a path', async () => {
		const c = client({});
		await getCapabilities(c.client, 'a b', 'meta/llama');
		expect(c.get).toHaveBeenCalledWith('/api/admin/ai/providers/a%20b/capabilities?model=meta%2Fllama');
		await savePromptVersion(c.client, 'flow_assistant', 'text');
		expect(c.post).toHaveBeenCalledWith('/api/admin/ai/prompts/flow_assistant', { body: 'text' });
		expect(transcriptExportPath('x/y', 'markdown')).toBe('/api/admin/ai/transcripts/x%2Fy/export?format=markdown');
	});

	it('sums tokens and cost over the messages and survives a bad cost string', () => {
		expect(transcriptTotals(fixtureTranscript.messages)).toEqual({ tokens_in: 120, tokens_out: 80, cost: 0.0011 });
		expect(transcriptTotals([{ ...fixtureTranscript.messages![1], cost_estimate: 'n/a' }])).toMatchObject({ cost: 0 });
		expect(transcriptTotals(undefined)).toEqual({ tokens_in: 0, tokens_out: 0, cost: 0 });
	});

	it('names the four kinds', () => {
		expect(['openai', 'anthropic', 'openai_compatible', 'anthropic_compatible', 'other'].map(providerKindLabel)).toEqual(['OpenAI', 'Anthropic', 'OpenAI-compatible', 'Anthropic-compatible', 'other']);
	});
});

describe('the AI free tier', () => {
	const free = { ...fixtureSettings, transcript_retention: { value: '720h', source: 'free_tier', editable: false, reason: 'r' } };
	const licensed = { ...fixtureSettings, transcript_retention: { value: '2160h', source: 'config', editable: true } };

	it('reads the free tier from the transcript window a plugin that knows it reports', () => {
		expect(aiFreeTier(free, [])).toBe(true);
		expect(aiFreeTier(licensed, [])).toBe(false);
	});

	// An engine that holds the AI license can still withhold it from one tenant.
	it('reads a license withheld from this tenant as the free tier', () => {
		expect(aiFreeTier(licensed, ['ai-pro'])).toBe(true);
	});

	// An engine that gates AI as a whole runs a plugin with no window to
	// report, and its tenants meet no ceiling.
	it('reads no free tier from a plugin older than it, or from no settings at all', () => {
		expect(aiFreeTier(fixtureSettings, ['ai-pro'])).toBe(false);
		expect(aiFreeTier(null, [])).toBe(false);
	});

	it('writes a window of whole days in days', () => {
		expect(retentionDays('720h')).toBe('30 days');
		expect(retentionDays('24h')).toBe('1 day');
		expect(retentionDays('36h')).toBe('36h');
		expect(retentionDays('1h30m0s')).toBe('1h30m0s');
	});
});
