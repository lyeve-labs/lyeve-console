import { describe, expect, it } from 'vitest';
import { checked } from './checkbox';

function form(entries: Record<string, string>): FormData {
	const data = new FormData();
	for (const [k, v] of Object.entries(entries)) data.set(k, v);
	return data;
}

describe('checked', () => {
	it('reads a ticked box by its default value or an explicit true', () => {
		expect(checked(form({ a: 'on' }), 'a')).toBe(true);
		expect(checked(form({ a: 'true' }), 'a')).toBe(true);
	});

	it('reads an absent box and any other value as unticked', () => {
		expect(checked(form({}), 'a')).toBe(false);
		expect(checked(form({ a: 'false' }), 'a')).toBe(false);
		expect(checked(form({ a: 'off' }), 'a')).toBe(false);
	});
});
