import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * pnpm-workspace.yaml lets the audit pass GHSA-fc5q-39xc-vjpf, a ReDoS in
 * picomatch through 4.0.7 that needs an attacker to write the glob pattern.
 * picomatch runs only in the build and test tooling, whose patterns come from
 * the repository's configuration, and the server bundle inlines only what the
 * shipped source imports. These cases keep the exception true: they fail once
 * shipped source imports a glob matcher, and once a picomatch above 4.0.7 is
 * installed, so the entry goes with its reason.
 */
const ADVISORY = 'GHSA-fc5q-39xc-vjpf';
const skipped = readFileSync('pnpm-workspace.yaml', 'utf8').includes(ADVISORY);

const GLOB_MATCHER = /from\s+['"](picomatch|micromatch|tinyglobby|fdir|chokidar|vite)['"/]/;

/** Whether a version is above 4.0.7, the last one the advisory covers. */
function carriesTheFix(version: string): boolean {
	const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10));
	return major > 4 || (major === 4 && (minor > 0 || patch > 7));
}

describe('the audit exception for picomatch', () => {
	it('stands only while no shipped source imports a glob matcher', () => {
		if (!skipped) return;
		const shipped = globSync('src/**/*.{ts,js,svelte}').filter((file) => !/\.(test|spec)\.|test-support/.test(file));
		expect(shipped.length).toBeGreaterThan(0);
		expect(shipped.filter((file) => GLOB_MATCHER.test(readFileSync(file, 'utf8')))).toEqual([]);
	});

	it('goes once a picomatch above 4.0.7 is installed', () => {
		const versions = [...readFileSync('pnpm-lock.yaml', 'utf8').matchAll(/^ {2}picomatch@(\d+\.\d+\.\d+):$/gm)].map(
			(match) => match[1],
		);
		expect(versions.length).toBeGreaterThan(0);
		expect(skipped && versions.some(carriesTheFix)).toBe(false);
	});

	it.each([
		['2.3.1', false],
		['4.0.7', false],
		['4.0.8', true],
		['4.1.0', true],
		['5.0.0', true],
	])('reads %s as carrying the fix: %s', (version, fixed) => {
		expect(carriesTheFix(version)).toBe(fixed);
	});
});
