// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
	invalidateAll: vi.fn(async () => {}),
}));

import LogTailPage from './+page.svelte';

/**
 * The live tail opens an EventSource as soon as the page mounts and jsdom has
 * none. The stub records its listeners so a log entry can be pushed through the
 * same path the engine's stream uses.
 */
class StubEventSource {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSED = 2;
	static last: StubEventSource | null = null;
	static all: StubEventSource[] = [];
	listeners = new Map<string, ((e: MessageEvent) => void)[]>();
	closed = false;
	readyState = StubEventSource.CONNECTING;

	constructor(public url: string) {
		StubEventSource.last = this;
		StubEventSource.all.push(this);
	}

	addEventListener(type: string, fn: (e: MessageEvent) => void) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
	}

	emit(type: string, data: unknown) {
		for (const fn of this.listeners.get(type) ?? []) {
			fn({ data: JSON.stringify(data) } as MessageEvent);
		}
	}

	close() {
		this.closed = true;
		this.readyState = StubEventSource.CLOSED;
	}
}

beforeEach(() => {
	StubEventSource.last = null;
	StubEventSource.all = [];
	vi.stubGlobal('EventSource', StubEventSource);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function data(overrides: Record<string, unknown> = {}) {
	return {
		logTail: true,
		...overrides,
	};
}

const props = (over: Record<string, unknown> = {}) => ({
	data: data(over) as never,
});

/*
 * The stream carries slog's severity integer, not the label, so the badge reads
 * the level in either shape.
 */
describe('Live log tail', () => {
	// The tail keys its rows on the sequence, which the engine makes unique.
	let sequence = 0;
	function push(level: number, message = 'a message') {
		StubEventSource.last?.emit('log', {
			timestamp: '2026-01-01T00:00:00Z',
			level,
			message,
			sequence: ++sequence,
		});
	}

	it('renders an entry whose level arrives as an integer', async () => {
		const { container, component } = render(LogTailPage, { props: props() });
		void component;

		push(8, 'the database went away');
		await Promise.resolve();

		expect(container.textContent).toContain('the database went away');
	});

	it('names the severity rather than printing the raw integer', async () => {
		const { container } = render(LogTailPage, { props: props() });

		push(4, 'slow query');
		await Promise.resolve();

		expect(container.textContent).toContain('WARN');
		expect(container.textContent).not.toContain('>4<');
	});

	it('survives every level the engine emits', async () => {
		const { container } = render(LogTailPage, { props: props() });

		for (const level of [-4, 0, 4, 8]) push(level, `entry ${level}`);
		await Promise.resolve();

		for (const label of ['DEBUG', 'INFO', 'WARN', 'ERROR']) {
			expect(container.textContent).toContain(label);
		}
	});
});

/*
 * A filter change is a close followed by a reopen with the new filter in the
 * URL, the keyword waits for the typing to pause, and only unmount stops the
 * reopening. A cleanup that ends the tail for good on a filter change would
 * leave the badge reading Connected over a closed stream.
 */
describe('Live log tail filters', () => {
	const badge = (container: HTMLElement) =>
		[...container.querySelectorAll('span')].find((el) => /^(Connected|Connecting|Refused)$/.test(el.textContent?.trim() ?? ''))?.textContent?.trim();

	function connect() {
		StubEventSource.last?.emit('open', null);
	}

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('opens one stream on mount and reads Connected once it opens', async () => {
		const { container } = render(LogTailPage, { props: props() });
		expect(StubEventSource.all).toHaveLength(1);
		expect(StubEventSource.last?.url).toBe('/api/admin/logs/stream?min_level=info');
		expect(badge(container)).toBe('Connecting');

		connect();
		await tick();
		expect(badge(container)).toBe('Connected');
	});

	it('reopens the stream with the keyword after the typing pauses, not per keystroke', async () => {
		const { container } = render(LogTailPage, { props: props() });
		connect();
		await tick();
		const first = StubEventSource.last as StubEventSource;
		const input = container.querySelector('#tail-keyword') as HTMLInputElement;

		for (const typed of ['e', 'er', 'err']) {
			await fireEvent.input(input, { target: { value: typed } });
			vi.advanceTimersByTime(100);
			await tick();
		}
		expect(StubEventSource.all).toHaveLength(1);
		expect(first.closed).toBe(false);

		vi.advanceTimersByTime(300);
		await tick();

		expect(first.closed).toBe(true);
		expect(StubEventSource.all).toHaveLength(2);
		expect(StubEventSource.last?.url).toContain('keyword=err');
		expect(StubEventSource.last?.url).toContain('min_level=info');
		expect(badge(container)).toBe('Connecting');

		connect();
		await tick();
		expect(badge(container)).toBe('Connected');
	});

	it('applies the keyword at once on Enter', async () => {
		const { container } = render(LogTailPage, { props: props() });
		const first = StubEventSource.last as StubEventSource;
		const input = container.querySelector('#tail-keyword') as HTMLInputElement;

		await fireEvent.input(input, { target: { value: 'timeout' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		await tick();

		expect(first.closed).toBe(true);
		expect(StubEventSource.all).toHaveLength(2);
		expect(StubEventSource.last?.url).toContain('keyword=timeout');

		// The debounce timer that was pending sets the same value, so it must
		// not open a third stream.
		vi.advanceTimersByTime(300);
		await tick();
		expect(StubEventSource.all).toHaveLength(2);
	});

	it('reopens the stream with the new minimum level on a level pick', async () => {
		const { container } = render(LogTailPage, { props: props() });
		connect();
		await tick();
		const first = StubEventSource.last as StubEventSource;

		const option = [...container.querySelectorAll('#tail-level [role="radio"]')].find((el) => el.textContent?.includes('ERROR'));
		expect(option).toBeTruthy();
		await fireEvent.click(option as HTMLElement);
		await tick();

		expect(first.closed).toBe(true);
		expect(StubEventSource.all).toHaveLength(2);
		expect(StubEventSource.last?.url).toBe('/api/admin/logs/stream?min_level=error');
		expect(badge(container)).toBe('Connecting');

		// Lines keep arriving on the new stream.
		connect();
		StubEventSource.last?.emit('log', { timestamp: '2026-01-01T00:00:00Z', level: 8, message: 'after the pick', sequence: 1 });
		await tick();
		expect(badge(container)).toBe('Connected');
		expect(container.textContent).toContain('after the pick');
	});

	// A refresh hands the page new data. The tail must not close, empty and
	// reopen on it.
	it('keeps one stream and its entries when the page data changes', async () => {
		const { container, rerender } = render(LogTailPage, { props: props() });
		connect();
		StubEventSource.last?.emit('log', { timestamp: '2026-01-01T00:00:00Z', level: 0, message: 'kept across a refresh', sequence: 1 });
		await tick();
		const first = StubEventSource.last as StubEventSource;

		await rerender(props({ logTail: true }));
		await tick();

		expect(StubEventSource.all).toHaveLength(1);
		expect(first.closed).toBe(false);
		expect(container.textContent).toContain('kept across a refresh');
		expect(badge(container)).toBe('Connected');
	});

	it('closes the stream on unmount and does not reopen it', async () => {
		const { unmount } = render(LogTailPage, { props: props() });
		connect();
		await tick();
		const first = StubEventSource.last as StubEventSource;

		unmount();
		await tick();
		vi.advanceTimersByTime(5000);
		await tick();

		expect(first.closed).toBe(true);
		expect(StubEventSource.all).toHaveLength(1);
	});

	// The browser retries a stream that dropped after it opened. Opening a
	// second one beside it would hold two tails open.
	it('leaves a dropped stream to the browser to reopen', async () => {
		const { container } = render(LogTailPage, { props: props() });
		const first = StubEventSource.last as StubEventSource;
		connect();
		await tick();

		first.readyState = StubEventSource.CONNECTING;
		first.emit('error', null);
		await tick();
		vi.advanceTimersByTime(5000);
		await tick();

		expect(first.closed).toBe(false);
		expect(StubEventSource.all).toHaveLength(1);
		expect(badge(container)).toBe('Connecting');
	});

	// A refused stream is closed for good. Retrying it on a timer repeated the
	// refusal every three seconds and read as a connection about to come back.
	it('says a refused stream was refused and waits for the reader to try again', async () => {
		const { container, getByRole } = render(LogTailPage, { props: props() });
		const first = StubEventSource.last as StubEventSource;

		first.readyState = StubEventSource.CLOSED;
		first.emit('error', null);
		await tick();
		vi.advanceTimersByTime(10_000);
		await tick();

		expect(StubEventSource.all).toHaveLength(1);
		expect(badge(container)).toBe('Refused');
		expect(container.textContent).toContain('Could not connect to the live log tail');

		await fireEvent.click(getByRole('button', { name: /try again/i }));
		await tick();
		expect(StubEventSource.all).toHaveLength(2);
		expect(StubEventSource.last?.url).toBe('/api/admin/logs/stream?min_level=info');
	});

	it('opens no stream while the logging plugin does not run', async () => {
		const { container } = render(LogTailPage, { props: props({ logTail: false }) });
		await tick();

		expect(StubEventSource.all).toHaveLength(0);
		expect(container.textContent).toContain('The logging plugin is not running on this engine, so the live log tail is not available.');
	});
});

describe('the live log tail page', () => {
	it('carries the observability tabs with Live log tail marked', () => {
		const { getByRole } = render(LogTailPage, { props: props() });
		expect(getByRole('tab', { name: 'Live log tail' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('false');
	});
});
