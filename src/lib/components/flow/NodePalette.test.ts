// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NodePalette from './NodePalette.svelte';
import { builtinCatalog, fixtureCatalog, withLocked } from '#lib/flow/fixtures.ts';

afterEach(cleanup);

describe('NodePalette', () => {
	it('keeps the search above the list and counts each category', () => {
		const { getByTestId, getByRole } = render(NodePalette, { props: { catalog: fixtureCatalog, onadd: vi.fn() } });
		expect(getByTestId('node-palette').firstElementChild?.className).toContain('sticky');
		expect(getByRole('button', { name: /^Data/ }).textContent).toContain('3');
	});

	it('names the dragged type on its own ghost', async () => {
		const { getByTestId, container } = render(NodePalette, { props: { catalog: fixtureCatalog, onadd: vi.fn() } });
		const card = container.querySelector('[data-node-type="data.join"]') as HTMLElement;
		const setDragImage = vi.fn();
		const dataTransfer = { setData: vi.fn(), setDragImage, effectAllowed: '' };
		await fireEvent.dragStart(card, { dataTransfer });
		expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-flow-node', 'data.join');
		expect(setDragImage).toHaveBeenCalled();
		expect(getByTestId('palette-drag-ghost').textContent?.trim()).toBe('Join');
	});

	it('adds a type on click and on Enter', async () => {
		const onadd = vi.fn();
		const { container } = render(NodePalette, { props: { catalog: fixtureCatalog, onadd } });
		const card = container.querySelector('[data-node-type="data.join"]') as HTMLElement;
		await fireEvent.click(card);
		await fireEvent.keyDown(card, { key: 'Enter' });
		expect(onadd).toHaveBeenCalledTimes(2);
	});

	it('draws each type as one row of icon, name and type, with the description on hover only', () => {
		const { container } = render(NodePalette, { props: { catalog: fixtureCatalog, onadd: vi.fn() } });
		const row = container.querySelector('[data-node-type="data.join"]') as HTMLElement;
		const spec = fixtureCatalog.find((s) => s.type === 'data.join')!;
		expect(row.querySelector('svg')).toBeTruthy();
		expect(row.textContent).toContain('Join');
		expect(row.textContent).toContain('data.join');
		expect(row.textContent).not.toContain(spec.description);
		expect(row.className).not.toContain('border');
	});

	it('starts with the search and no heading above it', () => {
		const { getByTestId } = render(NodePalette, { props: { catalog: fixtureCatalog, onadd: vi.fn() } });
		const top = getByTestId('node-palette').firstElementChild as HTMLElement;
		expect(top.querySelector('h2')).toBeNull();
		expect(top.querySelector('input')).toBeTruthy();
	});

	it('lists contributed types in one section per plugin after the built-ins, marked as a plugin', () => {
		const { getByTestId, getByRole } = render(NodePalette, { props: { catalog: fixtureCatalog, onadd: vi.fn() } });
		const palette = getByTestId('node-palette');
		const sections = [...palette.querySelectorAll('section')].map((s) => s.getAttribute('aria-label'));
		expect(sections).toEqual(['Data', 'Transform', 'Control', 'Output', 'Email plugin']);
		const section = palette.querySelector('section[data-plugin="email"]') as HTMLElement;
		expect(section.querySelectorAll('[data-node-type]')).toHaveLength(2);
		expect(section.querySelector('[data-node-type="email.render"]')).toBeTruthy();
		const heading = getByRole('button', { name: /^Email plugin/ });
		expect(heading.textContent).toContain('plugin');
		expect(heading.textContent).not.toMatch(/\d/);
		// The neutral paint: the puzzle piece in the muted tone, on the heading and on every row.
		const row = section.querySelector('[data-node-type="email.send_template"] svg') as SVGElement;
		expect(row.getAttribute('class')).toContain('text-muted');
		expect(row.querySelector('path')?.getAttribute('d')).toBe(heading.querySelector('svg:nth-of-type(2) path')?.getAttribute('d'));
	});

	it('shows no plugin section when nothing is contributed', () => {
		const { getByTestId } = render(NodePalette, { props: { catalog: builtinCatalog, onadd: vi.fn() } });
		const sections = [...getByTestId('node-palette').querySelectorAll('section')].map((s) => s.getAttribute('aria-label'));
		expect(sections).toEqual(['Data', 'Transform', 'Control', 'Output']);
	});

	it('finds a contributed type by its label, its type and its plugin name', async () => {
		const { getByTestId, getByLabelText } = render(NodePalette, { props: { catalog: fixtureCatalog, onadd: vi.fn() } });
		const palette = getByTestId('node-palette');
		for (const q of ['Send email', 'email.send_template', 'email']) {
			await fireEvent.input(getByLabelText('Filter node types'), { target: { value: q } });
			expect(palette.querySelector('[data-node-type="email.send_template"]'), q).toBeTruthy();
			expect(palette.querySelector('[data-node-type="data.join"]'), q).toBeNull();
		}
	});
});

describe('NodePalette lock marker', () => {
	it('marks a type the plugin says is not enabled, and keeps it draggable', async () => {
		const onadd = vi.fn();
		const { container } = render(NodePalette, { props: { catalog: withLocked(fixtureCatalog, ['content.query']), onadd } });
		const row = container.querySelector('[data-node-type="content.query"]') as HTMLElement;
		expect(row.querySelector('[data-testid="node-locked"]')?.textContent).toContain('Not enabled on this instance');
		expect(row.getAttribute('draggable')).toBe('true');
		await fireEvent.click(row);
		expect(onadd).toHaveBeenCalledWith('content.query');
		const open = container.querySelector('[data-node-type="data.join"]') as HTMLElement;
		expect(open.querySelector('[data-testid="node-locked"]')).toBeNull();
	});

	it('marks nothing when every type is enabled, or when the catalog carries no flag', () => {
		const enabled = render(NodePalette, { props: { catalog: fixtureCatalog, onadd: vi.fn() } });
		expect(enabled.container.querySelector('[data-testid="node-locked"]')).toBeNull();
		cleanup();
		const unflagged = fixtureCatalog.map((s) => ({ ...s, enabled: undefined }));
		const older = render(NodePalette, { props: { catalog: unflagged, onadd: vi.fn() } });
		expect(older.container.querySelector('[data-testid="node-locked"]')).toBeNull();
	});
});
