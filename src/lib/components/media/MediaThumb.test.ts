// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import MediaThumb from './MediaThumb.svelte';
import type { MediaItem } from '#lib/api/media.ts';

afterEach(cleanup);

const item = (over: Partial<MediaItem> = {}): MediaItem => ({
	id: 'm1',
	key: 'uploads/m1.jpg',
	filename: 'harbor.jpg',
	content_type: 'image/jpeg',
	size: 2048,
	alt_text: 'Boats in the harbor',
	folder: '',
	uploaded_by: 'u1',
	created_at: '2026-10-01T00:00:00Z',
	...over,
});

describe('MediaThumb', () => {
	it('shows an image file as a picture with the alt text the operator wrote', () => {
		const { container } = render(MediaThumb, { props: { item: item() } });
		const img = container.querySelector('img') as HTMLImageElement;
		expect(img.getAttribute('src')).toContain('m1');
		expect(img.alt).toBe('Boats in the harbor');
	});

	it('shows a glyph for a file that is not an image', () => {
		const { container } = render(MediaThumb, { props: { item: item({ content_type: 'application/pdf' }) } });
		expect(container.querySelector('img')).toBeNull();
		expect(container.querySelector('svg')).not.toBeNull();
	});

	it('falls back to the glyph when the picture cannot be loaded', async () => {
		const { container } = render(MediaThumb, { props: { item: item() } });
		await fireEvent.error(container.querySelector('img') as HTMLImageElement);
		expect(container.querySelector('img')).toBeNull();
		expect(container.querySelector('svg')).not.toBeNull();
	});
});
