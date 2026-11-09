import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import { getCapabilities, listProviders, listTranscripts, providerKindLabel, savePromptVersion, transcriptExportPath, transcriptTotals } from './ai';
import { fixtureProvider, fixtureTranscript } from '$lib/components/ai/test-support/fixtures';

function client(answer: unknown) {
	const get = vi.fn(async () => answer);
	const post = vi.fn(async () => answer);
	return { client: { get, post, put: vi.fn(), patch: vi.fn(), delete: vi.fn() } as unknown as HttpClient, get, post };
}

describe('ai api paths', () => {
	it('reads an envelope or a bare array as one page', async () => {
		const enveloped = client({ data: [fixtureProvider], total: 7 });
		expect(await listProviders(enveloped.client, { limit: 10, offset: 20 })).toEqual({ rows: [fixtureProvider], total: 7 });
		expect(enveloped.get).toHaveBeenCalledWith('/api/admin/ai/providers?limit=10&offset=20');
		const bare = client([fixtureTranscript]);
		expect(await listTranscripts(bare.client, { kind: 'node', subject_id: '' })).toEqual({ rows: [fixtureTranscript], total: null });
		expect(bare.get).toHaveBeenCalledWith('/api/admin/ai/transcripts?kind=node');
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
