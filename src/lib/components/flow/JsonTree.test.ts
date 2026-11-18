// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import JsonTree from './JsonTree.svelte';

afterEach(cleanup);

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, '');

describe('JsonTree', () => {
	it('opens the two top levels and prints each scalar as JSON', () => {
		const { container } = render(JsonTree, { props: { value: [{ id: 7, name: 'Ada', active: true, note: null }] } });
		expect(text(container)).toContain('[1]0:{4}id:7name:"Ada"active:truenote:null');
	});

	it('eases the hover color of a toggle rather than switching it in a frame', () => {
		render(JsonTree, { props: { value: { order: { id: 1 } } } });
		expect(screen.getByRole('button', { name: /order/ }).classList).toContain('transition-colors');
	});

	it('keeps a third level folded until it is opened', async () => {
		const { container } = render(JsonTree, { props: { value: { order: { customer: { email: 'a@example.com' } } } } });
		expect(container.textContent).not.toContain('a@example.com');
		const folded = screen.getByRole('button', { name: /customer/ });
		expect(folded.getAttribute('aria-expanded')).toBe('false');
		await fireEvent.click(folded);
		expect(container.textContent).toContain('"a@example.com"');
	});

	it('folds an open level on a click', async () => {
		const { container } = render(JsonTree, { props: { value: { a: 1 } } });
		expect(text(container)).toContain('a:1');
		await fireEvent.click(screen.getByRole('button', { name: /\{1\}/ }));
		expect(text(container)).not.toContain('a:1');
	});

	it('says an empty list is empty', () => {
		const { container } = render(JsonTree, { props: { value: [] } });
		expect(container.textContent).toContain('empty');
	});
});
