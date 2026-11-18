// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', async () => await import('./route-progress.test-support.svelte.ts'));

import { navigating } from './route-progress.test-support.svelte.ts';
import RouteProgress from './RouteProgress.svelte';

const frame = (c: HTMLElement) => c.querySelector('[data-testid="route-progress"]') as HTMLElement;
const bar = (c: HTMLElement) => c.querySelector('[role="progressbar"]');
const shown = (c: HTMLElement) => !frame(c).className.split(/\s+/).includes('invisible');
const away = { url: new URL('http://localhost/admin/users') };
const ended = (type: string, propertyName: string) => Object.assign(new Event(type), { propertyName });

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	cleanup();
	navigating.to = null;
});

describe('RouteProgress', () => {
	it('shows nothing while the reader is standing still', async () => {
		const { container } = render(RouteProgress);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(shown(container)).toBe(false);
		expect(bar(container)).toBeNull();
	});

	it('stays away for a navigation that resolves in a frame', async () => {
		// A bar that flashes on every click is worse than no bar.
		navigating.to = away;
		const { container } = render(RouteProgress);
		await vi.advanceTimersByTimeAsync(100);
		expect(shown(container)).toBe(false);
		expect(bar(container)).toBeNull();
	});

	it('appears once a navigation is taking long enough to notice, as a named busy bar', async () => {
		navigating.to = away;
		const { container } = render(RouteProgress);
		await vi.advanceTimersByTimeAsync(300);
		expect(shown(container)).toBe(true);
		expect(bar(container)?.getAttribute('aria-label')).toBe('Loading the page');
		expect(bar(container)?.hasAttribute('aria-valuenow')).toBe(false);
	});

	it('fades out on the exit rung when the page lands, rather than leaving in one frame', async () => {
		navigating.to = away;
		const { container } = render(RouteProgress);
		await vi.advanceTimersByTimeAsync(300);
		expect(frame(container).className).toContain('duration-base');
		expect(frame(container).className).toContain('ease-enter');

		navigating.to = null;
		flushSync();
		expect(shown(container)).toBe(false);
		expect(frame(container).className).toContain('opacity-0');
		expect(frame(container).className).toContain('duration-fast');
		expect(frame(container).className).toContain('ease-exit');
		// Still drawn while it fades, and gone once the fade has ended.
		expect(bar(container)).not.toBeNull();
		frame(container).dispatchEvent(ended('transitionend', 'visibility'));
		flushSync();
		expect(bar(container)).toBeNull();
	});

	it('keeps the bar through its fade when the opacity ends first or a transition is canceled', async () => {
		navigating.to = away;
		const { container } = render(RouteProgress);
		await vi.advanceTimersByTimeAsync(300);
		navigating.to = null;
		flushSync();

		frame(container).dispatchEvent(ended('transitioncancel', 'visibility'));
		frame(container).dispatchEvent(ended('transitionend', 'opacity'));
		flushSync();
		expect(bar(container)).not.toBeNull();
	});
});
