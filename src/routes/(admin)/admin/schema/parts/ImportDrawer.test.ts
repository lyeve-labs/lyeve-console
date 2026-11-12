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

import ImportDrawer from './ImportDrawer.svelte';

afterEach(cleanup);
beforeEach(() => {
	forms.handlers.clear();
	nav.invalidateAll.mockClear();
	HTMLFormElement.prototype.requestSubmit = vi.fn();
});

async function answer(result: unknown) {
	const submit = forms.handlers.get('?/import') as SubmitFunction;
	const after = (await submit({} as never)) as (a: unknown) => Promise<void>;
	await after({ result });
}

function setup() {
	const { component } = render(ImportDrawer);
	flushSync(() => component.show());
}

const plan = {
	applied: false,
	plan: { schemas: [{ name: 'articles', action: 'create', ddl: ['CREATE TABLE _articles ()'] }] },
	// The engine keys a rename by the name it ends with and writes the line
	// out as its value.
	renamed: { blog_post: 'Blog Post -> blog_post', 'product.product_name': 'productName -> product_name' },
	notes: [{ schema: 'articles', field: 'body', message: 'Rich text becomes text.' }],
};

describe('ImportDrawer', () => {
	it('opens on Check, off until there is a file or a paste', async () => {
		setup();
		const check = screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement;
		expect(check.disabled).toBe(true);
		await fireEvent.input(screen.getByLabelText('Or paste the definitions'), { target: { value: 'schemas: []' } });
		expect(check.disabled).toBe(false);
	});

	it('posts the check without the apply flag, then the run with it', async () => {
		setup();
		await fireEvent.input(screen.getByLabelText('Or paste the definitions'), { target: { value: 'schemas: []' } });
		const form = document.getElementById('schema-import-form') as HTMLFormElement;
		await fireEvent.click(screen.getByRole('button', { name: 'Check' }));
		expect(new FormData(form).get('apply')).toBe('false');
		await answer({ type: 'success', data: plan });
		await fireEvent.click(screen.getByRole('button', { name: 'Import' }));
		expect(new FormData(form).get('apply')).toBe('true');
		expect(HTMLFormElement.prototype.requestSubmit).toHaveBeenCalledTimes(2);
	});

	it('shows the plan, the renames and the notes before anything runs', async () => {
		setup();
		await answer({ type: 'success', data: plan });
		const shown = screen.getByTestId('import-plan');
		expect(shown.textContent).toContain('articles');
		expect(shown.textContent).toContain('Creates');
		expect(shown.textContent).toContain('Blog Post to blog_post');
		expect(shown.textContent).toContain('product.productName to product_name');
		expect(shown.textContent).not.toContain('->');
		expect(shown.textContent).toContain('articles.body: Rich text becomes text.');
	});

	it('offers no import while a content type points at one that is not here', async () => {
		setup();
		await answer({ type: 'success', data: { ...plan, plan: { schemas: [{ name: 'articles', action: 'create', missing: ['authors'] }] } } });
		expect(screen.getByText(/articles depends on a content type that is in neither the file nor this instance/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
	});

	it('throws the plan away once the paste changes', async () => {
		setup();
		await answer({ type: 'success', data: plan });
		await fireEvent.input(screen.getByLabelText('Or paste the definitions'), { target: { value: 'changed' } });
		expect(screen.queryByTestId('import-plan')).toBeNull();
	});

	it('shows a refusal at the top of the form, above the fields', async () => {
		setup();
		await answer({ type: 'failure', data: { error: 'The file is not YAML.' } });
		const message = screen.getByText('The file is not YAML.');
		const form = message.closest('form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/import');
		const firstField = form.querySelector('#import-source, [id^="import-source"]') as HTMLElement;
		expect(message.compareDocumentPosition(firstField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('closes and reloads once the import ran', async () => {
		setup();
		await answer({ type: 'success', data: { ...plan, applied: true } });
		expect(screen.queryByRole('button', { name: 'Check' })).toBeNull();
		expect(nav.invalidateAll).toHaveBeenCalled();
	});

	it('starts from no plan when opened again', async () => {
		const { component } = render(ImportDrawer);
		flushSync(() => component.show());
		await answer({ type: 'failure', data: { error: 'The file is not YAML.' } });
		flushSync(() => component.show());
		expect(screen.queryByText('The file is not YAML.')).toBeNull();
	});
});
