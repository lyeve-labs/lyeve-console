import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The kit draws every focus ring, focus outline and focused field border in
// its focus color, which follows a tenant's accent. A focus indicator written
// in brand here draws a second, brighter ring beside the kit's.
const BRAND_FOCUS = /(?:focus(?:-visible|-within)?|has-\[[^\]\s]*:focus(?:-visible)?\])\S*:(?:ring|outline|border)-brand(?![\w-])/;

// Resolved from this file, so the scan reads the same tree wherever the suite
// starts.
const ROOT = join(import.meta.dirname, '..', '..');

// The visual editors are a separate package placed here for some builds, with
// checks of their own. Only the seam modules name where they sit.
const EDITORS = `${['src', 'lib', 'canvas', 'editors'].join('/')}/`;

describe('focus color', () => {
	it('tells a brand focus ring from a focus ring and a brand selection', () => {
		expect(BRAND_FOCUS.test('focus-visible:ring-2 focus-visible:ring-brand')).toBe(true);
		expect(BRAND_FOCUS.test('focus-within:border-brand')).toBe(true);
		expect(BRAND_FOCUS.test('focus-visible:ring-focus')).toBe(false);
		expect(BRAND_FOCUS.test('border-brand ring-2 ring-brand/40')).toBe(false);
		expect(BRAND_FOCUS.test('focus-visible:ring-brand-deep')).toBe(false);
	});

	it('draws no focus indicator in brand', () => {
		const files = globSync('src/**/*.{ts,svelte}', { cwd: ROOT }).filter(
			(file) => !file.endsWith('.test.ts') && !file.startsWith(EDITORS),
		);
		expect(files.length).toBeGreaterThan(100);
		const offenders = files.flatMap((file) =>
			readFileSync(join(ROOT, file), 'utf8')
				.split('\n')
				.flatMap((line, i) => (BRAND_FOCUS.test(line) ? [`${file}:${i + 1}`] : [])),
		);
		expect(offenders).toEqual([]);
	});
});
