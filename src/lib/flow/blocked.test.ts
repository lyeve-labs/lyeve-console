import { describe, expect, it } from 'vitest';
import { BLOCKED_MESSAGE, BLOCKED_MESSAGE_BEFORE, BLOCKED_TEXT, blockedText, isBlockedMessage, missingPlugin, missingPluginOf } from './blocked';
import { blockedRunError, missingTypeErrors } from './fixtures';

describe('blocked', () => {
	it('recognizes the run refusal by its exact message', () => {
		expect(blockedRunError.error).toBe(BLOCKED_MESSAGE);
		expect(isBlockedMessage(BLOCKED_MESSAGE)).toBe(true);
		expect(isBlockedMessage(` ${BLOCKED_MESSAGE}\n`)).toBe(true);
		expect(isBlockedMessage(BLOCKED_MESSAGE_BEFORE), 'an engine released before the rename').toBe(true);
		expect(isBlockedMessage('flow is not published')).toBe(false);
		expect(isBlockedMessage(null)).toBe(false);
	});

	it('reads the plugin out of the validation message and nothing out of any other', () => {
		expect(missingPlugin(missingTypeErrors[0].message)).toBe('email');
		expect(missingPlugin('unknown node type "data.nope"')).toBeNull();
		expect(missingPluginOf(missingTypeErrors)).toBe('email');
		expect(missingPluginOf([{ path: '/settings/timeout', message: 'not a duration' }])).toBeNull();
	});

	it('names the plugin in the sentence only when it is known', () => {
		expect(blockedText()).toBe(BLOCKED_TEXT);
		expect(blockedText('email')).toBe(`${BLOCKED_TEXT} It needs the email plugin, which is not started.`);
	});
});
