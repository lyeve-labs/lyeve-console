import { describe, expect, it } from 'vitest';
import { cpuModeOf, formatFact, formatSetting, memoryFields, parseRuntimeForm, pinnedText, positiveInt, sourceLabel, startOnlyText } from './runtime-settings';

const MIB = 1024 * 1024;

function form(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return data;
}

const setting = (over: Record<string, unknown>) => ({ value: 0, source: 'default', pinned: false, live: false, start_only: false, ...over });

describe('parseRuntimeForm', () => {
	it('sends only the fields the form posted, in the shapes the route takes', () => {
		expect(parseRuntimeForm(form({ revision: '3', cpu_mode: 'fixed', cpu_threads: '4', memory_mode: 'ratio', memory_percent: '80' }))).toEqual({
			body: { revision: 3, cpu: { mode: 'fixed', threads: 4 }, memory: { mode: 'ratio', ratio: 0.8 } },
		});
		expect(parseRuntimeForm(form({ revision: '3', memory_mode: 'bytes', memory_mb: '512', gc_percent: '-1', database_max_connections: '40' }))).toEqual({
			body: { revision: 3, memory: { mode: 'bytes', bytes: 512 * MIB }, gc_percent: -1, database_max_connections: 40 },
		});
		expect(parseRuntimeForm(form({ revision: '0', cpu_mode: 'automatic', memory_mode: 'none' }))).toEqual({
			body: { revision: 0, cpu: { mode: 'automatic' }, memory: { mode: 'none' } },
		});
	});

	it('refuses a value outside the bounds before the round trip', () => {
		expect(parseRuntimeForm(form({ revision: '1', memory_mode: 'ratio', memory_percent: '99' }))).toEqual({ error: 'Enter a share between 50 and 95.', field: 'memory_percent' });
		expect(parseRuntimeForm(form({ revision: '1', memory_mode: 'bytes', memory_mb: '32' }))).toEqual({ error: 'Enter a size of at least 64 MB.', field: 'memory_mb' });
		expect(parseRuntimeForm(form({ revision: '1', database_max_connections: '0' }))).toEqual({ error: 'Enter between 5 and 10,000 connections.', field: 'database_max_connections' });
		expect(parseRuntimeForm(form({ revision: '1', gc_percent: '1.5' }))).toEqual({ error: 'Enter a GC target of -1 or more.', field: 'gc_percent' });
		expect(parseRuntimeForm(form({ revision: '1', cpu_mode: 'fixed', cpu_threads: '0' }))).toEqual({ error: 'Enter a whole number of threads, 1 or more.', field: 'cpu_threads' });
	});

	it('refuses a pool below the five connections the engine accepts', () => {
		for (const n of ['1', '4']) {
			expect(parseRuntimeForm(form({ revision: '1', database_max_connections: n }))).toEqual({ error: 'Enter between 5 and 10,000 connections.', field: 'database_max_connections' });
		}
		expect(parseRuntimeForm(form({ revision: '1', database_max_connections: '5' }))).toEqual({ body: { revision: 1, database_max_connections: 5 } });
	});

	it('refuses a form with no revision or no change', () => {
		expect(parseRuntimeForm(form({ gc_percent: '100' }))).toEqual({ error: 'Could not save the settings. Reload the page and try again.' });
		expect(parseRuntimeForm(form({ revision: '2' }))).toEqual({ error: 'Change a setting first.' });
	});
});

