// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import DevicesPage from './+page.svelte';
import type { Device } from '$lib/api/devices';

afterEach(cleanup);

const CHROME_MAC =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const EDGE_WIN =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function device(over: Partial<Device> = {}): Device {
	return {
		id: 'd1',
		user_id: 'u1',
		label: 'Work laptop',
		user_agent: CHROME_MAC,
		last_seen_at: '2026-09-22T10:00:00Z',
		created_at: '2026-09-01T10:00:00Z',
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		devices: [device()],
		total: 1,
		limit: 25,
		offset: 0,
		hasMore: false,
		userAgent: EDGE_WIN,
		gate: { state: 'ok' },
		licensed: true,
		...over,
	} as never,
	form: form as never,
});

describe('the gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(DevicesPage, {
			props: props({ gate: { state: 'locked', upgradeUrl: '' }, devices: [] }),
		});
		expect(said(container)).toContain('Not enabled on this engine');
		expect(said(container)).not.toContain('No trusted devices yet');
	});

	it('reports a failed read as a failure, not as no trusted devices', () => {
		const { container } = render(DevicesPage, {
			props: props({ gate: { state: 'error', message: 'Your devices could not be read.' }, devices: [] }),
		});
		expect(said(container)).toContain('could not be read');
		expect(said(container)).not.toContain('No trusted devices yet');
	});
});

describe('this device', () => {
	// The endpoint fingerprints the request, so the form can only ever trust
	// the browser reading the page. Offering it while that browser is already
	// trusted would create a second row for one device.
	it('offers to trust when this device is not trusted', () => {
		const { container } = render(DevicesPage, { props: props() });
		expect(said(container)).toContain('Each browser counts as its own device');
	});

	it('puts Trust this device on the name field row, with the hint under the input', () => {
		const { container } = render(DevicesPage, { props: props() });
		const name = container.querySelector('#device-label') as HTMLInputElement;
		const trust = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Trust this device');
		expect(container.querySelector('label[for="device-label"]')?.textContent).toContain('Name this device');
		expect(name.required).toBe(true);
		expect(container.querySelector(`#${name.getAttribute('aria-describedby')}`)?.textContent).toBe(
			'Something you will recognize in the list.',
		);
		expect(trust?.parentElement).toBe(name.parentElement?.parentElement);
	});

	it('says so instead when this device is already trusted', () => {
		const { container } = render(DevicesPage, {
			props: props({ userAgent: CHROME_MAC }),
		});
		expect(said(container)).toContain('This device is already trusted, as Work laptop');
		expect(said(container)).not.toContain('Each browser counts as its own device');
	});

	// It states a standing condition, so it stays. A confirmation that clears
	// itself would leave the section a heading over nothing.
	it('keeps saying this device is trusted after a while', async () => {
		vi.useFakeTimers();
		try {
			const { container } = render(DevicesPage, { props: props({ userAgent: CHROME_MAC }) });
			await vi.advanceTimersByTimeAsync(30_000);
			expect(said(container)).toContain('already trusted, as Work laptop');
		} finally {
			vi.useRealTimers();
		}
	});

	it('marks the row that looks like this device', () => {
		const { container } = render(DevicesPage, { props: props({ userAgent: CHROME_MAC }) });
		expect(said(container)).toContain('Looks like this one');
	});

	it('marks nothing when the request carried no user agent', () => {
		const { container } = render(DevicesPage, { props: props({ userAgent: null }) });
		expect(said(container)).not.toContain('Looks like this one');
	});
});

describe('the rows', () => {
	it('names the browser each device was trusted from', () => {
		const { container } = render(DevicesPage, {
			props: props({ devices: [device(), device({ id: 'd2', label: 'Edge box', user_agent: EDGE_WIN })] }),
		});
		expect(said(container)).toContain('Chrome on macOS');
		expect(said(container)).toContain('Edge on Windows');
		expect(said(container)).not.toContain('Unrecognized device');
	});

	// An engine whose device plugin predates the field sends no user agent.
	// That says nothing about the device, so the row shows its name alone.
	it('shows the name alone when the engine sends no user agent', () => {
		const { user_agent: _omitted, ...withoutAgent } = device();
		const { container } = render(DevicesPage, { props: props({ devices: [withoutAgent] }) });
		expect(said(container)).toContain('Work laptop');
		expect(said(container)).not.toContain('Unrecognized device');
	});
});

describe('one name for the concept', () => {
	// A second name reads as a second thing, so every heading says device.
	it('heads both sections with device', () => {
		const { container } = render(DevicesPage, { props: props() });
		const headings = [...container.querySelectorAll('h2')].map((h) => h.textContent?.trim());
		expect(headings).toEqual(['This device', 'Your trusted devices']);
		expect(container.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('Your trusted devices');
	});

	it.each([
		['not yet trusted', {}],
		['already trusted', { userAgent: CHROME_MAC }],
	])('never says remembered or this browser when %s', (_case, over) => {
		const { container } = render(DevicesPage, { props: props(over) });
		expect(said(container)).toContain('This device');
		expect(said(container)).not.toMatch(/remember/i);
		expect(said(container)).not.toMatch(/this browser/i);
	});
});

describe('the empty state', () => {
	it('says what having no trusted device means', () => {
		const { container } = render(DevicesPage, { props: props({ devices: [] }) });
		expect(said(container)).toContain('treated as coming from a new device');
	});
});

describe('the search', () => {
	it('narrows the page to the devices that match and keeps the pager', async () => {
		const { container, getByPlaceholderText } = render(DevicesPage, {
			props: props({
				devices: [device(), device({ id: 'd2', label: 'Edge box', user_agent: EDGE_WIN })],
				total: 40,
				hasMore: true,
			}),
		});
		await fireEvent.input(getByPlaceholderText('Name or browser on this page'), { target: { value: 'edge' } });
		expect(said(container)).toContain('Edge box');
		expect(said(container)).not.toContain('Work laptop');

		await fireEvent.input(getByPlaceholderText('Name or browser on this page'), { target: { value: 'nothing like it' } });
		expect(said(container)).toContain('No devices match this search');
		expect(container.querySelector('a[href="/admin/settings/devices?limit=25&offset=25"]')).toBeTruthy();
	});
});
