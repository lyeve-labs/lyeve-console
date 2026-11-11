import { describe, expect, it } from 'vitest';
import { refusalKind, refusalSentence, retryable } from './refusal';

const refused = (error: string) => ({ error, code: 'forbidden' });

describe('assistant refusals', () => {
	it('tells the three 403s apart by the message the plugin sends', () => {
		expect(refusalKind(403, refused('the assistant is switched off for this tenant'))).toBe('assistant_off');
		expect(refusalKind(403, refused('the assistant needs a signed-in session, not an API key'))).toBe('api_key');
		expect(
			refusalKind(403, refused('an administrator has to set a monthly budget on the AI provider before you can use the assistant')),
		).toBe('no_cap');
		expect(refusalKind(403, refused('insufficient permissions'))).toBe('failed');
	});

	it('reads the other statuses', () => {
		expect(refusalKind(401, null)).toBe('session');
		expect(refusalKind(402, null)).toBe('locked');
		expect(refusalKind(404, null)).toBe('ai_off');
		expect(refusalKind(429, null)).toBe('busy');
		expect(refusalKind(503, null)).toBe('outage');
		expect(refusalKind(502, '<html>Bad Gateway</html>')).toBe('outage');
		expect(refusalKind(400, refused('prompt is required'))).toBe('failed');
	});

	it('words each refusal for the reader, sending an administrator to the setting', () => {
		expect(refusalSentence('assistant_off', true)).toBe('The assistant is off for this tenant. Turn it on in AI settings.');
		expect(refusalSentence('assistant_off', false)).toBe('The assistant is off for this tenant. Ask an administrator to turn it on.');
		expect(refusalSentence('no_cap', false)).toBe('The assistant needs a monthly budget on the AI provider. Ask an administrator to set one.');
		expect(refusalSentence('api_key', false)).toBe('The assistant works only when you sign in, not with an API key.');
		expect(refusalSentence('outage', false)).toBe('The engine is unavailable, so the assistant did not answer. Try again in a moment.');
	});

	it('offers Try again only where asking again can help', () => {
		expect(['assistant_off', 'no_cap', 'api_key', 'ai_off', 'locked', 'session'].some((k) => retryable(k as never))).toBe(false);
		expect(retryable('outage')).toBe(true);
	});
});
