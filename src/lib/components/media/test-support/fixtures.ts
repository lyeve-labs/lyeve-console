import type { MediaItem } from '$lib/api/media';

/** One item per family the library draws differently. */
export function mediaFixture(overrides: Partial<MediaItem> = {}): MediaItem {
	return {
		id: 'm-image',
		key: 'uploads/photo.png',
		filename: 'photo.png',
		content_type: 'image/png',
		size: 2048,
		alt_text: '',
		folder: '',
		uploaded_by: 'u1',
		created_at: '2026-01-02T03:04:05Z',
		width: 640,
		height: 480,
		...overrides,
	};
}

export const IMAGE = mediaFixture();
export const VIDEO = mediaFixture({
	id: 'm-video',
	key: 'uploads/clip.webm',
	filename: 'clip.webm',
	content_type: 'video/webm',
	size: 3 * 1048576,
	width: undefined,
	height: undefined,
});
export const AUDIO = mediaFixture({
	id: 'm-audio',
	key: 'uploads/track.mp3',
	filename: 'track.mp3',
	content_type: 'audio/mpeg',
	size: 512,
	width: undefined,
	height: undefined,
});
export const PDF = mediaFixture({
	id: 'm-pdf',
	key: 'uploads/invoice.pdf',
	filename: 'invoice.pdf',
	content_type: 'application/pdf',
	size: 100_000,
	width: undefined,
	height: undefined,
});
export const TEXT = mediaFixture({
	id: 'm-text',
	key: 'uploads/notes.txt',
	filename: 'notes.txt',
	content_type: 'text/plain',
	size: 10,
	width: undefined,
	height: undefined,
});

export const ONE_OF_EACH = [IMAGE, VIDEO, AUDIO, PDF, TEXT];
