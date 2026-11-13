import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@lyeve-labs/client';
import { importSchemaPreset } from './schema-preset-catalog';

describe('importSchemaPreset', () => {
	it('posts the document text to the import route and returns what was created', async () => {
		const calls: { url: string; init?: RequestInit }[] = [];
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({ url: String(url), init });
			return new Response(JSON.stringify({ created: ['notes'] }), { status: 201, headers: { 'content-type': 'application/json' } });
		}) as unknown as typeof globalThis.fetch;

		const result = await importSchemaPreset(createClient(fetch, {}), 'id: notes\n');

		expect(result).toEqual({ created: ['notes'] });
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toContain('/api/admin/schemas/presets/import');
		expect(calls[0].init?.method).toBe('POST');
		expect(JSON.parse(String(calls[0].init?.body))).toEqual({ document: 'id: notes\n' });
	});
});
