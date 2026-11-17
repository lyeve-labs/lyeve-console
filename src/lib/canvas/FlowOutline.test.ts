// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import FlowOutline from './FlowOutline.svelte';
import { fixtureCatalog, fixtureRun, joinFlow } from '#lib/flow/fixtures.ts';
import type { FlowDefinition } from '#lib/flow/types.ts';

afterEach(cleanup);

function setup(props: Record<string, unknown> = {}) {
	const onchange = vi.fn<(def: FlowDefinition) => void>();
	const onhistory = vi.fn();
	const view = render(FlowOutline, { props: { definition: joinFlow, catalog: fixtureCatalog, onchange, onhistory, ...props } });
	const last = () => onchange.mock.calls.at(-1)?.[0] as FlowDefinition;
	return { ...view, onchange, onhistory, last };
}

const rowIds = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-node-id]')].map((el) => el.dataset.nodeId);
const row = (container: HTMLElement, id: string) => container.querySelector(`[data-node-id="${id}"]`) as HTMLElement;

describe('flow outline', () => {
	it('lists the trigger, then each node in run order, then the notes', () => {
		const { container } = setup();
		expect(rowIds(container)).toEqual(['trigger', 'orders', 'shipments', 'join']);
		expect(container.querySelector('[data-note-id="n1"]')?.textContent).toContain('Cached 30s per customer');
		expect(row(container, 'orders').textContent).toContain('Load orders');
		expect(row(container, 'orders').textContent).toContain('schema');
	});

	it('selects the row picked, and the flow settings for the trigger', async () => {
		const { container } = setup();
		const pick = (id: string) => row(container, id).querySelector('button') as HTMLButtonElement;
		expect(pick('trigger').getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(pick('join'));
		expect(pick('join').getAttribute('aria-pressed')).toBe('true');
		expect(row(container, 'join').className).toContain('border-brand');
		await fireEvent.click(pick('trigger'));
		expect(pick('trigger').getAttribute('aria-pressed')).toBe('true');
	});

	it('shows a validation error on the node it names and the run outcome on each step', () => {
		const { container } = setup({ errors: [{ node_id: 'join', path: '/config/left_key', message: 'required' }], runSteps: fixtureRun.steps });
		expect(row(container, 'join').className).toContain('border-danger');
		expect(row(container, 'join').textContent).toContain('Left key is required.');
		expect(row(container, 'join').textContent).toContain('failed');
		expect(row(container, 'orders').textContent).toContain('ok');
	});

	it('disconnects a source and connects another through the port select', async () => {
		const { container, getByRole, last } = setup();
		await fireEvent.click(getByRole('button', { name: 'Disconnect Load orders from Join' }));
		expect(last().edges).toEqual([{ from: 'shipments', to: 'join', to_port: 'right' }]);

		await fireEvent.click(within(row(container, 'join')).getByRole('combobox', { name: /Input left/i }));
		await fireEvent.click(getByRole('option', { name: 'Load orders' }));
		expect(last().edges).toContainEqual({ from: 'orders', to: 'join', to_port: 'left' });
	});

	it('offers only the sources the graph rules allow', async () => {
		const { container, getAllByRole } = setup();
		// Each join input takes one edge and has it, so neither offers a source.
		expect(within(row(container, 'join')).queryAllByRole('combobox')).toEqual([]);
		// A node never offers itself or anything downstream of it.
		await fireEvent.click(within(row(container, 'orders')).getByRole('combobox', { name: /Input/ }));
		const labels = getAllByRole('option').map((o) => o.textContent?.trim());
		expect(labels).toContain('Load shipments');
		expect(labels).not.toContain('Load orders');
		expect(labels).not.toContain('Join');
	});

	it('adds a node below the lowest one and moves nothing that was there', () => {
		const { component, last } = setup();
		component.addNodeAtCenter('data.join');
		const next = last();
		expect(next.nodes).toHaveLength(4);
		expect(next.nodes.at(-1)?.position).toEqual({ x: 120, y: 580 });
		expect(next.nodes.slice(0, 3).map((n) => n.position)).toEqual(joinFlow.nodes.map((n) => n.position));
	});

	it('deletes the selection with its edges', async () => {
		const { container, component, last } = setup();
		await fireEvent.click(row(container, 'join').querySelector('button') as HTMLButtonElement);
		component.deleteSelection();
		expect(last().nodes.map((n) => n.id)).toEqual(['orders', 'shipments']);
		expect(last().edges).toEqual([]);
	});

	it('reports no history and answers the viewport calls without a change', () => {
		const { component, onchange, onhistory } = setup();
		expect(onhistory).toHaveBeenCalledWith({ canUndo: false, canRedo: false });
		component.undo();
		component.redo();
		component.autoLayout();
		component.fit();
		component.openingFit();
		component.reveal('join');
		expect(onchange).not.toHaveBeenCalled();
	});

	it('shows the page empty state while the flow has no nodes', () => {
		const empty = createRawSnippet(() => ({ render: () => '<p>Pick a way in</p>' }));
		const { getByTestId } = setup({ definition: { ...joinFlow, nodes: [], edges: [], notes: [] }, empty });
		expect(getByTestId('outline-empty').textContent).toContain('Pick a way in');
	});
});
