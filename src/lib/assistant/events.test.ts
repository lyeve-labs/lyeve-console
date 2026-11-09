import { describe, expect, it } from 'vitest';
import { EventReader } from './events';

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe('EventReader', () => {
	it('reads every kind the plugin sends, across chunks split anywhere', () => {
		const stream =
			frame('step', { id: 'c1', title: 'Search the API', status: 'running' }) +
			frame('message', { text: 'Two new fields cover this.' }) +
			frame('plan', { entries: [{ status: 'now', title: 'Add the fields', detail: 'The proposal below' }, { status: 'next', title: 'Fill them' }] }) +
			frame('proposal', { id: 'c2', kind: 'api', operation_id: 'putSchema', method: 'put', path: '/api/admin/schemas/articles', query: { dry_run: true }, body: { name: 'articles' }, effect: 'write' }) +
			frame('proposal', { id: 'c3', kind: 'form', values: [{ name: 'title', value: 'Hello', reason: 'From the body' }] }) +
			frame('usage', { model: 'm', tokens_in: 10, tokens_out: 5, cost: '0.0010' }) +
			frame('done', { conversation_id: '7f0c4f53-8e0a-4a3c-9df4-6c2c2f1e3a10' });
		const reader = new EventReader();
		const events = [];
		for (let i = 0; i < stream.length; i += 7) events.push(...reader.push(stream.slice(i, i + 7)));
		expect(events.map((e) => e.type)).toEqual(['step', 'message', 'plan', 'proposal', 'proposal', 'usage', 'done']);
		expect(events[3]).toEqual({
			type: 'proposal',
			proposal: { id: 'c2', kind: 'api', operation_id: 'putSchema', method: 'PUT', path: '/api/admin/schemas/articles', query: { dry_run: true }, body: { name: 'articles' }, effect: 'write' },
		});
		expect(events[4]).toEqual({ type: 'proposal', proposal: { id: 'c3', kind: 'form', values: [{ name: 'title', value: 'Hello', reason: 'From the body' }] } });
		expect(events[6]).toEqual({ type: 'done', conversationId: '7f0c4f53-8e0a-4a3c-9df4-6c2c2f1e3a10' });
	});

	it('reads CRLF line ends and data spread over several lines', () => {
		const events = new EventReader().push('event: message\r\ndata: {"text":\r\ndata: "hi"}\r\n\r\n');
		expect(events).toEqual([{ type: 'message', text: 'hi' }]);
	});

	it('drops an event it does not know and a block that is not JSON', () => {
		expect(new EventReader().push(frame('mode', { x: 1 }) + 'event: message\ndata: not json\n\n')).toEqual([]);
	});

	it('treats an unstated effect as a change, never as a read', () => {
		const [event] = new EventReader().push(frame('proposal', { id: 'c', kind: 'api', method: 'DELETE', path: '/api/admin/x' }));
		expect(event).toMatchObject({ proposal: { effect: 'write' } });
	});
});
