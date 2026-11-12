// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '@sveltejs/kit';

const forms = vi.hoisted(() => ({ handlers: new Map<string, SubmitFunction>() }));
vi.mock('$app/forms', () => ({
	enhance: (el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.handlers.set(el.getAttribute('action') ?? '', fn);
		return { destroy() {} };
	},
}));
const nav = vi.hoisted(() => ({ invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => nav);

import RenameModal from './RenameModal.svelte';

afterEach(cleanup);
beforeEach(() => {
	forms.handlers.clear();
	nav.invalidateAll.mockClear();
});

async function answer(result: unknown) {
	const submit = forms.handlers.get('?/rename') as SubmitFunction;
	const after = (await submit({} as never)) as (a: unknown) => Promise<void>;
	await after({ result });
}

function setup(name: string | undefined = 'posts') {
	const onrenamed = vi.fn();
	const { component } = render(RenameModal, { props: { name, onrenamed } });
	return { onrenamed, show: () => flushSync(() => component.show()) };
}

describe('RenameModal', () => {
	it('opens on the current name, posts it as from, and waits for a new one', () => {
		const { show } = setup();
		expect(screen.queryByRole('dialog')).toBeNull();
		show();
		expect(screen.getByRole('dialog', { name: 'Rename posts' })).toBeTruthy();
		expect((screen.getByLabelText('New machine name') as HTMLInputElement).value).toBe('posts');
		const form = document.getElementById('schema-rename') as HTMLFormElement;
		expect(new FormData(form).get('from')).toBe('posts');
		expect((screen.getByRole('button', { name: 'Rename' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('opens for nothing that has not been saved', () => {
		const { show } = setup(undefined);
		show();
		expect(screen.queryByRole('dialog', { name: 'Rename content type' })).toBeNull();
	});

	it('enables Rename once the name changes', async () => {
		const { show } = setup();
		show();
		await fireEvent.input(screen.getByLabelText('New machine name'), { target: { value: 'articles' } });
		expect((screen.getByRole('button', { name: 'Rename' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('hands the stored schema back, closes and reloads', async () => {
		const { show, onrenamed } = setup();
		show();
		const stored = { name: 'articles', display_name: 'Posts', fields: [] };
		await answer({ type: 'success', data: { from: 'posts', saved: stored } });
		expect(onrenamed).toHaveBeenCalledWith('posts', stored);
		expect(screen.queryByRole('dialog', { name: 'Rename posts' })).toBeNull();
		expect(nav.invalidateAll).toHaveBeenCalled();
	});

	it('shows the refusal on the field and stays open', async () => {
		const { show, onrenamed } = setup();
		show();
		await answer({ type: 'failure', data: { error: 'A schema named articles exists.' } });
		expect(screen.getByText('A schema named articles exists.')).toBeTruthy();
		expect(screen.getByRole('dialog')).toBeTruthy();
		expect(onrenamed).not.toHaveBeenCalled();
	});
});
