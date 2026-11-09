import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { proxyAuditDownload } from './audit-download';
import { OUTAGE } from '$lib/outage';

/*
 * The export is a proxy, because SvelteKit refuses a form action that returns
 * a Response. Two things about it are easy to undo by accident: it must call
 * the engine out of process, and it must pass the download headers through
 * rather than inventing them.
 */
function event(cookie: string | null = 'sess-tok'): RequestEvent {
	return {
		cookies: { get: vi.fn(() => cookie ?? undefined) }
	} as unknown as RequestEvent;
}

const realFetch = globalThis.fetch;

let calls: [string, RequestInit | undefined][];

function stubFetch(answer: () => Promise<Response> | Response) {
	calls = [];
	globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
		calls.push([url, init]);
		return answer();
	}) as unknown as typeof fetch;
}

beforeEach(() => {
	calls = [];
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('proxyAuditDownload', () => {
	it('calls the engine by absolute URL, so no browser cookie is forwarded', async () => {
		stubFetch(() => new Response('[]', { status: 200 }));

		await proxyAuditDownload(event(), '/api/admin/audit-log/export', 'audit-log.json');

		expect(calls).toHaveLength(1);
		const [url, init] = calls[0];
		// Absolute, not '/api/...'. A relative URL through event.fetch would
		// forward the session cookie, flip the engine to cookie auth and apply
		// the CSRF check this proxy has no token to satisfy.
		expect(url).toMatch(/^https?:\/\/[^/]+\/api\/admin\/audit-log\/export$/);
		expect(init?.method).toBe('POST');
		const headers = new Headers(init?.headers);
		expect(headers.get('Authorization')).toBe('Bearer sess-tok');
		expect(headers.has('X-CSRF-Token')).toBe(false);
	});

	it('exports the filter on screen rather than the whole log', async () => {
		stubFetch(() => new Response('[]', { status: 200 }));
		const form = new FormData();
		form.set('action', 'content.delete');
		form.set('from', '2026-10-05');
		form.set('to', '2026-10-01');
		form.set('q', 'article');
		const filtered = {
			...event(),
			request: new Request('http://admin/api/admin/audit-log/export', { method: 'POST', body: form }),
		} as unknown as RequestEvent;

		await proxyAuditDownload(filtered, '/api/admin/audit-log/export', 'audit-log.json');

		expect(JSON.parse(String(calls[0][1]?.body))).toEqual({
			format: 'json',
			action: 'content.delete',
			resource_type: 'article',
			from: '2026-10-01T00:00:00Z',
			to: '2026-10-06T00:00:00Z',
		});
	});

	it('passes the engine download headers through untouched', async () => {
		stubFetch(
			() =>
				new Response('[]', {
					status: 200,
					headers: {
						'content-type': 'application/json',
						'content-disposition': 'attachment; filename="engine-named.json"'
					}
				})
		);

		const res = await proxyAuditDownload(event(), '/api/admin/audit-log/export', 'fallback.json');

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/json');
		expect(res.headers.get('content-disposition')).toBe('attachment; filename="engine-named.json"');
		expect(res.headers.get('cache-control')).toBe('no-store');
	});

	it('names the file itself when the engine does not', async () => {
		stubFetch(() => new Response('[]', { status: 200 }));

		const res = await proxyAuditDownload(event(), '/api/admin/audit-log/export', 'fallback.json');

		// Without this the browser renders the JSON in the tab instead of saving
		// it, which reads as the button doing nothing.
		expect(res.headers.get('content-disposition')).toBe('attachment; filename="fallback.json"');
	});

	it('refuses without a session cookie', async () => {
		stubFetch(() => new Response('[]', { status: 200 }));

		const thrown = await proxyAuditDownload(event(null), '/x', 'f.json').catch(
			(e: { status?: number }) => e
		);

		expect(thrown.status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	it('keeps the engine status on a refusal and sends no driver text', async () => {
		stubFetch(() => new Response('pq: relation "sys_audit_log" does not exist', { status: 503 }));

		const thrown = (await proxyAuditDownload(event(), '/x', 'f.json').catch((e) => e)) as {
			status?: number;
			body?: { message?: string };
		};

		expect(thrown.status).toBe(503);
		expect(thrown.body?.message).toBe('Export refused');
		expect(JSON.stringify(thrown)).not.toContain('sys_audit_log');
	});

	it('answers 502 when the engine cannot be reached', async () => {
		stubFetch(() => {
			throw new Error('ECONNREFUSED');
		});

		const thrown = await proxyAuditDownload(event(), '/x', 'f.json').catch(
			(e: { status?: number }) => e
		);

		expect(thrown).toMatchObject({ status: 502, body: { message: OUTAGE.body } });
	});
});
