// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import TrendBars from './TrendBars.svelte';

afterEach(cleanup);

const until = new Date('2026-10-14T09:00:00Z');

describe('TrendBars', () => {
	it('moves each bar to its new height on the value rung, rather than in one frame', () => {
		render(TrendBars, { props: { days: [0, 4, 2], label: 'Posts', until } });
		const bars = [...screen.getByTestId('trend-bars').querySelectorAll('div > div > div')];
		expect(bars).toHaveLength(3);
		for (const bar of bars) {
			expect(bar.classList).toContain('transition-[height]');
			expect(bar.classList).toContain('duration-progress');
		}
	});

	it('gives a reader who cannot see the bars the same numbers by day, ending today', () => {
		render(TrendBars, { props: { days: [0, 4, 2], label: 'Posts', until } });
		const table = screen.getByRole('table', { name: 'Posts, entries changed per day' });
		const rows = [...table.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent));
		expect(rows).toEqual([
			['2026-10-12', '0'],
			['2026-10-13', '4'],
			['2026-10-14', '2'],
		]);
	});

	it('names each bar with its day and count on hover', () => {
		const { container } = render(TrendBars, { props: { days: [0, 1200], label: 'Posts', until } });
		const titles = [...container.querySelectorAll('[title]')].map((e) => e.getAttribute('title'));
		expect(titles).toEqual(['2026-10-13: 0 changed', '2026-10-14: 1,200 changed']);
	});

	it('scales each bar to the busiest day and keeps a quiet day visible', () => {
		const { container } = render(TrendBars, { props: { days: [100, 50, 1, 0], label: 'Posts', until } });
		const heights = [...container.querySelectorAll('[title] > div')].map((b) => (b as HTMLElement).style.height);
		expect(heights).toEqual(['100%', '50%', '8%', '']);
	});
});
