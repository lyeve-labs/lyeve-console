import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/authz', () => ({ authedHeaders: () => ({ Authorization: 'Bearer tok' }) }));

import { setEntryRelations, setRelations, RelationWriteError } from './content-relations';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** An event whose fetch answers the read with `held` and each write with `write(method)`. */
function eventWith(held: { id: string; target_id: string }[], write: (method: string) => number) {
	const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		if (method === 'GET') return json({ data: held });
		const status = write(method);
		return status === 204 ? new Response(null, { status }) : json({ error: 'refused' }, status);
	});
	return { event: { fetch, cookies: { get: () => 'tok' } } as never, fetch };
}

describe('reconciling a many_to_many field', () => {
	it('reports a link the plugin refused to add', async () => {
		const { event } = eventWith([], () => 403);

		await expect(setRelations(event, 'e1', 'tags', ['t1', 't2'])).rejects.toThrow(
			'Could not add 2 links in tags.',
		);
	});

	it('reports a link the plugin refused to remove', async () => {
		const { event } = eventWith([{ id: 'r1', target_id: 't1' }], () => 409);

		await expect(setRelations(event, 'e1', 'tags', [])).rejects.toBeInstanceOf(RelationWriteError);
	});

	it('answers quietly when every write landed', async () => {
		const { event } = eventWith([{ id: 'r1', target_id: 't1' }], (method) => (method === 'POST' ? 201 : 204));

		await expect(setRelations(event, 'e1', 'tags', ['t2'])).resolves.toBeUndefined();
	});

	it('names each field that did not save and keeps writing the others', async () => {
		const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
			if ((init?.method ?? 'GET') === 'GET') return json({ data: [] });
			return String(init?.body).includes('authors') ? json({ error: 'no' }, 503) : json({}, 201);
		});
		const event = { fetch, cookies: { get: () => 'tok' } } as never;

		const failed = await setEntryRelations(event, 'e1', { tags: ['t1'], authors: ['a1'] });

		expect(failed).toBe('Could not add 1 link in authors.');
		expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
	});
});
