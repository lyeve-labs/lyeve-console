import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { actions } from './+page.server';

type Call = { method: string; path: string; body: unknown };
type Failure = { status: number; data: { action?: string; error: string } };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function cookies(): Cookies {
	return { get: vi.fn(() => 'tok'), set: vi.fn(), delete: vi.fn(), getAll: vi.fn(() => []), serialize: vi.fn(() => '') } as unknown as Cookies;
}

/**
 * An action event against a fake engine. The session check answers with the
 * given roles, and every other request is recorded and answered with `reply`.
 */
function engine(fields: Record<string, string>, opts: { roles?: string[]; reply?: Response } = {}) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const path = String(url);
		if (path.includes('/auth/me')) return json({ id: 'u1', roles: opts.roles ?? ['super_admin'], disabled: false });
		calls.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return opts.reply?.clone() ?? json({});
	});
	const form = new FormData();
	form.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	const url = new URL('http://localhost/admin/audit-log/retention');
	return {
		calls,
		event: { fetch, cookies: cookies(), url, request: new Request(url, { method: 'POST', body: form }) } as never,
	};
}

// The audit plugin's own answers: a struct validation refusal, and the gate it
// closes while its store is unavailable.
const REFUSED = json({ error: 'validation failed on field "EventType": failed on \'max=255\'', fields: [], code: 'bad_request' }, 400);
const OUTAGE = json({ error: 'audit retention is unavailable' }, 503);

describe('retention writes by role', () => {
	const cases = [
		['createPolicy', { retention_days: '30' }],
		['deletePolicy', { id: 'p1' }],
		['createHold', { name: 'Litigation' }],
		['releaseHold', { id: 'h1' }],
		['enforce', {}],
	] as const;

	it.each(cases)('refuses %s to an admin before it reaches the engine', async (name, fields) => {
		const { event, calls } = engine(fields, { roles: ['admin'] });
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(calls).toEqual([]);
	});
});

describe('creating a retention policy', () => {
	it('posts the window and the archival settings', async () => {
		const { event, calls } = engine({
			event_type: ' content.delete ',
			resource_type: 'entry',
			retention_days: '90',
			archival_enabled: 'true',
			archival_storage: 'cold',
			archival_path_prefix: 'audit/',
		});
		expect(await actions.createPolicy(event)).toEqual({ saved: 'policy' });
		expect(calls).toEqual([
			{
				method: 'POST',
				path: '/api/admin/retention-policies',
				body: {
					event_type: 'content.delete',
					resource_type: 'entry',
					retention_days: 90,
					archival_enabled: true,
					archival_storage: 'cold',
					archival_path_prefix: 'audit/',
				},
			},
		]);
	});

	it.each(['-1', '1.5', 'soon'])('refuses a window of %s without a request', async (days) => {
		const { event, calls } = engine({ retention_days: days });
		const out = (await actions.createPolicy(event)) as Failure;
		expect(out.status).toBe(400);
		expect(out.data).toEqual({ action: 'createPolicy', error: 'Enter a whole number of days, 0 or more.' });
		expect(calls).toEqual([]);
	});

	it('refuses archival with nowhere to archive to', async () => {
		const { event, calls } = engine({ retention_days: '30', archival_enabled: 'true', archival_storage: ' ' });
		const out = (await actions.createPolicy(event)) as Failure;
		expect(out.data.error).toContain('Enter a storage backend to archive to');
		expect(calls).toEqual([]);
	});

	it('relays the engine refusal under its action', async () => {
		const { event } = engine({ retention_days: '30' }, { reply: REFUSED });
		const out = (await actions.createPolicy(event)) as Failure;
		expect(out.data).toEqual({ action: 'createPolicy', error: 'validation failed on field "EventType": failed on \'max=255\'' });
	});

	it('keeps outage detail off the page', async () => {
		const { event } = engine({ retention_days: '30' }, { reply: OUTAGE });
		const out = (await actions.createPolicy(event)) as Failure;
		expect(out.data).toEqual({ action: 'createPolicy', error: 'Could not create the policy. Try again.' });
	});
});

describe('removing a retention policy', () => {
	it('deletes the named policy', async () => {
		const { event, calls } = engine({ id: 'p 1' });
		expect(await actions.deletePolicy(event)).toEqual({ removed: 'p 1' });
		expect(calls).toEqual([{ method: 'DELETE', path: '/api/admin/retention-policies/p%201', body: undefined }]);
	});

	it('names nothing to delete without a request', async () => {
		const { event, calls } = engine({});
		expect(((await actions.deletePolicy(event)) as Failure).data).toEqual({ action: 'deletePolicy', error: 'This form is missing its policy. Reload the page and try again.' });
		expect(calls).toEqual([]);
	});

	it('relays a refusal and hides an outage', async () => {
		const refused = engine({ id: 'p1' }, { reply: json({ error: 'failed to delete retention policy', code: 'not_found' }, 404) });
		expect(((await actions.deletePolicy(refused.event)) as Failure).data.error).toBe('failed to delete retention policy');
		const down = engine({ id: 'p1' }, { reply: OUTAGE });
		expect(((await actions.deletePolicy(down.event)) as Failure).data.error).toBe('Could not delete the policy. Try again.');
	});
});

