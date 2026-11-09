// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MediaGrid from './MediaGrid.svelte';
import { AUDIO, IMAGE, ONE_OF_EACH, PDF, TEXT, VIDEO } from './test-support/fixtures';

afterEach(cleanup);

function setup(items = ONE_OF_EACH) {
	const onselect = vi.fn();
	const result = render(MediaGrid, { props: { items, onselect } });
	return { ...result, onselect };
}

function tileOf(container: HTMLElement, filename: string): HTMLElement {
	const tile = [...container.querySelectorAll<HTMLElement>('[role="button"]')].find((el) =>
		(el.textContent ?? '').includes(filename)
	);
	if (!tile) throw new Error(`no tile for ${filename}`);
	return tile;
}

describe('MediaGrid', () => {
	it('draws an image tile from the file itself, lazily and covering the square', () => {
		const { container } = setup([IMAGE]);
		const img = tileOf(container, 'photo.png').querySelector('img') as HTMLImageElement;
		expect(img.getAttribute('src')).toBe('/api/admin/media/m-image/download');
		expect(img.getAttribute('loading')).toBe('lazy');
		expect(img.className).toContain('object-cover');
		expect(tileOf(container, 'photo.png').querySelector('[data-kind]')?.className).toContain(
			'aspect-square'
		);
	});

	it('draws a type glyph and no image for video, audio, PDF and other files', () => {
		const { container } = setup();
		for (const item of [VIDEO, AUDIO, PDF, TEXT]) {
			const tile = tileOf(container, item.filename);
			expect(tile.querySelector('img')).toBeNull();
			expect(tile.querySelector('svg')).not.toBeNull();
		}
		expect(tileOf(container, 'clip.webm').querySelector('[data-kind]')?.getAttribute('data-kind')).toBe('video');
		expect(tileOf(container, 'track.mp3').querySelector('[data-kind]')?.getAttribute('data-kind')).toBe('audio');
		expect(tileOf(container, 'invoice.pdf').querySelector('[data-kind]')?.getAttribute('data-kind')).toBe('pdf');
		expect(tileOf(container, 'notes.txt').querySelector('[data-kind]')?.getAttribute('data-kind')).toBe('other');
	});

	it('names each tile by the file and its size', () => {
		const { container } = setup([VIDEO]);
		expect(tileOf(container, 'clip.webm').textContent).toContain('3.0 MB');
	});

	it('reports the item a tile was chosen for, by pointer and by keyboard', async () => {
		const { container, onselect } = setup();
		await fireEvent.click(tileOf(container, 'invoice.pdf'));
		expect(onselect).toHaveBeenLastCalledWith(PDF);
		await fireEvent.keyDown(tileOf(container, 'track.mp3'), { key: 'Enter' });
		expect(onselect).toHaveBeenLastCalledWith(AUDIO);
	});

	it('keeps the tile free of inline image handlers the CSP would refuse', () => {
		const { container } = setup([IMAGE]);
		const img = container.querySelector('img') as HTMLImageElement;
		expect(img.getAttribute('onerror')).toBeNull();
		expect(img.getAttribute('onload')).toBeNull();
	});

	it('is two columns at the narrowest width', () => {
		const { getByTestId } = setup();
		expect(getByTestId('media-grid').className).toContain('grid-cols-2');
	});
});
