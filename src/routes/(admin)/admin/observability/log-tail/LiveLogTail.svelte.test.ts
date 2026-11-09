// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LiveLogTail from './LiveLogTail.svelte';

/** jsdom has no EventSource. The stub records its listeners so a case can play the stream. */
class StubEventSource {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSED = 2;
	static all: StubEventSource[] = [];
	listeners = new Map<string, ((e: MessageEvent) => void)[]>();
	closed = false;
	readyState = StubEventSource.CONNECTING;

	constructor(public url: string) {
		StubEventSource.all.push(this);
	}

	addEventListener(type: string, fn: (e: MessageEvent) => void) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
	}

	emit(type: string, data: unknown = null) {
		for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) } as MessageEvent);
	}

	close() {
		this.closed = true;
		this.readyState = StubEventSource.CLOSED;
	}
}

const last = () => StubEventSource.all.at(-1) as StubEventSource;
let sequence = 0;
const entry = (message: string, level = 0) => ({ timestamp: '2026-01-01T00:00:00Z', level, message, sequence: ++sequence });

const badge = (container: HTMLElement) =>
	[...container.querySelectorAll('span')].find((el) => /^(Connected|Connecting|Refused|Not running)$/.test(el.textContent?.trim() ?? ''))?.textContent?.trim();

beforeEach(() => {
	StubEventSource.all = [];
	vi.stubGlobal('EventSource', StubEventSource);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('LiveLogTail', () => {
	it('opens one stream at the INFO level and reads Connecting until it opens', async () => {
		const { container } = render(LiveLogTail, { props: { running: true } });
		expect(StubEventSource.all).toHaveLength(1);
		expect(last().url).toBe('/api/admin/logs/stream?min_level=info');
		expect(badge(container)).toBe('Connecting');
		expect(container.textContent).toContain('Waiting for log entries');

		last().emit('open');
		await tick();
		expect(badge(container)).toBe('Connected');
	});

	it('puts the newest entry first and counts them', async () => {
		const { container } = render(LiveLogTail, { props: { running: true } });
		last().emit('log', entry('first'));
		last().emit('log', entry('second', 8));
		await tick();
		const rows = [...container.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '');
		expect(rows[0]).toContain('second');
		expect(rows[0]).toContain('ERROR');
		expect(rows[1]).toContain('first');
		expect(container.textContent).toContain('2 entries');
	});

	it('drops what arrives while paused, and clears on request', async () => {
		const { container, getByRole } = render(LiveLogTail, { props: { running: true } });
		last().emit('log', entry('before the pause'));
		await tick();
		await fireEvent.click(getByRole('button', { name: 'Pause' }));
		last().emit('log', entry('during the pause'));
		await tick();
		expect(container.textContent).not.toContain('during the pause');
		await fireEvent.click(getByRole('button', { name: 'Resume' }));
		await fireEvent.click(getByRole('button', { name: /clear/i }));
		expect(container.textContent).not.toContain('before the pause');
		expect(StubEventSource.all).toHaveLength(1);
	});

	it('leaves a dropped stream to the browser and reads Connecting while it reconnects', async () => {
		const { container } = render(LiveLogTail, { props: { running: true } });
		last().emit('open');
		await tick();
		last().readyState = StubEventSource.CONNECTING;
		last().emit('error');
		await tick();
		expect(badge(container)).toBe('Connecting');
		expect(StubEventSource.all).toHaveLength(1);
		expect(last().closed).toBe(false);
	});

	it('shows a refusal with Try again, which opens one new stream on the same filter', async () => {
		const { container, getByRole } = render(LiveLogTail, { props: { running: true } });
		last().readyState = StubEventSource.CLOSED;
		last().emit('error');
		await tick();
		expect(badge(container)).toBe('Refused');
		expect(container.textContent).toContain('Could not connect to the live log tail');
		expect(container.textContent).not.toContain('Waiting for log entries');

		await fireEvent.click(getByRole('button', { name: /try again/i }));
		await tick();
		expect(StubEventSource.all).toHaveLength(2);
		expect(last().url).toBe('/api/admin/logs/stream?min_level=info');
		expect(badge(container)).toBe('Connecting');
	});

	it('keeps its stream when the same flag arrives again, and closes it when the plugin stops', async () => {
		const { container, rerender } = render(LiveLogTail, { props: { running: true } });
		const first = last();
		await rerender({ running: true });
		expect(StubEventSource.all).toHaveLength(1);
		expect(first.closed).toBe(false);

		await rerender({ running: false });
		expect(first.closed).toBe(true);
		expect(StubEventSource.all).toHaveLength(1);
		expect(badge(container)).toBe('Not running');
		expect(container.textContent).toContain('The logging plugin is not running on this engine, so the live log tail is not available.');
	});

	it('opens nothing while the plugin does not run, and closes its stream on unmount', async () => {
		render(LiveLogTail, { props: { running: false } });
		expect(StubEventSource.all).toHaveLength(0);
		cleanup();

		const { unmount } = render(LiveLogTail, { props: { running: true } });
		const first = last();
		unmount();
		await tick();
		expect(first.closed).toBe(true);
		expect(StubEventSource.all).toHaveLength(1);
	});
});