describe('how values read', () => {
	it('words each source, and names the variable for the environment', () => {
		expect(sourceLabel(setting({ source: 'environment', variable: 'GOMAXPROCS' }))).toBe('Environment variable GOMAXPROCS');
		expect(sourceLabel(setting({ source: 'file', variable: 'database.max_connections' }))).toBe('Configuration file key database.max_connections');
		expect(sourceLabel(setting({ source: 'file' }))).toBe('Configuration file');
		expect(sourceLabel(setting({ source: 'console' }))).toBe('Console setting');
		expect(sourceLabel(setting({ source: 'container' }))).toBe('Container limit');
		expect(sourceLabel(setting({ source: 'machine' }))).toBe('This machine');
		expect(sourceLabel(setting({ source: 'default' }))).toBe('Default');
		expect(sourceLabel(setting({ source: 'running' }))).toBe('Changed on the running engine');
		expect(sourceLabel(setting({ source: 'something-new' }))).toBe('');
	});

	it('reads a soft limit of the largest int64 as none and a negative GC target as off', () => {
		expect(formatSetting('memory', setting({ value: 9223372036854775807 }))).toBe('None');
		expect(formatSetting('memory', setting({ value: 512 * MIB }))).toBe('512.0 MB');
		expect(formatSetting('gc_percent', setting({ value: -1 }))).toBe('Off');
		expect(formatSetting('gc_percent', setting({ value: 200 }))).toBe('200%');
	});

	it('words every value of the connection pooler', () => {
		expect(formatSetting('pooler', setting({ value: 'none' }))).toBe('None');
		expect(formatSetting('pooler', setting({ value: 'pgbouncer' }))).toBe('PgBouncer');
		expect(formatSetting('pooler', setting({ value: 'proxysql' }))).toBe('ProxySQL');
		expect(formatSetting('pooler', setting({ value: '' }))).toBe('-');
	});

	it('reads an unknown fact as not available, never as zero', () => {
		expect(formatFact('count', { value: 0, known: false, reason_code: 'no_database' })).toBe('Not available');
		expect(formatFact('count', undefined)).toBe('Not available');
		expect(formatFact('cores', { value: 1.5, known: true })).toBe('1.5');
		expect(formatFact('flag', { value: true, known: true })).toBe('Yes');
	});

	it('says where a file pins a value, in the pattern of the environment', () => {
		expect(pinnedText('database.max_connections', 'file')).toBe(
			'Set by database.max_connections in the configuration file. Change it there, then restart the engine.',
		);
		expect(pinnedText('GOGC', 'environment')).toBe('Set by GOGC. Change it where the engine is deployed, then restart the engine.');
		expect(pinnedText('GOGC')).toBe('Set by GOGC. Change it where the engine is deployed, then restart the engine.');
		expect(startOnlyText(setting({ source: 'file', variable: 'database.pooler' }))).toBe(
			'Set by database.pooler in the configuration file. Applies when the engine starts.',
		);
	});

	it('opens the CPU and memory forms on the mode in force, whatever its source', () => {
		expect(cpuModeOf(setting({ value: 2, mode: 'fixed', source: 'environment', variable: 'GOMAXPROCS' }))).toBe('fixed');
		expect(cpuModeOf(setting({ value: 2, mode: 'automatic', source: 'console' }))).toBe('automatic');
		expect(cpuModeOf(undefined)).toBe('automatic');
		expect(memoryFields(setting({ value: 870 * MIB, mode: 'automatic', ratio: 0.85, source: 'container', live: true }))).toMatchObject({ mode: 'automatic', percent: 85 });
		expect(memoryFields(setting({ value: 717 * MIB, mode: 'ratio', ratio: 0.7, source: 'console', live: true }))).toMatchObject({ mode: 'ratio', percent: 70 });
		expect(memoryFields(setting({ value: 512 * MIB, mode: 'bytes', source: 'file', variable: 'runtime.memory' }))).toMatchObject({ mode: 'bytes', mb: 512 });
		expect(memoryFields(setting({ value: 9223372036854775807, mode: 'none', source: 'console' }))).toMatchObject({ mode: 'none' });
		expect(memoryFields(setting({ value: 512 * MIB, mode: 'something-new' }))).toMatchObject({ mode: 'automatic' });
	});

	it('takes only a positive whole number from the address', () => {
		expect(positiveInt('3')).toBe(3);
		for (const raw of [null, '', '0', '-2', '1.5', 'x']) expect(positiveInt(raw)).toBeUndefined();
	});
});
