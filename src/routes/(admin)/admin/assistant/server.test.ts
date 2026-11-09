import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import { mockCookies } from '$lib/components/ai/test-support/events';

const ORIGIN = 'http://localhost';

function event(fetch: typeof globalThis.fetch, body: unknown, origin = ORIGIN) {
	const request = new Request(`${ORIGIN}/admin/assistant`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', origin },
		body: JSON.stringify(body),
	});
	return { request, cookies: mockCookies(), url: new URL(`${ORIGIN}/admin/assistant`), fetch } as never;
}

const engine = (status: number, body: unknown) =>
	vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof globalThis.fetch;

describe('assistant route', () => {
	it('forwards only what the panel sends, as the person, and passes the stream through', async () => {
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			expect(url).toBe('/api/admin/ai/assistant');
			expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
			expect(JSON.parse(String(init?.body))).toEqual({
				prompt: 'Hi',
				form: { label: 'Entry', fields: [{ label: 'notes', kind: 'text', withheld: true }] },
			});
			return new Response('event: done\ndata: {}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
		}) as unknown as typeof globalThis.fetch;
		const res = await POST(
			event(fetch, {
				prompt: ' Hi ',
				provider_id: 'someone-elses',
				form: { label: 'Entry', fields: [{ name: 'notes', label: 'notes', kind: 'text', withheld: true, value: 'secret' }] },
			}),
		);
		expect(res.headers.get('content-type')).toContain('text/event-stream');
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(await res.text()).toBe('event: done\ndata: {}\n\n');
	});

	it('refuses a post from another origin before asking the engine', async () => {
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;
		const res = await POST(event(fetch, { prompt: 'Hi' }, 'https://elsewhere.example'));
		expect(res.status).toBe(403);
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each([
		[403, { error: 'the assistant is switched off for this tenant', code: 'forbidden' }, 'assistant_off'],
		[403, { error: 'the assistant needs a signed-in session, not an API key', code: 'forbidden' }, 'api_key'],
		[403, { error: 'an administrator has to set a monthly budget on the AI provider before you can use the assistant', code: 'forbidden' }, 'no_cap'],
		[404, { error: 'not found', code: 'not_found' }, 'ai_off'],
		[503, { error: 'pq: connection refused' }, 'outage'],
	])('answers a %i from the engine with its kind, never its text', async (status, body, refusal) => {
		const res = await POST(event(engine(status, body), { prompt: 'Hi' }));
		const answer = await res.json();
		expect(answer).toEqual({ refusal });
	});
});
