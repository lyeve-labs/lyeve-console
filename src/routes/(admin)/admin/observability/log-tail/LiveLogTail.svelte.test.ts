// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LiveLogTail from './LiveLogTail.svelte';
import { watchTransitions } from '#lib/transitions.test-support.ts';

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

	it('cuts a long message when it arrives, so the table holds a bounded amount', async () => {
		const { container } = render(LiveLogTail, { props: { running: true } });
		last().emit('log', entry('x'.repeat(50_000)));
		await tick();
		const cell = [...container.querySelectorAll('tbody td')].find((td) => td.textContent?.startsWith('x'));
		expect(cell?.textContent).toBe(`${'x'.repeat(2000)}\u2026`);
	});

	it('holds what arrives while paused, adds it on resume, and clears on request', async () => {
		const { container, getByRole } = render(LiveLogTail, { props: { running: true } });
		last().emit('log', entry('before the pause'));
		await tick();
		const pause = getByRole('button', { name: 'Pause' });
		expect(pause.getAttribute('aria-pressed')).toBe('false');
		await fireEvent.click(pause);
		expect(pause.getAttribute('aria-pressed')).toBe('true');
		last().emit('log', entry('during the pause'));
		await tick();
		expect(container.textContent).not.toContain('during the pause');
		await fireEvent.click(pause);
		expect(pause.getAttribute('aria-pressed')).toBe('false');
		expect(container.textContent).toContain('during the pause');
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

describe('LiveLogTail rows arriving', () => {
	it('fades a new row in at the top', async () => {
		const { container } = render(LiveLogTail, { props: { running: true } });
		last().emit('log', entry('first'));
		await tick();
		const watch = watchTransitions();
		try {
			last().emit('log', entry('second'));
			await tick();
			const top = container.querySelector('tbody tr') as HTMLElement;
			expect(top.textContent).toContain('second');
			expect(watch.entered).toContain(top);
		} finally {
			watch.stop();
		}
	});

	it('keeps the row a reader scrolled to in place as rows arrive above it', async () => {
		// jsdom lays nothing out, so a row stands at 20px a row and the box keeps the offset it is given.
		const rowTop = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
			return this instanceof HTMLTableRowElement ? this.sectionRowIndex * 20 : 0;
		});
		try {
			const { container } = render(LiveLogTail, { props: { running: true } });
			for (const m of ['one', 'two', 'three']) last().emit('log', entry(m));
			await tick();
			const box = container.querySelector('tbody')!.closest('.overflow-y-auto') as HTMLElement;
			let top = 30;
			Object.defineProperty(box, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => (top = v) });

			last().emit('log', entry('four'));
			await tick();
			await tick();
			expect(top).toBe(50);

			top = 0;
			last().emit('log', entry('five'));
			await tick();
			await tick();
			expect(top, 'a reader at the top sees the newest row arrive').toBe(0);
		} finally {
			rowTop.mockRestore();
		}
	});
});

describe('LiveLogTail resume', () => {
	it('leaves the scroll alone when the held rows push the row read out of the table', async () => {
		const rowTop = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
			return this instanceof HTMLTableRowElement ? this.sectionRowIndex * 20 : 0;
		});
		// An animation that never finishes, so a row that fades out stays in the
		// table, inert, as it does in a browser for the length of its fade.
		const animate = Element.prototype.animate;
		Element.prototype.animate = () => ({ cancel() {}, onfinish: null, currentTime: 0, playState: 'running', effect: null }) as unknown as Animation;
		try {
			const { container, getByRole } = render(LiveLogTail, { props: { running: true } });
			for (const m of ['one', 'two', 'three']) last().emit('log', entry(m));
			await tick();
			const box = container.querySelector('tbody')!.closest('.overflow-y-auto') as HTMLElement;
			let top = 30;
			Object.defineProperty(box, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => (top = v) });
			const pause = getByRole('button', { name: 'Pause' });
			await fireEvent.click(pause);
			for (let i = 0; i < 200; i++) last().emit('log', entry(`held ${i}`));
			await fireEvent.click(pause);
			await tick();
			await tick();
			// The row read is fading out below two hundred new ones, so it marks no place.
			expect(top).toBe(30);
		} finally {
			Element.prototype.animate = animate;
			rowTop.mockRestore();
		}
	});
});
