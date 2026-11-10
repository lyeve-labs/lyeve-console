// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LogsPage from './+page.svelte';

afterEach(cleanup);

const NO_TRACE = '00000000000000000000000000000000';
const REAL_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

function entry(overrides: Record<string, unknown> = {}) {
	return {
		timestamp: '2026-01-01T00:00:00Z',
		level: 'INFO',
		message: 'a message',
		...overrides,
	};
}

const ok = <T,>(value: T) => ({ ok: true as const, value });
const failed = { ok: false as const, gate: { state: 'error', message: 'Could not be read.' } };

function data(entries: Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
	const { total, volume, levels, config, ...rest } = overrides;
	return {
		search: ok({ results: entries, total: total ?? entries.length }),
		limit: 100,
		offset: 0,
		levels: levels === undefined ? failed : ok(levels),
		config: config === undefined ? failed : ok(config),
		volume: volume === undefined ? failed : ok(volume),
		q: '',
		level: '',
		...rest,
	};
}

const props = (entries: Record<string, unknown>[], overrides: Record<string, unknown> = {}) => ({
	data: data(entries, overrides) as never,
});

const volume = {
	total: 12,
	by_level: { INFO: 9, ERROR: 3 },
	by_tenant: {},
	by_plugin: {},
	window: '24h',
	since: '',
	alerts: [],
};

function chip(container: HTMLElement, level: string): HTMLAnchorElement {
	const a = [...container.querySelectorAll('a')].find((el) =>
		el.textContent?.trim().startsWith(level)
	);
	if (!a) throw new Error(`no ${level} chip`);
	return a;
}

/*
 * OpenTelemetry spells "no trace" as an all-zero id rather than as an absent
 * field, so a guard on the field alone would print
 * trace=00000000000000000000000000000000 on every row.
 */
describe('Log row trace id', () => {
	it('prints no trace for the all-zero id', () => {
		const { container } = render(LogsPage, { props: props([entry({ trace_id: NO_TRACE })]) });

		expect(container.textContent).not.toContain('trace=');
	});

	it('prints no trace when the field is absent', () => {
		const { container } = render(LogsPage, { props: props([entry()]) });

		expect(container.textContent).not.toContain('trace=');
	});

	it('prints a real trace', () => {
		const { container } = render(LogsPage, { props: props([entry({ trace_id: REAL_TRACE })]) });

		expect(container.textContent).toContain(`trace=${REAL_TRACE}`);
	});

	it('keeps the message when the trace is dropped', () => {
		const { container } = render(LogsPage, {
			props: props([entry({ trace_id: NO_TRACE, message: 'schema migrated' })]),
		});

		expect(container.textContent).toContain('schema migrated');
	});
});

/*
 * The counts per level in the volume card read like filters, so each is a
 * link. A chip keeps the search term and page size and starts from the first
 * page. The active chip clears the level.
 */
describe('Level chips', () => {
	it('filters to the level and resets the position', () => {
		const { container } = render(LogsPage, {
			props: props([entry()], { volume, q: 'boot', limit: 50, offset: 150 }),
		});

		const href = new URL(chip(container, 'ERROR').getAttribute('href') ?? '', 'http://x');
		expect(href.pathname).toBe('/admin/logs');
		expect(href.searchParams.get('level')).toBe('ERROR');
		expect(href.searchParams.get('q')).toBe('boot');
		expect(href.searchParams.get('limit')).toBe('50');
		expect(href.searchParams.get('offset')).toBe('0');
	});

	it('clears the level from the active chip', () => {
		const { container } = render(LogsPage, {
			props: props([entry()], { volume, level: 'ERROR', q: 'boot' }),
		});

		const active = chip(container, 'ERROR');
		expect(active.getAttribute('aria-current')).toBe('true');
		const href = new URL(active.getAttribute('href') ?? '', 'http://x');
		expect(href.searchParams.get('level')).toBeNull();
		expect(href.searchParams.get('q')).toBe('boot');
		expect(chip(container, 'INFO').getAttribute('aria-current')).toBeNull();
	});
});

/*
 * The pager's links carry the filter, or the second page of a filtered list
 * would be the second page of everything.
 */
describe('Paging', () => {
	it('links the next page with the filter kept', () => {
		const { container } = render(LogsPage, {
			props: props([entry()], { total: 250, limit: 100, offset: 0, level: 'WARN', q: 'db' }),
		});

		const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
		const next = links.find((h) => h.includes('offset=100'));
		expect(next).toBeDefined();
		const href = new URL(next ?? '', 'http://x');
		expect(href.searchParams.get('level')).toBe('WARN');
		expect(href.searchParams.get('q')).toBe('db');
		expect(href.searchParams.get('limit')).toBe('100');
	});

	it('states the range and the total', () => {
		const { container } = render(LogsPage, {
			props: props([entry()], { total: 250, limit: 100, offset: 100 }),
		});

		expect(container.textContent).toContain('entries 101 to 200 of 250');
	});
});

