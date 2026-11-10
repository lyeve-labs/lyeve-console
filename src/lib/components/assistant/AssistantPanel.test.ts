// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import AssistantPanel from './AssistantPanel.svelte';
import { AssistantSession } from '$lib/assistant/session.svelte';
import { fakeFetch, frame, refusedWith, sse } from '$lib/assistant/test-support';

afterEach(cleanup);

const page = () => ({ path: '/admin', title: 'Dashboard' });

async function answered(administrator: boolean, ...answer: (() => Response)[]) {
	const session = new AssistantSession({ fetch: fakeFetch(...answer).fn });
	const view = render(AssistantPanel, { props: { session, administrator, page } });
	await session.ask('Help', page());
	flushSync();
	await tick();
	return { session, ...view };
}

describe('AssistantPanel', () => {
	it('opens on its empty state', () => {
		render(AssistantPanel, { props: { session: new AssistantSession(), administrator: false, page } });
		expect(screen.getByText('Ask the assistant')).toBeTruthy();
		expect(screen.getByLabelText('Message')).toBeTruthy();
	});

	it('draws a reply holding Markdown, HTML and an image link as plain text', async () => {
		const text = '# Done\n**Saved** [docs](https://example.com) ![x](https://tracker.example/p.png) <img src="https://tracker.example/q.png">';
		const { container } = await answered(false, sse(frame('message', { text }), frame('done', {})));
		const reply = container.querySelector('[data-turn="message"]')!;
		expect(reply.textContent).toBe(text);
		expect(container.querySelector('[data-testid="assistant-panel"] img')).toBeNull();
		expect(reply.querySelector('a, strong, h1')).toBeNull();
	});

	it('shows a proposed request in full before it runs', async () => {
		const { container } = await answered(
			false,
			sse(
				frame('proposal', {
					id: 'c1',
					kind: 'api',
					operation_id: 'updateWebhook',
					method: 'patch',
					path: '/api/admin/webhooks/w1',
					query: { dry_run: true },
					body: { url: 'https://hooks.example/in', events: ['content.created'] },
					effect: 'outbound',
				}),
				frame('done', {}),
			),
		);
		const card = container.querySelector('[data-turn="proposal"]') as HTMLElement;
		expect(within(card).getByText('PATCH')).toBeTruthy();
		expect(within(card).getByTestId('proposal-path').textContent).toBe('/api/admin/webhooks/w1');
		expect(JSON.parse(within(card).getByTestId('proposal-query').textContent!)).toEqual({ dry_run: true });
		expect(JSON.parse(within(card).getByTestId('proposal-body').textContent!)).toEqual({
			url: 'https://hooks.example/in',
			events: ['content.created'],
		});
		expect(within(card).getByText('Sends data out of the engine')).toBeTruthy();
		expect(within(card).getByRole('button', { name: 'Run' })).toBeTruthy();
		expect(within(card).getByRole('button', { name: 'Reject' })).toBeTruthy();
	});

	it('shows the plan as a to-do list with each status', async () => {
		await answered(
			false,
			sse(
				frame('plan', {
					entries: [
						{ status: 'done', title: 'Read the content type' },
						{ status: 'now', title: 'Add the author field' },
						{ status: 'next', title: 'Fill the first entry' },
					],
				}),
				frame('done', {}),
			),
		);
		const plan = screen.getByTestId('assistant-plan');
		const items = within(plan).getAllByRole('listitem').map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
		expect(items).toEqual(['Read the content type Done', 'Add the author field Now', 'Fill the first entry Next']);
	});

	it.each([
		['assistant_off', true, 'The assistant is off for this tenant. Turn it on in AI settings.'],
		['assistant_off', false, 'The assistant is off for this tenant. Ask an administrator to turn it on.'],
		['no_cap', true, 'The assistant needs a monthly budget on the AI provider. Ask an administrator to set one.'],
		['api_key', false, 'The assistant works only when you sign in, not with an API key.'],
	] as const)('draws the %s refusal as a sentence (administrator %s)', async (kind, administrator, sentence) => {
		await answered(administrator, refusedWith(kind));
		expect(screen.getByTestId('assistant-refusal').textContent).toBe(sentence);
		expect(screen.queryByText('Ask the assistant')).toBeNull();
		expect(screen.queryByRole('link', { name: 'Open AI settings' }) !== null).toBe(administrator && kind === 'assistant_off');
	});

	it('offers to ask again after an answer that broke off', async () => {
		await answered(false, sse(frame('error', { message: 'The AI provider did not answer. Try again in a moment.' })));
		expect(screen.getByText('The AI provider did not answer. Try again in a moment.')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
	});
});
