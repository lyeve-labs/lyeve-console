// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import TransformField from './TransformField.svelte';
import type { TransformDraft } from '$lib/api/bulk-import';

afterEach(cleanup);

const blank = (over: Partial<TransformDraft> = {}): TransformDraft => ({
	transform: '',
	layout: '',
	outputLayout: '',
	separator: '',
	lookup: '',
	fallback: '',
	...over,
});

function setup(draft: TransformDraft, licensed: boolean | null = null) {
	return render(TransformField, { props: { draft, id: 'm1', label: 'Transform', licensed } });
}

describe('TransformField', () => {
	it('asks no options of a transform that needs none', () => {
		setup(blank({ transform: 'trim' }));
		expect(screen.queryByLabelText(/Written as/)).toBeNull();
		expect(screen.queryByLabelText(/Separator/)).toBeNull();
		expect(screen.queryByLabelText(/Lookup/)).toBeNull();
	});

	it('asks a date for how it is written and how to store it', () => {
		setup(blank({ transform: 'date', layout: '02/01/2006' }));
		expect((screen.getByLabelText(/Written as/) as HTMLInputElement).value).toBe('02/01/2006');
		expect(screen.getByLabelText(/Stored as/)).toBeTruthy();
	});

	it('asks a split for its separator and a lookup for its pairs and fallback', () => {
		setup(blank({ transform: 'split' }));
		expect(screen.getByLabelText(/Separator/)).toBeTruthy();
		cleanup();
		setup(blank({ transform: 'lookup' }));
		expect(screen.getByLabelText(/^Lookup/)).toBeTruthy();
		expect(screen.getByLabelText(/For any other value/)).toBeTruthy();
	});

	it('writes what the reader types back into the draft', async () => {
		const draft = blank({ transform: 'split' });
		setup(draft);
		await fireEvent.input(screen.getByLabelText(/Separator/), { target: { value: ';' } });
		expect(draft.separator).toBe(';');
	});

	it('marks the transforms a license is needed for when the engine has none', async () => {
		setup(blank(), false);
		await fireEvent.click(document.getElementById('m1-transform') as HTMLElement);
		const names = screen.getAllByRole('option').map((o) => o.textContent?.trim());
		expect(names).toContain('Parse a date, needs a license');
		expect(names).toContain('Trim spaces');
	});

	it('marks nothing when the license is unknown', async () => {
		setup(blank(), null);
		await fireEvent.click(document.getElementById('m1-transform') as HTMLElement);
		expect(screen.getAllByRole('option').map((o) => o.textContent?.trim())).toContain('Parse a date');
	});
});
