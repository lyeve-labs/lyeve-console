// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { activeAssistForm } from '@lyeve-labs/ui-kit';
import type { FieldType, SchemaField } from '@lyeve-labs/client';
import ContentForm from '$lib/components/ContentForm.svelte';
import { ASK_URL, AssistantSession, RUN_URL } from './session.svelte';
import { fakeFetch, frame, refusedWith, sse } from './test-support';

afterEach(cleanup);

const page = { path: '/admin/content/articles/new', title: 'New entry' };
const field = (name: string, field_type: FieldType, extra: Partial<SchemaField> = {}): SchemaField => ({
	name,
	field_type,
	required: false,
	unique: false,
	indexed: false,
	...extra,
});

async function settle() {
	flushSync();
	await tick();
	flushSync();
}

describe('AssistantSession', () => {
	it('sends the page and the open form, leaving a No AI field without its value', async () => {
		const formValues = $state({ title: 'Hello', notes: 'Call the patient on Monday.' });
		render(ContentForm, {
			props: { label: 'New Articles entry', fields: [field('title', 'text', { help_text: 'The headline.' }), field('notes', 'text', { no_ai: true })], formValues },
		});
		await settle();
		const { fn, sent } = fakeFetch(sse(frame('done', { conversation_id: '' })));
		const session = new AssistantSession({ fetch: fn, form: activeAssistForm });
		await session.ask('Write a title', page);
		expect(sent[0].url).toBe(ASK_URL);
		expect(sent[0].body).toEqual({
			prompt: 'Write a title',
			page,
			form: {
				label: 'New Articles entry',
				fields: [
					{ name: 'title', label: 'title', help: 'The headline.', kind: 'text', value: 'Hello' },
					{ label: 'notes', kind: 'text', withheld: true },
				],
			},
		});
		expect(JSON.stringify(sent[0].body)).not.toContain('Call the patient');
	});

	it('reads the stream into turns, the plan, the steps and the usage, and continues the conversation', async () => {
		const id = '7f0c4f53-8e0a-4a3c-9df4-6c2c2f1e3a10';
		const { fn, sent } = fakeFetch(
			sse(
				frame('step', { id: 'c1', title: 'Search the API', status: 'running' }),
				frame('step', { id: 'c1', title: 'Search the API', status: 'done' }),
				frame('plan', { entries: [{ status: 'now', title: 'Add the field' }] }),
				frame('message', { text: 'Here is the change.' }),
				frame('proposal', { id: 'c2', kind: 'api', operation_id: 'putSchema', method: 'PUT', path: '/api/admin/schemas/articles', body: { a: 1 }, effect: 'write' }),
				frame('usage', { model: 'm', tokens_in: 3, tokens_out: 4, cost: '0.01' }),
				frame('done', { conversation_id: id }),
			),
			sse(frame('done', { conversation_id: id })),
		);
		const session = new AssistantSession({ fetch: fn });
		await session.ask('Add an author field', page);
		expect(session.status).toBe('idle');
		expect(session.turns.map((t) => t.kind)).toEqual(['person', 'message', 'proposal']);
		expect(session.steps).toEqual([{ id: 'c1', title: 'Search the API', status: 'done' }]);
		expect(session.plan).toEqual([{ status: 'now', title: 'Add the field' }]);
		expect(session.usage?.tokens_out).toBe(4);
		await session.ask('And make it required', page);
		expect(sent[1].body.conversation_id).toBe(id);
	});

	it('fills the open form with a form proposal, as suggestions the person reviews', async () => {
		const formValues = $state<Record<string, unknown>>({ title: '' });
		render(ContentForm, { props: { label: 'New Articles entry', fields: [field('title', 'text')], formValues } });
		await settle();
		const { fn } = fakeFetch(sse(frame('proposal', { id: 'c1', kind: 'form', values: [{ name: 'title', value: 'Five habits' }] }), frame('done', {})));
		const session = new AssistantSession({ fetch: fn, form: activeAssistForm });
		await session.ask('Write a title', page);
		await settle();
		expect(formValues.title).toBe('Five habits');
		expect(activeAssistForm()?.pending().map((p) => p.name)).toEqual(['title']);
		expect(session.turns[1]).toMatchObject({ kind: 'form', form: 'New Articles entry', applied: ['title'], skipped: [] });
	});

	it('records a refusal by its kind, and an offline browser as offline', async () => {
		const off = new AssistantSession({ fetch: fakeFetch(refusedWith('assistant_off')).fn });
		await off.ask('Hi', page);
		expect(off.status).toBe('refused');
		expect(off.refusal).toBe('assistant_off');
		const offline = new AssistantSession({ fetch: fakeFetch().fn, online: () => false });
		await offline.ask('Hi', page);
		expect(offline.refusal).toBe('offline');
	});

	it('marks an answer that ends in an error as failed', async () => {
		const { fn } = fakeFetch(sse(frame('error', { message: 'Your AI budget for this billing period is spent.' })));
		const session = new AssistantSession({ fetch: fn });
		await session.ask('Hi', page);
		expect(session.status).toBe('failed');
		expect(session.turns.at(-1)).toMatchObject({ kind: 'failure', text: 'Your AI budget for this billing period is spent.' });
	});

	it('stops an answer the person stops', async () => {
		let release!: () => void;
		const fn = (async (_url: string, init?: RequestInit) =>
			new Promise<Response>((_, reject) => {
				release = () => reject(new DOMException('aborted', 'AbortError'));
				init?.signal?.addEventListener('abort', () => release());
			})) as unknown as typeof fetch;
		const session = new AssistantSession({ fetch: fn });
		const asking = session.ask('Hi', page);
		expect(session.status).toBe('working');
		session.stop();
		await asking;
		expect(session.status).toBe('stopped');
	});

	it('runs a proposal only when the person runs it, and records a rejection without sending anything', async () => {
		const proposal = frame('proposal', { id: 'c', kind: 'api', operation_id: 'del', method: 'DELETE', path: '/api/admin/webhooks/w1', effect: 'delete' });
		const { fn, sent } = fakeFetch(
			sse(proposal, proposal, frame('done', {})),
			() => new Response(JSON.stringify({ ok: true, status: 204 }), { status: 200 }),
		);
		const session = new AssistantSession({ fetch: fn });
		await session.ask('Delete the old webhooks', page);
		const [first, second] = session.turns.filter((t) => t.kind === 'proposal');
		expect(sent).toHaveLength(1);
		session.reject(second.id);
		await session.run(first.id);
		expect(sent).toHaveLength(2);
		expect(sent[1]).toEqual({ url: RUN_URL, body: { method: 'DELETE', path: '/api/admin/webhooks/w1' } });
		expect(session.turns.filter((t) => t.kind === 'proposal').map((t) => (t.kind === 'proposal' ? t.state : ''))).toEqual(['done', 'rejected']);
	});
});
