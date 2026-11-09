import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// SvelteKit serves this file when it cannot render an error page of the
// console's own, such as when the root layout itself failed. Without it the
// reader gets the framework's bare page, with none of the console's words.
const page = (() => {
	try {
		return readFileSync(new URL('./error.html', import.meta.url), 'utf8');
	} catch {
		return '';
	}
})();

describe('the last-resort error page', () => {
	it("is the console's own page, with the status and a way to try again", () => {
		expect(page).toContain('%sveltekit.status%');
		expect(page).toContain('Could not open this page');
		expect(page).toMatch(/<a [^>]*href=""[^>]*>Try again<\/a>/);
		expect(page).toMatch(/<a [^>]*href="\/admin"[^>]*>/);
	});

	// A 5xx gets the console's own sentence, never the text of the failure.
	it('shows no error text from the server', () => {
		expect(page).not.toContain('%sveltekit.error.message%');
	});

	// The page is served without a nonce, and the console's policy allows no
	// script that does not carry one.
	it('runs no script', () => {
		expect(page).not.toMatch(/<script/i);
	});
});
