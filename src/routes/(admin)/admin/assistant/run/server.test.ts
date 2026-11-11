import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import { mockCookies } from '$lib/components/ai/test-support/events';

const ORIGIN = 'http://localhost';

function event(fetch: typeof globalThis.fetch, body: unknown, origin = ORIGIN) {
	const request = new Request(`${ORIGIN}/admin/assistant/run`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', origin },
		body: JSON.stringify(body),
	});
	return { request, cookies: mockCookies(), url: new URL(`${ORIGIN}/admin/assistant/run`), fetch } as never;
}

const engine = (status: number, body?: unknown) =>
	vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })) as unknown as typeof globalThis.fetch;

describe('assistant run route', () => {
	it('sends the approved request to the engine as the person', async () => {
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			expect(url).toBe('/api/admin/webhooks/w1?dry_run=true');
			expect(init?.method).toBe('PATCH');
			expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
			expect(JSON.parse(String(init?.body))).toEqual({ active: false });
			return new Response(null, { status: 204 });
		}) as unknown as typeof globalThis.fetch;
		const res = await POST(event(fetch, { method: 'PATCH', path: '/api/admin/webhooks/w1', query: { dry_run: true }, body: { active: false } }));
		expect(await res.json()).toEqual({ ok: true, status: 204 });
	});

	it.each([
		['another host', 'https://evil.example/api/x'],
		['a path outside the API', '/admin/settings'],
		['a climb out of the API', '/api/../admin'],
		['a protocol-relative path', '//evil.example/api/x'],
	])('refuses %s without sending anything', async (_, path) => {
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;
		const res = await POST(event(fetch, { method: 'GET', path }));
		expect(res.status).toBe(400);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('refuses a post from another origin', async () => {
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;
		const res = await POST(event(fetch, { method: 'GET', path: '/api/admin/webhooks' }, 'https://elsewhere.example'));
		expect(res.status).toBe(403);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('shows the engine refusal only when it carries a code, and claims nothing after a 5xx', async () => {
		const run = { method: 'DELETE', path: '/api/admin/webhooks/w1' };
		expect(await (await POST(event(engine(403, { error: 'Only an admin or a super admin can delete webhooks.', code: 'forbidden' }), run))).json()).toEqual({
			ok: false,
			status: 403,
			message: 'Only an admin or a super admin can delete webhooks.',
		});
		expect(await (await POST(event(engine(400, { error: 'pq: syntax error' }), run))).json()).toMatchObject({ message: 'Could not run the request.' });
		expect(
			await (await POST(event(engine(422, { errors: [{ field: 'title', message: 'The field title is required.', code: 'VALIDATION_REQUIRED' }] }), run))).json(),
		).toEqual({ ok: false, status: 422, message: 'The field title is required.' });
		expect(await (await POST(event(engine(502, { error: 'bad gateway', code: 'x' }), run))).json()).toMatchObject({
			message: 'Check whether your change was saved, then try again.',
		});
	});
});
