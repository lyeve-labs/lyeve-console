// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MediaTable from './MediaTable.svelte';
import { IMAGE, ONE_OF_EACH, PDF } from './test-support/fixtures';

afterEach(cleanup);

function setup(items = ONE_OF_EACH) {
	const onselect = vi.fn();
	const result = render(MediaTable, { props: { items, onselect } });
	return { ...result, onselect };
}

function rowOf(filename: string): HTMLTableRowElement {
	return screen.getByRole('button', { name: filename }).closest('tr') as HTMLTableRowElement;
}

describe('MediaTable', () => {
	it('lists every file with a thumbnail cell, its type, size and upload time', () => {
		setup();
		expect(screen.getByTestId('media-list').querySelectorAll('tr')).toHaveLength(5);
		const row = rowOf('photo.png');
		const thumb = row.querySelector('[data-kind="image"] img') as HTMLImageElement;
		expect(thumb.getAttribute('src')).toBe('/api/admin/media/m-image/download');
		expect(row.textContent).toContain('Image');
		expect(row.textContent).toContain('2.0 KB');
		expect(row.textContent).toContain('2026');
	});

	it('draws a glyph in the thumbnail cell of a file that is not an image', () => {
		setup();
		for (const [name, kind] of [
			['clip.webm', 'video'],
			['track.mp3', 'audio'],
			['invoice.pdf', 'pdf'],
			['notes.txt', 'other'],
		]) {
			const cell = rowOf(name).querySelector('[data-kind]') as HTMLElement;
			expect(cell.getAttribute('data-kind')).toBe(kind);
			expect(cell.querySelector('img')).toBeNull();
			expect(cell.querySelector('svg')).not.toBeNull();
		}
		expect(rowOf('invoice.pdf').textContent).toContain('PDF');
		expect(rowOf('notes.txt').textContent).toContain('File');
	});

	it('opens the file whose name was pressed', async () => {
		const { onselect } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'invoice.pdf' }));
		expect(onselect).toHaveBeenCalledWith(PDF);
		await fireEvent.click(screen.getByRole('button', { name: 'photo.png' }));
		expect(onselect).toHaveBeenLastCalledWith(IMAGE);
	});
});

describe('the filename control', () => {
	// The filename is the only way to open a file from the table. The box that
	// grows it under a finger is drawn outside the button, so the button
	// itself must not clip it.
	it('gives the filename a touch hit area that its truncation does not clip', () => {
		setup([IMAGE]);
		const button = screen.getByRole('button', { name: 'photo.png' });
		const cls = button.className.split(/\s+/);
		expect(cls).toEqual(expect.arrayContaining(['relative', 'hit-area']));
		expect(cls).not.toContain('truncate');
		expect(button.querySelector('.truncate')?.textContent?.trim()).toBe('photo.png');
	});
});
