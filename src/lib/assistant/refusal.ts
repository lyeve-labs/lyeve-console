/**
 * Why the assistant did not answer, and the sentence the panel shows.
 *
 * The console's route reads the AI plugin's refusal and sends the panel a
 * kind, never the plugin's text. The three 403s carry one error code, so
 * their messages tell them apart. The panel words each kind for the reader's
 * role, because only an administrator can change what refused them.
 */

import { SESSION_ENDED } from '$lib/session';
import { outageFor } from '$lib/outage';

export type RefusalKind =
	| 'assistant_off'
	| 'no_cap'
	| 'api_key'
	| 'ai_off'
	| 'locked'
	| 'busy'
	| 'session'
	| 'outage'
	| 'failed';

/** The AI plugin's messages for its three 403s on the assistant route. */
const FORBIDDEN: Record<string, RefusalKind> = {
	'the assistant is switched off for this tenant': 'assistant_off',
	'the assistant needs a signed-in session, not an API key': 'api_key',
	'an administrator has to set a monthly budget on the AI provider before you can use the assistant': 'no_cap',
};

/** The kind for a refused request, from its status and its JSON body. */
export function refusalKind(status: number, body: unknown): RefusalKind {
	const message = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
	if (status === 401) return 'session';
	if (status === 402) return 'locked';
	if (status === 403) return (typeof message === 'string' && FORBIDDEN[message]) || 'failed';
	if (status === 404) return 'ai_off';
	if (status === 429) return 'busy';
	if (status >= 500) return 'outage';
	return 'failed';
}

/** The sentence for a kind. `administrator` is an admin or a super admin. */
export function refusalSentence(kind: RefusalKind, administrator: boolean): string {
	switch (kind) {
		case 'assistant_off':
			return administrator
				? 'The assistant is off for this tenant. Turn it on in AI settings.'
				: 'The assistant is off for this tenant. Ask an administrator to turn it on.';
		case 'no_cap':
			return 'The assistant needs a monthly budget on the AI provider. Ask an administrator to set one.';
		case 'api_key':
			return 'The assistant works only when you sign in, not with an API key.';
		case 'ai_off':
			return administrator ? 'AI is off for this tenant. Turn it on in AI settings.' : 'AI is off for this tenant.';
		case 'locked':
			return 'Your license does not include AI.';
		case 'busy':
			return 'Too many requests in a short time. Wait a moment, then try again.';
		case 'session':
			return SESSION_ENDED;
		case 'outage':
			return outageFor('the assistant did not answer');
		default:
			return 'Could not send your message. Try again.';
	}
}

/** Whether asking again can help, so the panel offers Try again. */
export function retryable(kind: RefusalKind): boolean {
	return kind === 'busy' || kind === 'outage' || kind === 'failed';
}
