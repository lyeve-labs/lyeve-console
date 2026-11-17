/**
 * The flow editor's assistant conversation. The page holds what the two
 * assistant actions answered and the tab renders it. A draft is never
 * written anywhere until it is accepted onto the canvas, and from there it
 * is saved like any other edit.
 */

import type { SubmitFunction } from '$app/forms';
import type { AssistantAnswer, AssistantDraft, AssistantStatus, AssistRefusal } from './assistant';

/** What the assistant actions answered, read off the page's form result. */
export interface AssistResult {
	assist?: AssistantDraft | null;
	explain?: AssistantAnswer | null;
	assistRefused?: AssistRefusal | null;
}

export class AssistantState {
	status = $state<AssistantStatus>('idle');
	message = $state('');
	busy = $state<'draft' | 'answer' | null>(null);
	prompt = $state('');
	draft = $state<AssistantDraft | null>(null);
	answer = $state<AssistantAnswer | null>(null);
	conversationId = $state('');
	/** What the hidden explain form asks about. Set, then submitted on the next tick. */
	explainTarget = $state<{ node_id: string; problem: string }>({ node_id: '', problem: '' });

	/** Brings the assistant tab into view. */
	readonly #show: () => void;

	constructor(show: () => void) {
		this.#show = show;
	}

	readonly submit: SubmitFunction = () => {
		this.busy = 'draft';
		this.status = 'idle';
		return async ({ update }) => {
			await update({ reset: false });
			this.busy = null;
		};
	};

	readonly explainSubmit: SubmitFunction = () => {
		this.busy = 'answer';
		this.status = 'idle';
		this.#show();
		return async ({ update }) => {
			await update({ reset: false });
			this.busy = null;
		};
	};

	discard(): void {
		this.draft = null;
		this.conversationId = '';
	}

	reset(): void {
		this.draft = null;
		this.answer = null;
		this.conversationId = '';
		this.status = 'idle';
	}

	/** Takes in what an assistant action answered, and shows the tab for it. */
	apply(result: AssistResult): void {
		if (result.assist) {
			this.draft = result.assist;
			this.status = 'idle';
			this.message = '';
			this.prompt = '';
			this.conversationId = result.assist.draft.conversation_id ?? this.conversationId;
			this.#show();
		}
		if (result.explain) {
			this.answer = result.explain;
			this.status = 'idle';
			this.message = '';
			this.conversationId = result.explain.answer.conversation_id ?? this.conversationId;
			this.#show();
		}
		if (result.assistRefused) {
			const r = result.assistRefused;
			this.status = r.state;
			this.message = 'message' in r ? r.message : '';
			this.#show();
		}
	}
}
