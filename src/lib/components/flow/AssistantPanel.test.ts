// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import AssistantPanel from './AssistantPanel.svelte';
import type { AssistantAnswer, AssistantDraft } from '#lib/flow/assistant.ts';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function setup(props: Record<string, unknown> = {}) {
	const handlers = {
		onsubmit: vi.fn(),
		onaccept: vi.fn(),
		ondiscard: vi.fn(),
		onclose: vi.fn(),
		onreset: vi.fn(),
		onproblem: vi.fn(),
	};
	const result = render(AssistantPanel, {
		props: { status: 'idle', definitionJSON: '{"nodes":[]}', ...handlers, ...props } as never,
	});
	const form = result.container.querySelector('form') as HTMLFormElement;
	const send = result.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
	return { ...result, ...handlers, form, send };
}

function draft(over: Partial<AssistantDraft['draft']> = {}): AssistantDraft {
	return {
		prompt: 'Email me on new orders',
		// The AI plugin's flow assist answer, field for field.
		draft: {
			definition: { nodes: [] } as never,
			yaml: 'nodes: []',
			problems: [],
			conversation_id: 'c-1',
			model: 'small-model',
			tokens: 1234,
			cost: '0.001200',
			...over,
		},
	};
}

describe('AssistantPanel', () => {
	it('posts the prompt with the flow on the canvas and the conversation it continues', () => {
		const { form } = setup({ prompt: 'Add a retry', conversationId: 'c-7' });
		expect(form.getAttribute('action')).toBe('?/assist');
		const sent = new FormData(form);
		expect(sent.get('prompt')).toBe('Add a retry');
		expect(sent.get('definition')).toBe('{"nodes":[]}');
		expect(sent.get('conversation_id')).toBe('c-7');
	});

	it('offers nothing to send until a prompt is typed', () => {
		expect(setup().send.disabled).toBe(true);
		cleanup();
		expect(setup({ prompt: 'Draft a flow' }).send.disabled).toBe(false);
	});

	it('sends nothing while a call is in flight, and says what it waits for', () => {
		const { send, getByRole } = setup({ prompt: 'Draft a flow', busy: 'answer' });
		expect(send.disabled).toBe(true);
		expect(getByRole('status').textContent).toContain('Asking the assistant');
	});

	it('sends on Ctrl+Enter from the prompt', async () => {
		const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
		const { getByLabelText } = setup({ prompt: 'Draft a flow' });
		await fireEvent.keyDown(getByLabelText('Describe the flow'), { key: 'Enter', ctrlKey: true });
		expect(submit).toHaveBeenCalledTimes(1);
	});

	it('locks the prompt and points to the AI plugin when the tenant has no license for it', () => {
		const { getByLabelText, getByText } = setup({ status: 'locked', prompt: 'Draft a flow' });
		expect((getByLabelText('Describe the flow') as HTMLTextAreaElement).disabled).toBe(true);
		expect(getByText(/part of the AI plugin/)).toBeTruthy();
	});

	it('says where to turn the assistant on when the tenant switched it off', () => {
		const { getByRole } = setup({ status: 'off' });
		expect(getByRole('link', { name: 'AI settings' }).getAttribute('href')).toBe('/admin/ai/settings');
	});

	it('shows the sentence of a failed call', () => {
		const { getByText } = setup({ status: 'error', message: 'The provider timed out.' });
		expect(getByText('The provider timed out.')).toBeTruthy();
	});

	it('accepts a draft the validator passes, and names the model and tokens it used', async () => {
		const { getByRole, getByText, onaccept } = setup({ draft: draft() });
		expect(getByText('This draft has no problems.')).toBeTruthy();
		expect(getByText(/^small-model, 1,234 tokens/)).toBeTruthy();
		await fireEvent.click(getByRole('button', { name: /accept/i }));
		expect(onaccept).toHaveBeenCalledTimes(1);
	});

	it('withholds Accept from a draft with problems and says why', () => {
		const problems = [{ node_id: 'send', path: '.config.to', message: 'to is required' }];
		const { getByRole, getByText } = setup({ draft: draft({ problems }) });
		expect((getByRole('button', { name: /accept/i }) as HTMLButtonElement).disabled).toBe(true);
		expect(getByText(/The draft has 1 problem\. Ask the assistant to fix it/)).toBeTruthy();
	});

	it('withholds Accept from a draft with no definition', () => {
		const { getByRole, getByText } = setup({ draft: draft({ definition: null }) });
		expect((getByRole('button', { name: /accept/i }) as HTMLButtonElement).disabled).toBe(true);
		expect(getByText('The assistant did not return a flow. Ask again.')).toBeTruthy();
	});

	it('hands a clicked problem to the page', async () => {
		const problem = { node_id: 'send', path: '.config.to', message: 'to is required' };
		const { getByRole, onproblem } = setup({ draft: draft({ problems: [problem] }) });
		await fireEvent.click(getByRole('button', { name: /to is required/ }));
		expect(onproblem).toHaveBeenCalledWith(problem);
	});

	it('discards a draft and starts a conversation over', async () => {
		const { getByRole, ondiscard, onreset } = setup({ draft: draft(), conversationId: 'c-7' });
		await fireEvent.click(getByRole('button', { name: /discard/i }));
		await fireEvent.click(getByRole('button', { name: 'Start over' }));
		expect(ondiscard).toHaveBeenCalledTimes(1);
		expect(onreset).toHaveBeenCalledTimes(1);
	});

	it('shows the cost the plugin sends as a decimal string', () => {
		const { getByText } = setup({ draft: draft() });
		expect(getByText('small-model, 1,234 tokens, $0.0012')).toBeTruthy();
	});

	it('shows no cost when the cost does not parse', () => {
		for (const cost of ['', 'n/a', '-1']) {
			const { getByText } = setup({ draft: draft({ cost }) });
			expect(getByText('small-model, 1,234 tokens')).toBeTruthy();
			cleanup();
		}
	});

	it('shows an answer about its subject and closes it', async () => {
		const answer: AssistantAnswer = { subject: 'send-email', answer: { model: 'm', tokens: 10, cost: '0', answer: 'It sends **mail**.' } };
		const { getByRole, getByText, onclose } = setup({ answer });
		expect(getByText('send-email')).toBeTruthy();
		expect(getByText('mail').tagName).toBe('STRONG');
		await fireEvent.click(getByRole('button', { name: 'Close the answer' }));
		expect(onclose).toHaveBeenCalledTimes(1);
	});
});