/*
 * The levels endpoint names the default level ("INFO"), while slog's integer
 * shape is what the SSE tail sends. Reading the name as an integer compared a
 * string with numbers, every comparison was false, and the card said ERROR.
 */
describe('Default level card', () => {
	function defaultLevel(container: HTMLElement): string {
		const label = [...container.querySelectorAll('p')].find((el) => el.textContent?.trim() === 'Default level');
		return label?.nextElementSibling?.textContent?.trim() ?? '';
	}

	it('shows the level the engine names', () => {
		const { container } = render(LogsPage, {
			props: props([], { levels: { default_level: 'INFO', tenants: {}, plugins: {} } }),
		});

		expect(defaultLevel(container)).toBe('INFO');
	});

	it('shows a level sent as slog severity', () => {
		const { container } = render(LogsPage, {
			props: props([], { levels: { default_level: -4, tenants: {}, plugins: {} } }),
		});

		expect(defaultLevel(container)).toBe('DEBUG');
	});

	it('shows no value when the levels could not be read', () => {
		const { container } = render(LogsPage, { props: props([]) });

		expect(defaultLevel(container)).toBe('-');
	});
});

describe('Search box', () => {
	it('promises only what the search finds', () => {
		const { container } = render(LogsPage, { props: props([]) });

		const input = container.querySelector<HTMLInputElement>('#log-search');
		expect(input?.placeholder).toBe('Message words, a request ID or a trace ID');
	});
});

describe('a search that failed', () => {
	// A failed search drawn as an empty one told the reader no entry matched.
	it('says the entries could not be read', () => {
		const { container } = render(LogsPage, {
			props: { data: { ...data([]), search: { ok: false, gate: { state: 'unavailable' } } } as never },
		});

		expect(container.textContent).toContain('is unavailable');
		expect(container.textContent).not.toContain('No log entries');
	});

	it('says the plugin is missing once for the page', () => {
		const absent = { ok: false, gate: { state: 'absent' } };
		const { container } = render(LogsPage, {
			props: { data: { ...data([]), search: absent, volume: absent, levels: absent, config: absent } as never },
		});

		const text = container.textContent ?? '';
		expect(text.split('not included in this build').length - 1).toBe(1);
		expect(text).not.toContain('Volume (24h)');
	});
});

describe('an empty log', () => {
	it('does not tell a reader with no filter to widen one', () => {
		const { container } = render(LogsPage, { props: props([]) });

		expect(container.textContent).toContain('No log entries yet');
		expect(container.textContent).not.toContain('match these filters');
	});

	it('says the filter matched nothing when there is one', () => {
		const { container } = render(LogsPage, { props: props([], { level: 'ERROR' }) });

		expect(container.textContent).toContain('No log entries match these filters');
	});
});

describe('figures that could not be read', () => {
	it('does not count zero overrides when the levels failed', () => {
		const { container } = render(LogsPage, { props: props([]) });

		expect(container.textContent).not.toContain('0 tenant and plugin overrides');
		expect(container.textContent).toContain('Could not be read.');
	});
});

describe('page size', () => {
	it('offers the sizes as segments that submit with the filter', () => {
		const { container } = render(LogsPage, { props: props([entry()]) });

		expect(container.querySelector('select[name="limit"]')).toBeNull();
		expect(container.querySelector<HTMLInputElement>('input[name="limit"]')?.value).toBe('100');
	});
});

describe('logs filter row', () => {
	it('applies a filter as it changes, with no Search button', async () => {
		const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
		try {
			const { container, getByRole } = render(LogsPage, props([entry()]));
			const form = container.querySelector('input[name="q"]')?.closest('form') as HTMLFormElement;
			expect(form.querySelector('button[type="submit"]')).toBeNull();
			await fireEvent.click(getByRole('radio', { name: '200' }));
			await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
			expect((form.querySelector('input[name="limit"]:checked, input[name="limit"][type="hidden"]') as HTMLInputElement).value).toBe('200');
		} finally {
			submit.mockRestore();
		}
	});

	it('offers to clear the filters when nothing matches them', () => {
		const { getByRole } = render(LogsPage, props([], { q: 'nothing', level: 'ERROR' }));
		expect(getByRole('link', { name: 'Clear filters' }).getAttribute('href')).toBe('/admin/logs');
	});
});
