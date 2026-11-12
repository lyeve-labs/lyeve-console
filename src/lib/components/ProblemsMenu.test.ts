// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProblemsMenu from './ProblemsMenu.svelte';

afterEach(cleanup);

const problems = [
	{ key: 'a', where: 'New relation field, row 3', what: 'Name the field.' },
	{ key: 'b', where: 'New relation field, row 3', what: 'Pick the content type this relation points at.' },
];

function setup(list = problems) {
	const onjump = vi.fn();
	const result = render(ProblemsMenu, { props: { problems: list, title: 'Fix these before saving', id: 'p-list', onjump } });
	return { ...result, onjump };
}

describe('ProblemsMenu', () => {
	it('renders nothing while there is no problem', () => {
		const { container } = setup([]);
		expect(container.querySelector('button')).toBeNull();
	});

	it('opens a list of where and what from the count', async () => {
		const { getByRole, getByTestId, queryByTestId } = setup();
		const trigger = getByRole('button', { name: '2 problems' });
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(queryByTestId('p-list')).toBeNull();
		await fireEvent.click(trigger);
		expect(trigger.getAttribute('aria-expanded')).toBe('true');
		const list = getByTestId('p-list');
		expect(list.getAttribute('aria-label')).toBe('Fix these before saving');
		expect(list.textContent).toContain('New relation field, row 3');
		expect(list.textContent).toContain('Pick the content type this relation points at.');
	});

	it('jumps to the problem picked and closes', async () => {
		const { getByRole, queryByTestId, onjump } = setup();
		await fireEvent.click(getByRole('button', { name: '2 problems' }));
		await fireEvent.click(getByRole('button', { name: /Pick the content type/ }));
		expect(onjump).toHaveBeenCalledWith(problems[1]);
		await new Promise((r) => setTimeout(r, 0));
		expect(queryByTestId('p-list')).toBeNull();
	});

	it('closes on Escape and hands focus back to the count', async () => {
		const { getByRole, getByTestId } = setup();
		const trigger = getByRole('button', { name: '2 problems' });
		await fireEvent.click(trigger);
		await fireEvent.keyDown(getByTestId('p-list'), { key: 'Escape' });
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(trigger);
	});

	it('closes on a press outside it', async () => {
		const { getByRole } = setup();
		const trigger = getByRole('button', { name: '2 problems' });
		await fireEvent.click(trigger);
		await fireEvent.pointerDown(document.body);
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
	});
});