describe('placing a legal hold', () => {
	it('posts the hold and its filters', async () => {
		const { event, calls } = engine({ name: ' Litigation ', description: 'Case 4', filter_action: 'user.delete', filter_tenant_id: 'acme' });
		expect(await actions.createHold(event)).toEqual({ saved: 'Litigation' });
		expect(calls).toEqual([
			{
				method: 'POST',
				path: '/api/admin/legal-holds',
				body: {
					name: 'Litigation',
					description: 'Case 4',
					filter_action: 'user.delete',
					filter_resource_type: '',
					filter_resource_id: '',
					filter_tenant_id: 'acme',
				},
			},
		]);
	});

	it('refuses a hold with no name', async () => {
		const { event, calls } = engine({ name: '  ' });
		const out = (await actions.createHold(event)) as Failure;
		expect(out.data.action).toBe('createHold');
		expect(out.data.error).toContain('Enter a name for the hold');
		expect(calls).toEqual([]);
	});

	it('relays a refusal and hides an outage', async () => {
		const refused = engine({ name: 'Litigation' }, { reply: json({ error: 'name is required', code: 'bad_request' }, 400) });
		expect(((await actions.createHold(refused.event)) as Failure).data.error).toBe('name is required');
		const down = engine({ name: 'Litigation' }, { reply: OUTAGE });
		expect(((await actions.createHold(down.event)) as Failure).data.error).toBe('Could not create the hold. Try again.');
	});
});

describe('releasing a legal hold', () => {
	it('deletes the named hold', async () => {
		const { event, calls } = engine({ id: 'h1' });
		expect(await actions.releaseHold(event)).toEqual({ released: 'h1' });
		expect(calls).toEqual([{ method: 'DELETE', path: '/api/admin/legal-holds/h1', body: undefined }]);
	});

	it('names nothing to release without a request', async () => {
		const { event, calls } = engine({});
		expect(((await actions.releaseHold(event)) as Failure).data).toEqual({ action: 'releaseHold', error: 'This form is missing its hold. Reload the page and try again.' });
		expect(calls).toEqual([]);
	});

	it('relays a refusal and hides an outage', async () => {
		// The plugin answers 404 for a hold that is already released.
		const refused = engine({ id: 'h1' }, { reply: json({ error: 'failed to delete legal hold', code: 'not_found' }, 404) });
		expect(((await actions.releaseHold(refused.event)) as Failure).data).toEqual({ action: 'releaseHold', error: 'failed to delete legal hold' });
		const down = engine({ id: 'h1' }, { reply: OUTAGE });
		expect(((await actions.releaseHold(down.event)) as Failure).data.error).toBe('Could not release the hold. Try again.');
	});
});

describe('enforcing retention now', () => {
	// The plugin counts per policy and sends no total, so the action adds the
	// policies' deletions up.
	it('reports the entries deleted across every policy the run processed', async () => {
		const run = {
			policies_processed: 2,
			results: [
				{ policy_id: 'p1', event_type: 'content.delete', resource_type: '', entries_archived: 0, entries_deleted: 9, elapsed: '4ms' },
				{ policy_id: 'p2', event_type: '', resource_type: 'entry', entries_archived: 3, entries_deleted: 3, elapsed: '2ms' },
			],
			elapsed: '7ms',
		};
		const { event, calls } = engine({}, { reply: json(run) });
		expect(await actions.enforce(event)).toEqual({ enforced: true, deleted: 12, policies: 2, archiveFailed: [] });
		expect(calls).toEqual([{ method: 'POST', path: '/api/admin/retention/enforce', body: {} }]);
	});

	it('reads a run with no policy to process as none deleted', async () => {
		const { event } = engine({}, { reply: json({ policies_processed: 0, results: null, elapsed: '1ms' }) });
		expect(await actions.enforce(event)).toEqual({ enforced: true, deleted: 0, policies: 0, archiveFailed: [] });
	});

	// The plugin answers 200 for a policy whose archive failed and deletes
	// nothing it covers, so the run names it rather than reporting a clean pass.
	it('names each policy whose archive failed', async () => {
		const run = {
			policies_processed: 2,
			results: [
				{ policy_id: 'p1', event_type: 'content.delete', resource_type: '', entries_deleted: 0, archive_failed: true, archive_error: 'no storage backend', elapsed: '1ms' },
				{ policy_id: 'p2', event_type: '', resource_type: 'entry', entries_deleted: 4, elapsed: '1ms' },
			],
		};
		const { event } = engine({}, { reply: json(run) });
		expect(await actions.enforce(event)).toMatchObject({ deleted: 4, archiveFailed: ['content.delete'] });
	});

	it('says a failed run failed, without the engine text', async () => {
		for (const reply of [OUTAGE, json({ error: 'retention enforcement failed' }, 500)]) {
			const { event } = engine({}, { reply });
			expect(((await actions.enforce(event)) as Failure).data).toEqual({ action: 'enforce', error: 'Could not enforce retention. Try again.' });
		}
	});
});
