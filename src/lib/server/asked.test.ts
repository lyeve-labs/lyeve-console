import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { asked } from './asked';
import { CONFIRM_FIELD, CONFIRMED } from '$lib/confirmation';

const QUESTION = { question: 'Delete this webhook?', detail: 'This cannot be undone.', label: 'Delete' };

/** A native or enhanced post to the page's delete action. */
function post(fields: Record<string, string>): RequestEvent {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) body.set(name, value);
	const url = new URL('http://admin.test/admin/webhooks?/delete');
	return { request: new Request(url, { method: 'POST', body }), url } as unknown as RequestEvent;
}

describe('asked', () => {
	it('runs nothing on a post without the confirmation and answers the question', async () => {
		const action = vi.fn(async () => undefined);
		const answer = await asked(QUESTION, action)(post({ id: 'wh-1' }));

		expect(action).not.toHaveBeenCalled();
		expect(answer).toEqual({
			unconfirmed: { ...QUESTION, action: '/admin/webhooks?/delete', fields: [['id', 'wh-1']] },
		});
	});

	it('runs the action on a confirmed post, which still reads the body itself', async () => {
		const action = vi.fn(async (event: RequestEvent) => {
			const form = await event.request.formData();
			return { deleted: form.get('id') };
		});
		const answer = await asked(QUESTION, action)(post({ id: 'wh-1', [CONFIRM_FIELD]: CONFIRMED }));

		expect(action).toHaveBeenCalledOnce();
		expect(answer).toEqual({ deleted: 'wh-1' });
	});

	it('takes no other value as the confirmation', async () => {
		const action = vi.fn(async () => undefined);
		const answer = await asked(QUESTION, action)(post({ id: 'wh-1', [CONFIRM_FIELD]: 'true' }));

		expect(action).not.toHaveBeenCalled();
		expect(answer).toMatchObject({ unconfirmed: { fields: [['id', 'wh-1']] } });
	});

	it('refuses an unconfirmed post holding a file, which the banner cannot post again', async () => {
		const body = new FormData();
		body.set('id', 'wh-1');
		body.set('upload', new File(['x'], 'x.txt'));
		const url = new URL('http://admin.test/admin/webhooks?/delete');
		const event = { request: new Request(url, { method: 'POST', body }), url } as unknown as RequestEvent;
		const action = vi.fn(async () => undefined);

		await expect(asked(QUESTION, action)(event)).rejects.toMatchObject({ status: 400 });
		expect(action).not.toHaveBeenCalled();
	});

	it('asks only for the posts its condition picks', async () => {
		const action = vi.fn(async () => 'moved');
		const stop = asked(QUESTION, action, (form) => form.get('move') === 'stop');

		expect(await stop(post({ id: 'ex-1', move: 'pause' }))).toBe('moved');
		expect(await stop(post({ id: 'ex-1', move: 'stop' }))).toMatchObject({ unconfirmed: { fields: [['id', 'ex-1'], ['move', 'stop']] } });
		expect(action).toHaveBeenCalledOnce();
	});
});
