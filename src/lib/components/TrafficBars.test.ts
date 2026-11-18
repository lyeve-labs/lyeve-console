// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import TrafficBars from './TrafficBars.svelte';

afterEach(cleanup);

const hours = [
	{ hour: '2026-09-13T10:00:00Z', requests: 40, errorRate: 0 },
	{ hour: '2026-09-13T11:00:00Z', requests: 0, errorRate: 0 },
	{ hour: '2026-09-13T12:00:00Z', requests: 10, errorRate: 0.02 },
	{ hour: '2026-09-13T13:00:00Z', requests: 1, errorRate: 0.5 },
];

describe('TrafficBars', () => {
	it('scales every bar to the tallest and never rounds a busy hour away', () => {
		const { container } = render(TrafficBars, { props: { hours } });

		const bars = [...container.querySelectorAll<HTMLElement>('[data-requests]')];
		expect(bars.map((b) => b.style.height)).toEqual(['100%', '0%', '25%', '2.5%']);
	});

	it('moves each bar to its new height on the progress rung', () => {
		const { container } = render(TrafficBars, { props: { hours } });
		for (const bar of container.querySelectorAll<HTMLElement>('[data-requests]')) {
			expect(bar.classList).toContain('transition-[height]');
			expect(bar.classList).toContain('duration-progress');
		}
	});

	it('colors an hour by its failure band and a quiet hour as a rule', () => {
		const { container } = render(TrafficBars, { props: { hours } });

		const bars = [...container.querySelectorAll<HTMLElement>('[data-requests]')];
		expect(bars.map((b) => b.className.split(' ').find((c) => c.startsWith('bg-')))).toEqual([
			'bg-brand',
			'bg-line',
			'bg-warn',
			'bg-danger',
		]);
	});

	it('states the total and the peak, and names each hour on hover', () => {
		const { container } = render(TrafficBars, { props: { hours } });

		const text = container.textContent ?? '';
		expect(text).toContain('51 requests');
		expect(text).toContain('peak 40 at 2026-09-13 10:00 UTC');
		const column = container.querySelector('[title]');
		expect(column?.getAttribute('title')).toBe('2026-09-13 10:00 UTC: 40 requests, 0.0% failed');
	});

	it('keeps the same series in a table for a reader who cannot see the bars', () => {
		const { container } = render(TrafficBars, { props: { hours } });

		const rows = [...container.querySelectorAll('tbody tr')];
		expect(rows.length).toBe(4);
		expect(rows[3].textContent).toContain('2026-09-13 13:00 UTC');
		expect(rows[3].textContent).toContain('50.0%');
	});

	it('draws nothing to scale against when every hour is quiet', () => {
		const { container } = render(TrafficBars, {
			props: { hours: hours.map((h) => ({ ...h, requests: 0 })) },
		});

		const bars = [...container.querySelectorAll<HTMLElement>('[data-requests]')];
		expect(bars.every((b) => b.style.height === '0%')).toBe(true);
		expect(container.textContent).toContain('0 requests');
		expect(container.textContent).not.toContain('peak');
	});
});
