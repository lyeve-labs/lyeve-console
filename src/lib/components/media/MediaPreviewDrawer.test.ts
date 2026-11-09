// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '@sveltejs/kit';

vi.mock('$app/environment', () => ({ browser: true }));

// Each form's submit function, by its action, so a test drives the round
// trip without the DOM's submit plumbing.
const forms = vi.hoisted(() => ({ submits: new Map<string, SubmitFunction>() }));
vi.mock('$app/forms', () => ({
	enhance: (el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.submits.set(el.getAttribute('action') ?? '', fn);
		return { destroy() {} };
	},
}));

const kit = vi.hoisted(() => ({
	confirm: vi.fn(async (_title: string, _message: string, _opts?: unknown) => false),
	success: vi.fn(),
}));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, confirm: kit.confirm, toast: { ...(actual.toast as object), success: kit.success } };
});

import MediaPreviewDrawer from './MediaPreviewDrawer.svelte';
import { AUDIO, IMAGE, PDF, TEXT, VIDEO } from './test-support/fixtures';
import type { MediaItem } from '$lib/api/media';

afterEach(cleanup);
beforeEach(() => {
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
	kit.success.mockReset();
	forms.submits.clear();
});

function setup(item: MediaItem | null) {
	const onclose = vi.fn();
	const ondeleted = vi.fn();
	const result = render(MediaPreviewDrawer, { props: { item, onclose, ondeleted } });
	return { ...result, onclose, ondeleted };
}

const deleteSubmit = () => forms.submits.get('?/delete') as SubmitFunction;

const preview = () => screen.getByTestId('media-preview');

