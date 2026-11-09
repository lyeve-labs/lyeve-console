import { describe, expect, it } from 'vitest';
import type { PluginStatus, PluginStatusReport } from '@lyeve-labs/client-rest';
import {
	buildRows,
	describePlugin,
	failedCount,
	filterRows,
	groupRows,
	rowFor,
	runningCounts,
	stateOf,
	type DescribedPluginStatus,
	type PluginManifest,
} from './plugin-rows';

const status = (
	name: string,
	over: Partial<PluginStatus> = {},
	manifest?: PluginManifest | null,
): DescribedPluginStatus => ({
	name,
	compiled: true,
	entitled: true,
	requested: true,
	active: true,
	phase: 'running',
	...over,
	// A null manifest is what a malformed reply carries, so it is cast in.
	...(manifest === undefined ? {} : { manifest: manifest as PluginManifest }),
});

const SEARCH: PluginManifest = {
	label: 'Search',
	description: 'Ranked full-text search across every schema.',
	category: 'content',
	maturity: 'stable',
};

describe('stateOf', () => {
	it('calls a plugin that serves its routes running, lazy ones included', () => {
		expect(stateOf(status('search'))).toBe('running');
		// A lazy plugin starts on the first request that needs it, and the
		// engine reports it inactive until then.
		expect(stateOf(status('search', { phase: 'lazy' as PluginStatus['phase'], active: false }))).toBe('running');
	});

	it('calls a plugin that stopped with an error failed', () => {
		expect(stateOf(status('search', { phase: 'failed', active: false }))).toBe('failed');
	});

	it('calls a plugin the engine does not enable not enabled', () => {
		expect(stateOf(status('search', { entitled: false, active: false, phase: 'registered' }))).toBe('not-enabled');
	});

	it('calls an enabled plugin the engine did not start not started', () => {
		expect(stateOf(status('search', { requested: false, active: false, phase: 'registered' }))).toBe('not-started');
		expect(stateOf(status('search', { active: false, phase: 'stopped' }))).toBe('not-started');
	});

	it('calls a plugin the engine was built without not in this build', () => {
		expect(stateOf(status('search', { compiled: false, active: false, phase: 'registered' }))).toBe('not-built');
	});
});

describe('describePlugin', () => {
	it('takes the label, description, category and maturity from the manifest', () => {
		expect(describePlugin(status('search', {}, SEARCH))).toEqual({
			label: 'Search',
			description: 'Ranked full-text search across every schema.',
			category: 'content',
			beta: false,
		});
		expect(describePlugin(status('search', {}, { ...SEARCH, maturity: 'beta' })).beta).toBe(true);
	});

	it('labels a plugin that sends no manifest by its name, under Other', () => {
		expect(describePlugin(status('search'))).toEqual({
			label: 'search',
			description: '',
			category: 'other',
			beta: false,
		});
		expect(describePlugin(status('search', {}, null)).label).toBe('search');
	});

	it('files a category outside the set under Other', () => {
		expect(describePlugin(status('search', {}, { label: 'Search', category: 'Search tools' })).category).toBe(
			'other',
		);
	});

	it('reads only text it can show', () => {
		const odd = { label: 42, description: ['x'], maturity: 'BETA' } as unknown as PluginManifest;
		expect(describePlugin(status('search', {}, odd))).toEqual({
			label: 'search',
			description: '',
			category: 'other',
			beta: false,
		});
	});
});

describe('buildRows', () => {
	it('gives every plugin in the report a row, and nothing else', () => {
		expect(buildRows([])).toEqual([]);
		expect(buildRows([status('search'), status('media')]).map((r) => r.name).sort()).toEqual(['media', 'search']);
	});

	it('orders the rows by label', () => {
		const rows = buildRows([
			status('webhook', {}, { label: 'Webhooks' }),
			status('apikey', {}, { label: 'API keys' }),
			status('audit', {}, { label: 'audit log' }),
		]);
		expect(rows.map((r) => r.label)).toEqual(['API keys', 'audit log', 'Webhooks']);
	});

	it('gives a failed row the error it stopped with', () => {
		const [row] = buildRows([
			status('search', { phase: 'failed', active: false, last_error: 'migration 12 already applied' }),
		]);
		expect(row.reason).toBe('migration 12 already applied');
	});

	it('gives a row that is not started the reason the engine gave', () => {
		const [row] = buildRows([
			status('search', { requested: false, active: false, phase: 'registered', reason: 'not requested' }),
		]);
		expect(row.state).toBe('not-started');
		expect(row.reason).toBe('not requested');
	});

	it('says nothing more on a row whose state says it all', () => {
		const [built, running] = buildRows([
			status('a', { compiled: false, active: false, phase: 'registered', reason: 'not compiled' }),
			status('b', { reason: 'stale' }),
		]);
		expect(built.reason).toBeNull();
		expect(running.reason).toBeNull();
	});

	it('offers the link to turn a plugin on only where the row is not enabled', () => {
		const url = 'https://example.test/enable';
		const [off] = buildRows([status('search', { entitled: false, active: false, phase: 'registered', upgrade_url: url })]);
		expect(off.upgradeUrl).toBe(url);

		const [on] = buildRows([status('search', { upgrade_url: url })]);
		expect(on.upgradeUrl).toBeNull();
	});

	it('drops a link that is neither https nor a path on this console', () => {
		const [row] = buildRows([
			status('search', { entitled: false, active: false, phase: 'registered', upgrade_url: 'http://example.test/enable' }),
		]);
		expect(row.upgradeUrl).toBeNull();
	});
});

