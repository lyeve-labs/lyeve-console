import { describe, it, expect } from 'vitest';
import {
	formatDimensions,
	mediaFileUrl,
	mediaKind,
	mediaKindLabel,
	mediaThumbnailUrl,
	importRefusal,
	isForeignAddress,
} from './media';

describe('mediaFileUrl', () => {
	// /api/admin/media/{id} answers the JSON record, not the file. An <img>
	// pointed at it draws nothing. The bytes live at the download route.
	it('points at the download route, not the metadata record', () => {
		expect(mediaFileUrl('7f1c9d3e-0000-4000-8000-00000000abcd')).toBe(
			'/api/admin/media/7f1c9d3e-0000-4000-8000-00000000abcd/download'
		);
	});

	it('encodes the id so a hostile value cannot escape its path segment', () => {
		expect(mediaFileUrl('a/b?c=1')).toBe('/api/admin/media/a%2Fb%3Fc%3D1/download');
	});

	it('returns an empty string for a missing id rather than a route that 404s', () => {
		expect(mediaFileUrl('')).toBe('');
	});
});

describe('mediaKind', () => {
	it('sorts a content type into the family the library previews', () => {
		expect(mediaKind('image/png')).toBe('image');
		expect(mediaKind('IMAGE/JPEG')).toBe('image');
		expect(mediaKind('video/webm')).toBe('video');
		expect(mediaKind('audio/mpeg')).toBe('audio');
		expect(mediaKind('application/pdf')).toBe('pdf');
		expect(mediaKind('text/plain')).toBe('other');
		expect(mediaKind('')).toBe('other');
	});

	it('names each family', () => {
		expect(mediaKindLabel('image')).toBe('Image');
		expect(mediaKindLabel('video')).toBe('Video');
		expect(mediaKindLabel('audio')).toBe('Audio');
		expect(mediaKindLabel('pdf')).toBe('PDF');
		expect(mediaKindLabel('other')).toBe('File');
	});
});

describe('mediaThumbnailUrl', () => {
	// The engine's derivatives are served only from a storage base URL, which a
	// local-disk install leaves unset, so the original through the download
	// route is the one thumbnail source that answers everywhere.
	it('points an image at its download route', () => {
		expect(mediaThumbnailUrl({ id: 'm1', content_type: 'image/png' })).toBe(
			'/api/admin/media/m1/download'
		);
	});

	it('offers nothing to draw for a file that is not an image', () => {
		expect(mediaThumbnailUrl({ id: 'm1', content_type: 'video/mp4' })).toBe('');
		expect(mediaThumbnailUrl({ id: 'm1', content_type: 'application/pdf' })).toBe('');
	});
});

describe('formatDimensions', () => {
	it('prints width by height when the engine recorded both', () => {
		expect(formatDimensions({ width: 1920, height: 1080 })).toBe('1920 x 1080');
	});

	it('prints nothing when either side is unknown', () => {
		expect(formatDimensions({})).toBe('');
		expect(formatDimensions({ width: 100 })).toBe('');
		expect(formatDimensions({ width: 0, height: 0 })).toBe('');
	});
});

describe('importing by address', () => {
	it('tells another site from this engine', () => {
		expect(isForeignAddress('https://images.example.com/logo.png')).toBe(true);
		expect(isForeignAddress('/api/v1/media/m1/logo.png')).toBe(false);
	});

	it('turns the firewall refusal into what to change', () => {
		expect(importRefusal('request blocked by WAF')).toBe('That address is private or not allowed.');
		expect(importRefusal('the file is larger than 500000 bytes')).toBe('the file is larger than 500000 bytes');
	});
});
