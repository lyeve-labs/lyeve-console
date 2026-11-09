import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import { mockCookies } from '$lib/components/ai/test-support/events';

function event(fetch: typeof globalThis.fetch, format = 'markdown', session = true) {
	const cookies = mockCookies();
	if (!session) (cookies.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
	return { cookies, fetch, params: { id: 'abc' }, url: new URL(`http://localhost/admin/ai/transcripts/abc/export?format=${format}`) } as never;
}

describe('transcript export route', () => {
	it('forwards the engine file with its content type and filename', async () => {
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			expect(String(url)).toBe('/api/admin/ai/transcripts/abc/export?format=markdown');
			expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
			return new Response('# Transcript abc', {
				status: 200,
				headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': 'attachment; filename="transcript-abc.md"' },
			});
		}) as unknown as typeof globalThis.fetch;
		const res = await GET(event(fetch));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/markdown');
		expect(res.headers.get('content-disposition')).toContain('transcript-abc.md');
		expect(await res.text()).toBe('# Transcript abc');
	});

	it('falls back to json for a format it does not know', async () => {
		const fetch = vi.fn(async (url: string) => {
			expect(String(url)).toContain('format=json');
			return new Response('{}', { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
		}) as unknown as typeof globalThis.fetch;
		const res = await GET(event(fetch, 'xml'));
		expect(res.headers.get('content-type')).toContain('application/json');
		// The engine named no file, so the route does.
		expect(res.headers.get('content-disposition')).toBe('attachment; filename="transcript-abc.json"');
	});

	it('answers the refusals with their own words', async () => {
		for (const [status, message] of [
			[404, 'This transcript no longer exists.'],
			[402, 'AI is not enabled on this engine'],
			[403, 'Only an admin or a super admin can export transcripts.'],
		] as const) {
			const fetch = vi.fn(async () => new Response('{"error":"x"}', { status })) as unknown as typeof globalThis.fetch;
			await expect(GET(event(fetch))).rejects.toMatchObject({ status, body: { message } });
		}
	});

	it('refuses without a session before asking the engine', async () => {
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;
		await expect(GET(event(fetch, 'json', false))).rejects.toMatchObject({ status: 401 });
		expect(fetch).not.toHaveBeenCalled();
	});
});