describe('rowFor', () => {
	const report: PluginStatusReport = {
		compiled: ['search'],
		entitled: ['search'],
		plugins: [status('search', {}, SEARCH)],
	};

	it('finds the row for a plugin the report carries', () => {
		expect(rowFor(report, 'search')).toMatchObject({ name: 'search', label: 'Search', state: 'running' });
	});

	it('calls a plugin the report does not carry not in this build', () => {
		expect(rowFor(report, 'media')).toMatchObject({ name: 'media', label: 'media', state: 'not-built' });
	});

	it('says nothing without a report', () => {
		expect(rowFor(null, 'search')).toBeNull();
		expect(rowFor(undefined, 'search')).toBeNull();
	});
});

describe('counting', () => {
	const rows = buildRows([
		status('search'),
		status('media', { phase: 'lazy' as PluginStatus['phase'], active: false }),
		status('webhook', { phase: 'failed', active: false }),
		status('audit', { entitled: false, active: false, phase: 'registered' }),
		status('cron', { compiled: false, active: false, phase: 'registered' }),
	]);

	it('counts the plugins that run out of the ones this build carries', () => {
		expect(runningCounts(rows)).toEqual({ running: 2, compiled: 4 });
		expect(runningCounts([])).toEqual({ running: 0, compiled: 0 });
	});

	it('counts the failures', () => {
		expect(failedCount(rows)).toBe(1);
	});
});

describe('filterRows', () => {
	const rows = buildRows([
		status('search', {}, SEARCH),
		status('webhook', { phase: 'failed', active: false }, { label: 'Webhooks', category: 'automation' }),
	]);

	it('matches the label, the name and the description', () => {
		expect(filterRows(rows, { query: 'ranked', category: '', states: [] }).map((r) => r.name)).toEqual(['search']);
		expect(filterRows(rows, { query: 'WEBHOOK', category: '', states: [] }).map((r) => r.name)).toEqual(['webhook']);
		expect(filterRows(rows, { query: 'zzzznothing', category: '', states: [] })).toHaveLength(0);
	});

	it('an empty state list means every state, not none', () => {
		expect(filterRows(rows, { query: '', category: '', states: [] })).toHaveLength(rows.length);
	});

	it('filters to one state and to one category', () => {
		expect(filterRows(rows, { query: '', category: '', states: ['failed'] }).map((r) => r.name)).toEqual(['webhook']);
		expect(filterRows(rows, { query: '', category: 'content', states: [] }).map((r) => r.name)).toEqual(['search']);
	});
});

describe('groupRows', () => {
	it("keeps the set's order, so filtering does not reorder the page", () => {
		const rows = buildRows([
			status('webhook', {}, { label: 'Webhooks', category: 'automation' }),
			status('search', {}, SEARCH),
			status('apikey', {}, { label: 'API keys', category: 'access' }),
		]);
		expect(groupRows(rows).map(([c]) => c)).toEqual(['content', 'access', 'automation']);
	});

	it('drops a group with nothing left in it', () => {
		expect(groupRows([])).toHaveLength(0);
	});

	it('puts a plugin that names no category in Other, last', () => {
		const rows = buildRows([status('custom-thing'), status('search', {}, SEARCH)]);
		const grouped = groupRows(rows);
		expect(grouped.at(-1)![0]).toBe('other');
		expect(grouped.at(-1)![1].map((r) => r.name)).toEqual(['custom-thing']);
	});
});
