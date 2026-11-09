import { describe, expect, it } from 'vitest';
import { byType, inApplyOrder, shortPattern, type AccessEntry, type RedactionRule } from './pii-mask';

function rule(name: string, priority: number): RedactionRule {
	return { name, priority, pattern: '.*', replacement: '[redacted]' };
}

function look(type: string, id = type): AccessEntry {
	return {
		id,
		viewer_user_id: 'u1',
		pii_type: type,
		accessed_at: '2026-09-22T10:00:00Z',
	};
}

describe('inApplyOrder', () => {
	// Lower priority runs first and decides which rule wins where two
	// patterns match the same text, so drawing the route's own order would
	// suggest the wrong precedence.
	it('puts the rule that runs first at the top', () => {
		expect(inApplyOrder([rule('card', 20), rule('email', 5)]).map((r) => r.name)).toEqual([
			'email',
			'card',
		]);
	});

	it('breaks a tie by name so equal rules hold their place', () => {
		expect(inApplyOrder([rule('b', 5), rule('a', 5)]).map((r) => r.name)).toEqual(['a', 'b']);
	});

	it('does not reorder the array it was given', () => {
		const input = [rule('card', 20), rule('email', 5)];
		inApplyOrder(input);
		expect(input.map((r) => r.name)).toEqual(['card', 'email']);
	});
});

describe('byType', () => {
	// The log is one row per look, so rows alone answer "when" and never
	// "what is being read most".
	it('counts the looks per kind, busiest first', () => {
		const entries = [look('email', '1'), look('phone', '2'), look('email', '3')];
		expect(byType(entries)).toEqual([
			{ type: 'email', looks: 2 },
			{ type: 'phone', looks: 1 },
		]);
	});

	it('breaks a tie by name', () => {
		expect(byType([look('phone', '1'), look('email', '2')]).map((t) => t.type)).toEqual([
			'email',
			'phone',
		]);
	});

	it('is empty for an empty log', () => {
		expect(byType([])).toEqual([]);
	});
});

describe('shortPattern', () => {
	it('leaves a pattern that fits alone', () => {
		expect(shortPattern('[0-9]+')).toBe('[0-9]+');
	});

	it('truncates to the width it was given, ellipsis included', () => {
		expect(shortPattern('x'.repeat(200), 20)).toHaveLength(20);
	});
});
