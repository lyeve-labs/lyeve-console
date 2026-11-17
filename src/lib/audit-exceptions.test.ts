import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * pnpm-workspace.yaml lets the audit pass GHSA-3r8g-jcqq-3p5j, a denial of
 * service in the form data parser of SvelteKit's remote functions that only
 * 3.1.1 fixes. SvelteKit looks a remote function up in the build's table of
 * remote modules before it reads a request body, and the console declares
 * none, so the parser is never reached. These cases keep the exception true:
 * they fail once the console declares a remote function, and once SvelteKit
 * carries the fix, so the entry goes with its reason.
 */
const ADVISORY = 'GHSA-3r8g-jcqq-3p5j';
const skipped = readFileSync('pnpm-workspace.yaml', 'utf8').includes(ADVISORY);

/** Whether a version is 3.1.1 or later. */
function carriesTheFix(version: string): boolean {
	const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10));
	return major > 3 || (major === 3 && (minor > 1 || (minor === 1 && patch >= 1)));
}

describe('the audit exception for remote functions', () => {
	it('stands only while the console declares no remote function', () => {
		if (!skipped) return;
		expect(globSync(['src/**/*.remote.ts', 'src/**/*.remote.js'])).toEqual([]);
		expect(readFileSync('svelte.config.js', 'utf8')).not.toMatch(/remoteFunctions/);
	});

	it('goes once the installed SvelteKit carries the fix', () => {
		const kit = JSON.parse(readFileSync('node_modules/@sveltejs/kit/package.json', 'utf8')) as { version: string };
		expect(skipped && carriesTheFix(kit.version)).toBe(false);
	});

	it.each([
		['2.70.3', false],
		['3.1.0', false],
		['3.1.1', true],
		['3.2.0', true],
		['4.0.0', true],
	])('reads %s as carrying the fix: %s', (version, fixed) => {
		expect(carriesTheFix(version)).toBe(fixed);
	});
});
