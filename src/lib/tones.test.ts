import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { entryTone, eventTone, httpStatusTone, jobTone, methodTone } from './tones';

describe('methodTone', () => {
	it('paints a read in brand on every page that lists routes', () => {
		expect(methodTone('GET')).toBe('brand');
		expect(methodTone('HEAD')).toBe('brand');
	});

	it('sets each kind of write apart from a read and a delete from both', () => {
		expect(methodTone('POST')).toBe('success');
		expect(methodTone('PUT')).toBe('warn');
		expect(methodTone('PATCH')).toBe('warn');
		expect(methodTone('DELETE')).toBe('danger');
	});

	it('reads a method in any case and leaves an unknown one neutral', () => {
		expect(methodTone('get')).toBe('brand');
		expect(methodTone('OPTIONS')).toBe('neutral');
	});
});

describe('entryTone', () => {
	it('tells a published entry from a draft and from anything else', () => {
		expect(entryTone('published')).toBe('success');
		expect(entryTone('draft')).toBe('warn');
		expect(entryTone('archived')).toBe('neutral');
	});
});

describe('jobTone', () => {
	it('reads an export job and a replay run the same way', () => {
		expect(jobTone('running')).toBe('warn');
		expect(jobTone('completed')).toBe('success');
		expect(jobTone('failed')).toBe('danger');
		expect(jobTone('pending')).toBe('neutral');
		expect(jobTone('canceled')).toBe('neutral');
	});
});

describe('eventTone', () => {
	it('tells an event after a write from one before it', () => {
		expect(eventTone('after_create')).toBe('success');
		expect(eventTone('before_create')).toBe('warn');
	});
});

describe('httpStatusTone', () => {
	it('reads each class of response the same on every page', () => {
		expect(httpStatusTone(200)).toBe('success');
		expect(httpStatusTone(204)).toBe('success');
		expect(httpStatusTone(302)).toBe('neutral');
		expect(httpStatusTone(404)).toBe('warn');
		expect(httpStatusTone(503)).toBe('danger');
	});

	// A 0 is a request that got no answer, and a 1xx is not a final response.
	// Neither says the server failed.
	it('leaves a status outside the response classes neutral', () => {
		expect(httpStatusTone(0)).toBe('neutral');
		expect(httpStatusTone(101)).toBe('neutral');
		expect(httpStatusTone(600)).toBe('neutral');
	});
});

// A tone union written out by hand drifts from the kit's when the kit adds
// or renames a tone, so a tone is typed as the kit's StatusTone, or
// AccentTone where a label may be violet. A subset the caller depends on
// narrows the kit's type with Extract, which still breaks when the kit
// renames a member.
const TONE_UNION = /'(neutral|brand|success|warn|danger|violet)'(\s*\|\s*'(neutral|brand|success|warn|danger|violet)')+/;
const handWritten = (line: string) => TONE_UNION.test(line) && !line.includes('Extract<');

// The glob is resolved from this file, not the working directory, so the
// scan reads the same tree wherever the suite is started.
const ROOT = join(import.meta.dirname, '..', '..');

describe('tone types', () => {
	it('tells a hand-written union from a narrowed kit type', () => {
		expect(handWritten("function t(): 'warn' | 'danger' {")).toBe(true);
		expect(handWritten("\ttone: Extract<StatusTone, 'warn' | 'danger'>;")).toBe(false);
		expect(handWritten('function t(): StatusTone {')).toBe(false);
	});

	it('writes no tone union by hand', () => {
		const files = globSync('src/**/*.{ts,svelte}', { cwd: ROOT }).filter((file) => !file.endsWith('.test.ts'));
		expect(files.length).toBeGreaterThan(100);
		const offenders = files.flatMap((file) =>
			readFileSync(join(ROOT, file), 'utf8')
				.split('\n')
				.flatMap((line, i) => (handWritten(line) ? [`${file}:${i + 1}`] : [])),
		);
		expect(offenders).toEqual([]);
	});
});