describe('MediaPreviewDrawer', () => {
	it('renders nothing while no item is chosen', () => {
		setup(null);
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('shows an image fitted, with zoom controls', async () => {
		setup(IMAGE);
		const img = preview().querySelector('img') as HTMLImageElement;
		expect(img.getAttribute('src')).toBe('/api/admin/media/m-image/download');
		expect(img.getAttribute('alt')).toBe('photo.png');
		const frame = screen.getByTestId('media-zoom');
		const start = Number(frame.getAttribute('data-scale'));
		await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
		expect(Number(frame.getAttribute('data-scale'))).toBeGreaterThan(start);
		await fireEvent.click(screen.getByRole('button', { name: /Fit/ }));
		expect(Number(frame.getAttribute('data-scale'))).toBe(start);
	});

	it('plays a video with the browser controls', () => {
		setup(VIDEO);
		const video = preview().querySelector('video') as HTMLVideoElement;
		expect(video.getAttribute('src')).toBe('/api/admin/media/m-video/download');
		expect(video.hasAttribute('controls')).toBe(true);
	});

	it('plays audio with the browser controls', () => {
		setup(AUDIO);
		const audio = preview().querySelector('audio') as HTMLAudioElement;
		expect(audio.getAttribute('src')).toBe('/api/admin/media/m-audio/download');
		expect(audio.hasAttribute('controls')).toBe(true);
	});

	it('never frames a PDF, and says to download it instead', () => {
		// The file route is attachment-only by design, so a frame pointed at it
		// saves the file rather than showing it: one download per open.
		setup(PDF);
		expect(preview().querySelector('iframe, object, embed')).toBeNull();
		expect(preview().getAttribute('data-kind')).toBe('pdf');
		expect(preview().textContent).toContain('Download to view this PDF');
	});

	it('shows a glyph and says so for a type it cannot preview', () => {
		setup(TEXT);
		expect(preview().querySelector('img, video, audio, iframe')).toBeNull();
		expect(preview().querySelector('svg')).not.toBeNull();
		expect(preview().textContent).toContain('No preview');
	});

	it('lists the facts, with dimensions only when the engine recorded them', () => {
		const { unmount } = setup(IMAGE);
		let dialog = screen.getByRole('dialog');
		expect(dialog.textContent).toContain('photo.png');
		expect(dialog.textContent).toContain('Image (image/png)');
		expect(dialog.textContent).toContain('2.0 KB');
		expect(dialog.textContent).toContain('640 x 480');
		expect(dialog.textContent).toContain('Uploaded');
		unmount();

		setup(PDF);
		dialog = screen.getByRole('dialog');
		expect(dialog.textContent).toContain('PDF (application/pdf)');
		expect(dialog.textContent).not.toContain('Dimensions');
	});

	it('shows the admin URL of a private file and copies it', async () => {
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		setup(IMAGE);
		const url = `${window.location.origin}/api/admin/media/m-image/download`;
		expect((screen.getByLabelText('Console URL') as HTMLInputElement).value).toBe(url);
		expect((screen.getByLabelText('Markdown') as HTMLInputElement).readOnly).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
	});

	it('offers the public path of a published file and the way to unpublish it', () => {
		setup({ ...IMAGE, public: true, public_url: '/api/v1/media/m-image/cat.jpg' });
		expect((screen.getByLabelText('Public path') as HTMLInputElement).value).toBe('/api/v1/media/m-image/cat.jpg');
		expect((screen.getByLabelText('Markdown') as HTMLInputElement).value).toContain('/api/v1/media/m-image/cat.jpg');
		expect(screen.getByRole('button', { name: 'Unpublish' })).toBeTruthy();
	});

	it('offers the file as a download link', () => {
		setup(PDF);
		const link = screen.getByRole('link', { name: 'Download' }) as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe('/api/admin/media/m-pdf/download');
		expect(link.getAttribute('download')).toBe('invoice.pdf');
	});

	it('deletes only after the kit dialog confirms, naming the file', async () => {
		// The kit's confirm() is the ConfirmDialog every admin delete goes
		// through. The browser's own prompt is not a surface the admin owns.
		const native = vi.spyOn(window, 'confirm').mockReturnValue(true);
		const { ondeleted } = setup(VIDEO);
		const form = document.querySelector('form[action="?/delete"]') as HTMLFormElement;
		expect(form.contains(screen.getByRole('button', { name: 'Delete' }))).toBe(true);
		expect((form.querySelector('[name="id"]') as HTMLInputElement).value).toBe(VIDEO.id);

		const cancel = vi.fn();
		expect(await deleteSubmit()({ cancel } as never)).toBeUndefined();
		expect(cancel).toHaveBeenCalled();
		expect(native).not.toHaveBeenCalled();
		expect(kit.confirm.mock.calls[0]?.[0]).toBe('Delete clip.webm?');
		expect(kit.confirm.mock.calls[0]?.[2]).toEqual({ confirmLabel: 'Delete' });

		kit.confirm.mockResolvedValue(true);
		const formData = new FormData(form);
		const after = await deleteSubmit()({ cancel: vi.fn(), formData } as never);
		expect(formData.get('confirmed')).toBe('yes');
		const update = vi.fn(async () => {});
		await (after as (a: unknown) => Promise<void>)({ result: { type: 'success' }, update });
		expect(update).toHaveBeenCalled();
		expect(kit.success).toHaveBeenCalledWith('clip.webm deleted.');
		expect(ondeleted).toHaveBeenCalledOnce();
		expect(native).not.toHaveBeenCalled();
		native.mockRestore();
	});

	it('keeps the drawer and says nothing more when the delete is refused', async () => {
		kit.confirm.mockResolvedValue(true);
		const { ondeleted } = setup(VIDEO);
		const after = await deleteSubmit()({ cancel: vi.fn(), formData: new FormData() } as never);
		await (after as (a: unknown) => Promise<void>)({ result: { type: 'failure' }, update: vi.fn(async () => {}) });
		expect(kit.success).not.toHaveBeenCalled();
		expect(ondeleted).not.toHaveBeenCalled();
	});

	it('closes from the header control', async () => {
		const { onclose } = setup(IMAGE);
		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(onclose).toHaveBeenCalled();
	});
});
