import { describe, expect, it } from 'vitest';
import { readProviderForm } from './ai-provider-form';
import type { AiProvider } from '$lib/api/ai';

function form(fields: Record<string, string | string[]>): FormData {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		for (const each of Array.isArray(v) ? v : [v]) data.append(k, each);
	}
	return data;
}

const stored: AiProvider = {
	id: 'p1',
	name: 'primary',
	kind: 'openai',
	has_key: true,
	needs_key: false,
	base_url: '',
	key_header: '',
	query_string: '',
	allow_private: false,
	default_model: 'gpt-4o',
	enabled: true,
	priority: 100,
	modalities: ['text'],
	rate_limit_rpm: 0,
	max_budget_usd: 0,
	created_at: '2026-09-15T00:00:00Z',
	updated_at: '2026-09-15T00:00:00Z',
};

describe('readProviderForm', () => {
	it('requires a key for a native kind on create and keeps the stored one on edit', () => {
		const fields = { name: 'primary', kind: 'openai', modalities: ['text'] };
		expect(readProviderForm(form(fields), null, true)).toEqual({ error: 'Enter an API key. This kind needs one.' });
		const kept = readProviderForm(form(fields), stored, true);
		expect(kept).toMatchObject({ input: { name: 'primary', kind: 'openai' } });
		expect('input' in kept && kept.input.api_key).toBeUndefined();
	});

	it('requires a base URL for the compatible kind and carries its endpoint fields', () => {
		expect(readProviderForm(form({ name: 'local', kind: 'openai_compatible', modalities: 'text' }), null, true)).toEqual({
			error: 'Enter a base URL. The OpenAI-compatible kind needs one.',
		});
		const out = readProviderForm(
			form({
				name: 'azure',
				kind: 'openai_compatible',
				preset: 'azure',
				base_url: 'https://x.openai.azure.com/openai',
				key_header: 'api-key',
				query_string: 'api-version=2024-10-21',
				api_key: 'k',
				modalities: ['text', 'embed'],
				priority: '10',
			}),
			null,
			false
		);
		expect(out).toEqual({
			input: {
				name: 'azure',
				kind: 'openai_compatible',
				preset: 'azure',
				api_key: 'k',
				base_url: 'https://x.openai.azure.com/openai',
				key_header: 'api-key',
				query_string: 'api-version=2024-10-21',
				allow_private: false,
				default_model: '',
				enabled: true,
				priority: 10,
				modalities: ['text', 'embed'],
				rate_limit_rpm: 0,
				max_budget_usd: 0,
			},
		});
	});

	it('refuses allow_private from anyone but a super admin', () => {
		const fields = { name: 'ollama', kind: 'openai_compatible', base_url: 'http://localhost:11434/v1', allow_private: 'true', modalities: 'text' };
		expect(readProviderForm(form(fields), null, false)).toEqual({ error: 'Only a super admin can allow a private address.' });
		expect(readProviderForm(form(fields), null, true)).toMatchObject({ input: { allow_private: true } });
	});

	it('bounds the numbers and needs one modality', () => {
		const base = { name: 'p', kind: 'anthropic', api_key: 'k' };
		expect(readProviderForm(form({ ...base, modalities: 'text', priority: '5000' }), null, true)).toMatchObject({ error: expect.stringContaining('priority') });
		expect(readProviderForm(form({ ...base, modalities: 'text', rate_limit_rpm: '-1' }), null, true)).toMatchObject({ error: expect.stringContaining('rate limit') });
		expect(readProviderForm(form({ ...base, modalities: 'text', max_budget_usd: 'lots' }), null, true)).toMatchObject({ error: expect.stringContaining('budget') });
		expect(readProviderForm(form({ ...base }), null, true)).toEqual({ error: 'Choose at least one modality.' });
	});

	// An Anthropic-compatible endpoint is a base URL speaking the Messages API:
	// it needs the URL, may run keyless, and takes no OpenAI preset.
	it('reads the Anthropic-compatible kind like the OpenAI one, without a preset', () => {
		expect(readProviderForm(form({ name: 'gw', kind: 'anthropic_compatible', modalities: 'text' }), null, true)).toEqual({
			error: 'Enter a base URL. The Anthropic-compatible kind needs one.',
		});
		const read = readProviderForm(
			form({ name: 'gw', kind: 'anthropic_compatible', base_url: 'https://gw.example.com/anthropic/v1', key_header: 'Authorization', preset: 'groq', modalities: 'text' }),
			null,
			true,
		);
		expect('input' in read && read.input).toMatchObject({ kind: 'anthropic_compatible', base_url: 'https://gw.example.com/anthropic/v1', key_header: 'Authorization' });
		expect('input' in read && read.input.preset).toBeUndefined();
	});

	it('refuses a provider kind the form does not offer', () => {
		expect(readProviderForm(form({ name: 'g', kind: 'example', api_key: 'k', modalities: 'text' }), null, true)).toEqual({ error: 'Choose a provider kind.' });
	});
});
