// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import StreamsLab from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const props = () => ({ data: { user: { roles: ['admin'] } } as never });

describe('the Streams lab', () => {
	it('opens the stream lab under its own tab', () => {
		const { getByRole } = render(StreamsLab, { props: props() });
		expect(getByRole('tab', { name: 'Streams' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('heading', { level: 2, name: 'Streams' })).toBeTruthy();
	});

	// There is no sandbox on any lab, so every tab says so.
	it('keeps the no-sandbox warning', () => {
		const { container } = render(StreamsLab, { props: props() });
		expect(said(container)).toContain('a write changes data and a delete removes it');
	});
});
