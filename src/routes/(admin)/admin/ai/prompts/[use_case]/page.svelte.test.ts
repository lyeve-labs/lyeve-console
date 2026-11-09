// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';
import { fixtureDefaultPrompt, fixturePrompt, fixtureSettings } from '$lib/components/ai/test-support/fixtures';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

function setup(overrides: Record<string, unknown> = {}, form: unknown = null) {
	return render(Page, {
		props: {
			data: { gate: { state: 'ok' }, prompt: fixturePrompt, aiSettings: fixtureSettings, aiLayoutGate: { state: 'ok' }, isSuperAdmin: false, ...overrides },
			form,
		} as never,
	});
}

describe('AI prompt page', () => {
	it('seeds the editor with the text in force and names the next version', () => {
		const { container, getByText } = setup();
		expect((container.querySelector('textarea[name="body"]') as HTMLTextAreaElement).value).toBe('Summarize in three bullets.');
		expect(getByText('Save as version 3')).toBeTruthy();
		expect(getByText('Using version 2')).toBeTruthy();
	});

	it('lists the versions with the shipped default as v0 and a restore on every one but the current', () => {
		const { container, getByLabelText, queryByLabelText } = setup();
		const rows = container.querySelectorAll('tbody tr');
		expect(rows).toHaveLength(3);
		expect(rows[0].textContent).toContain('v2');
		expect(rows[0].textContent).toContain('current');
		expect(rows[2].textContent).toContain('v0');
		expect(rows[2].textContent).toContain('shipped');
		expect(queryByLabelText('Make version 2 current')).toBeNull();
		expect(getByLabelText('Make version 1 current')).toBeTruthy();
		expect(getByLabelText('Make the shipped default current')).toBeTruthy();
		expect(container.textContent).toContain(fixturePrompt.guardrail);
	});

	it('marks the shipped default current when nothing was saved', () => {
		const { getByText, queryByLabelText, container } = setup({ prompt: fixtureDefaultPrompt });
		expect(getByText('Using the default prompt')).toBeTruthy();
		expect(getByText('Save as version 1')).toBeTruthy();
		expect(queryByLabelText('Make the shipped default current')).toBeNull();
		expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
	});

	it('reports a save and a restore', async () => {
		const saved = setup({}, { scope: 'save', version: 3 });
		const region = (c: HTMLElement) => c.querySelector('[aria-live="polite"]');
		await waitFor(() => expect(region(saved.container)?.textContent).toContain('Saved as version 3.'));
		cleanup();
		const restored = setup({}, { scope: 'restore', version: 3, from: 1 });
		await waitFor(() => expect(region(restored.container)?.textContent).toContain('Version 1 restored as version 3.'));
	});

	// A reload that hands back the same text in force is not a new version.
	it('keeps what the reader typed when the page data reloads with the same text', async () => {
		const { container, rerender } = setup();
		const box = container.querySelector('textarea[name="body"]') as HTMLTextAreaElement;
		await fireEvent.input(box, { target: { value: 'Summarize in two bullets.' } });

		await rerender({
			data: { gate: { state: 'ok' }, prompt: { ...fixturePrompt }, aiSettings: { ...fixtureSettings }, aiLayoutGate: { state: 'ok' }, isSuperAdmin: false },
			form: null,
		} as never);

		expect((container.querySelector('textarea[name="body"]') as HTMLTextAreaElement).value).toBe('Summarize in two bullets.');
	});

	// A restore saves a new version even when its text matches the one in
	// force, and the editor shows what is in force after it.
	it('reseeds the editor when a restore brings in a new version with the same text', async () => {
		const { container, rerender } = setup();
		const box = container.querySelector('textarea[name="body"]') as HTMLTextAreaElement;
		await fireEvent.input(box, { target: { value: 'Summarize in two bullets.' } });

		await rerender({
			data: { gate: { state: 'ok' }, prompt: { ...fixturePrompt, active_version: 3 }, aiSettings: fixtureSettings, aiLayoutGate: { state: 'ok' }, isSuperAdmin: false },
			form: { scope: 'restore', version: 3, from: 2 },
		} as never);

		expect((container.querySelector('textarea[name="body"]') as HTMLTextAreaElement).value).toBe('Summarize in three bullets.');
	});

	it('paints the locked state and no editor', () => {
		const { container, getByText } = setup({ gate: { state: 'locked' }, prompt: null });
		expect(getByText('Not enabled on this engine.')).toBeTruthy();
		expect(container.querySelector('textarea')).toBeNull();
	});
});
