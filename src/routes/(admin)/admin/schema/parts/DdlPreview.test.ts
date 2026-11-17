// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Change } from '#lib/schema/editor.ts';
import DdlPreview from './DdlPreview.svelte';

afterEach(cleanup);

const none: Change = { renames: [], retypes: [], drops: [], systemDrops: [] } as unknown as Change;

function setup(props: Record<string, unknown> = {}) {
	const onclose = vi.fn();
	const onsave = vi.fn();
	render(DdlPreview, {
		props: { statements: [], error: '', risk: false, change: none, rowsAtRisk: undefined, table: 'posts', saving: false, onclose, onsave, ...props },
	});
	return { onclose, onsave };
}

describe('DdlPreview', () => {
	it('draws nothing until the preview answers', () => {
		setup({ statements: null });
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('shows each statement with its undo in the read-only preview', async () => {
		const { onclose } = setup({
			statements: [{ description: 'drop column x', sql: 'ALTER TABLE t DROP x', down_sql: 'ALTER TABLE t ADD x', destructive: true }],
		});
		expect(screen.getByRole('dialog', { name: 'Preview DDL' })).toBeTruthy();
		const [stmt] = screen.getAllByTestId('ddl-statement');
		expect(stmt.getAttribute('data-destructive')).toBe('true');
		expect(stmt.textContent).toContain('1. drop column x');
		expect(stmt.textContent).toContain('Queued');
		expect(stmt.textContent).toContain('Down SQL');
		// The kit disclosure, not the browser's own details marker.
		expect(stmt.querySelector('details')).toBeNull();
		const down = screen.getByRole('button', { name: /Down SQL/ });
		expect(down.getAttribute('aria-expanded')).toBe('false');
		await fireEvent.click(down);
		expect(stmt.textContent).toContain('ALTER TABLE t ADD x');
		// The dialog's own corner button is named Close too. The footer's says it.
		const footerClose = screen.getAllByRole('button', { name: 'Close' }).find((b) => b.textContent?.trim() === 'Close') as HTMLElement;
		await fireEvent.click(footerClose);
		expect(onclose).toHaveBeenCalled();
	});

	it('says a table already matches when there is nothing to run', () => {
		setup();
		expect(screen.getByText('No DDL changes. The table already matches this definition.')).toBeTruthy();
	});

	/*
	 * A save runs each rename through its own route before the definition, so
	 * the engine is asked about the rest only. The rename is still the change a
	 * reader most needs to see, and "No DDL changes" called it harmless.
	 */
	it('names a rename in the read-only preview when nothing else changes', () => {
		setup({ change: { ...none, renames: [{ from: 'title', to: 'headline' }] } });
		const dialog = screen.getByRole('dialog', { name: 'Preview DDL' });
		expect(dialog.textContent).toContain('Renames title to headline.');
		expect(dialog.textContent).not.toContain('No DDL changes');
	});

	it('names each rename beside the statements for the rest of the definition', () => {
		setup({
			change: { ...none, renames: [{ from: 'title', to: 'headline' }, { from: 'body', to: 'content' }] },
			statements: [{ description: 'add column _posts.slug', sql: 'ALTER TABLE t ADD slug' }],
		});
		const dialog = screen.getByRole('dialog', { name: 'Preview DDL' });
		expect(dialog.textContent).toContain('Renames title to headline.');
		expect(dialog.textContent).toContain('Renames body to content.');
		expect(screen.getAllByTestId('ddl-statement')).toHaveLength(1);
		expect(dialog.textContent).toContain('The renames run first. Then:');
	});

	it('asks before a save that drops a column, and never calls an unread count zero', async () => {
		const { onsave } = setup({
			risk: true,
			change: { ...none, drops: ['meta'] },
			statements: [{ description: 'drop column meta', sql: 'DROP meta', destructive: true }],
		});
		const dialog = screen.getByTestId('save-risk');
		expect(dialog.textContent).toContain('Could not count the rows in posts.');
		expect(dialog.textContent).toContain('Removes meta from the definition.');
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(onsave).toHaveBeenCalledTimes(1);
	});

	it('names the rows it read and runs the renames first', () => {
		setup({
			risk: true,
			rowsAtRisk: 1,
			change: { ...none, renames: [{ from: 'a', to: 'b' }] },
			statements: [{ description: 'add column c', sql: 'ADD c' }],
		});
		const dialog = screen.getByTestId('save-risk');
		expect(dialog.textContent).toContain('posts has 1 row.');
		expect(dialog.textContent).toContain('Renames a to b.');
		expect(dialog.textContent).toContain('The renames run first. Then:');
	});

	it('keeps Save off while the preview failed', () => {
		setup({ risk: true, change: { ...none, retypes: [{ name: 'n', from: 'text', to: 'number' }] }, error: 'The DDL could not be previewed.' });
		expect(screen.getByText('The DDL could not be previewed.')).toBeTruthy();
		expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
	});
});
