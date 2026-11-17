/**
 * What the editor and its server share about the assistant: the page the
 * off state names, and the reading of an action's answer into the tab's
 * state. Nothing here touches the network.
 */

import type { AssistAnswer, AssistDraft } from '#lib/api/assist.ts';

export const AI_OFF_HREF = '/admin/ai/settings';

export type AssistantStatus = 'idle' | 'locked' | 'off' | 'unavailable' | 'error';

/** Why the assistant did not answer, as the action reports it. */
export type AssistRefusal =
	| { state: 'locked' }
	| { state: 'off' }
	| { state: 'unavailable'; message: string }
	| { state: 'error'; message: string };

export interface AssistantDraft {
	prompt: string;
	draft: AssistDraft;
}

export interface AssistantAnswer {
	subject: string;
	answer: AssistAnswer;
}
