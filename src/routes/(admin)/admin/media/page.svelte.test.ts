// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '@sveltejs/kit';

vi.mock('$app/environment', () => ({ browser: true }));

/*
 * The submit function is what the delete goes through. enhance awaits it
 * before it sends anything, so capturing it here drives the round trip
 * without the DOM's submit plumbing.
 */
const forms = vi.hoisted(() => ({ submits: new Map<string, SubmitFunction>() }));
vi.mock('$app/forms', () => ({
	enhance: (el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.submits.set(el.getAttribute('action') ?? '', fn);
		return { destroy() {} };
	},
}));
const nav = vi.hoisted(() => ({ goto: vi.fn(async () => {}), invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => nav);
const state = vi.hoisted(() => ({ page: { url: new URL('http://localhost/admin/media') } }));
vi.mock('$app/state', () => state);

const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false), success: vi.fn() }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		confirm: kit.confirm,
		toast: { ...(actual.toast as object), success: kit.success },
	};
});

import MediaPage from './+page.svelte';
import type { PageData } from './$types';
import type { MediaItem } from '$lib/api/media';
import type { Gate } from '$lib/api/gate';
import { MEDIA_VIEW_KEY } from '$lib/components/media/view-preference';
import { IMAGE, ONE_OF_EACH, PDF } from '$lib/components/media/test-support/fixtures';

afterEach(cleanup);
beforeEach(() => {
	vi.clearAllMocks();
	forms.submits.clear();
	kit.confirm.mockResolvedValue(false);
	localStorage.clear();
});

function setup(items: MediaItem[] = ONE_OF_EACH, extra: Partial<PageData> = {}) {
	return render(MediaPage, {
		props: {
			data: {
				items: { ok: true, value: items },
				limit: 60,
				offset: 0,
				total: items.length,
				hasMore: false,
				q: '',
				...extra,
			} as unknown as PageData,
			form: null,
		},
	});
}

function failed(gate: Gate) {
	return render(MediaPage, {
		props: {
			data: { items: { ok: false, gate }, limit: 60, offset: 0, total: null, hasMore: false, q: '' } as unknown as PageData,
			form: null,
		},
	});
}

const viewSwitch = () => screen.getByRole('radiogroup', { name: 'View' });
const segment = (name: string) => screen.getByRole('radio', { name });

describe('media library views', () => {
	it('opens on the grid when the viewer has chosen nothing', () => {
		setup();
		expect(screen.getByTestId('media-grid')).toBeTruthy();
		expect(screen.queryByTestId('media-list')).toBeNull();
		expect(segment('Grid').getAttribute('aria-checked')).toBe('true');
	});

	it('switches to the list and remembers it for this viewer', async () => {
		setup();
		await fireEvent.click(segment('List'));
		expect(screen.getByTestId('media-list')).toBeTruthy();
		expect(screen.queryByTestId('media-grid')).toBeNull();
		expect(localStorage.getItem(MEDIA_VIEW_KEY)).toBe('list');
	});

	it('opens on the view the viewer chose last time', async () => {
		localStorage.setItem(MEDIA_VIEW_KEY, 'list');
		setup();
		await waitFor(() => expect(screen.getByTestId('media-list')).toBeTruthy());
		expect(segment('List').getAttribute('aria-checked')).toBe('true');
	});

	it('puts the search at the start of the toolbar and the view switch at its end', () => {
		setup();
		const toolbar = screen.getByRole('toolbar', { name: 'Filter media' });
		const search = screen.getByLabelText('Search files');
		expect(toolbar.contains(search)).toBe(true);
		expect(toolbar.contains(viewSwitch())).toBe(true);
		expect(search.compareDocumentPosition(viewSwitch()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect((search.closest('form') as HTMLFormElement).getAttribute('method')).toBe('GET');
		expect(search.getAttribute('name')).toBe('q');
	});

	it('offers to clear an active search, and says when nothing matched', () => {
		setup([], { q: 'nothing' });
		expect(screen.getByRole('link', { name: 'Clear' }).getAttribute('href')).toBe('/admin/media');
		expect(screen.getByText('No files match')).toBeTruthy();
	});
});

describe('media library preview', () => {
	it('opens the drawer for the tile that was pressed', async () => {
		setup();
		expect(screen.queryByRole('dialog')).toBeNull();
		const tile = screen
			.getAllByRole('button')
			.find((el) => (el.textContent ?? '').includes('invoice.pdf')) as HTMLElement;
		await fireEvent.click(tile);
		const dialog = screen.getByRole('dialog');
		expect(dialog.textContent).toContain('invoice.pdf');
		expect(dialog.querySelector('[data-testid="media-preview"]')?.getAttribute('data-kind')).toBe('pdf');
	});

	it('opens the drawer from a list row too', async () => {
		localStorage.setItem(MEDIA_VIEW_KEY, 'list');
		setup();
		await waitFor(() => expect(screen.getByTestId('media-list')).toBeTruthy());
		await fireEvent.click(screen.getByRole('button', { name: 'photo.png' }));
		expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src')).toBe(
			'/api/admin/media/m-image/download'
		);
	});

	it('deletes through the form action once confirmed, then shuts the drawer', async () => {
		kit.confirm.mockResolvedValue(true);
		const { container, rerender } = setup();
		const tile = screen
			.getAllByRole('button')
			.find((el) => (el.textContent ?? '').includes('clip.webm')) as HTMLElement;
		await fireEvent.click(tile);

		const form = document.querySelector('form[action="?/delete"]') as HTMLFormElement;
		expect(form.contains(screen.getByRole('button', { name: 'Delete' }))).toBe(true);
		expect((form.querySelector('[name="id"]') as HTMLInputElement).value).toBe('m-video');

		// The round trip: the action answers, the page reloads without the row.
		const submit = forms.submits.get('?/delete') as SubmitFunction;
		const after = await submit({ formData: new FormData(), cancel: vi.fn() } as never);
		const update = vi.fn(async () => {});
		await (after as (a: unknown) => Promise<void>)({ result: { type: 'success' }, update });
		expect(update).toHaveBeenCalled();
		expect(kit.success).toHaveBeenCalledWith('clip.webm deleted.');
		// The tile that opened the drawer is gone, so focus goes to a control
		// that is still there rather than falling to the page body.
		expect(document.activeElement?.hasAttribute('data-media-upload')).toBe(true);

		await rerender({
			data: { items: { ok: true, value: [IMAGE, PDF] }, limit: 60, offset: 0, total: 2, hasMore: false, q: '' } as unknown as PageData,
			form: null,
		});
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('leaves the file alone when the operator cancels', async () => {
		setup();
		const tile = screen
			.getAllByRole('button')
			.find((el) => (el.textContent ?? '').includes('clip.webm')) as HTMLElement;
		await fireEvent.click(tile);

		const cancel = vi.fn();
		const after = await (forms.submits.get('?/delete') as SubmitFunction)({ formData: new FormData(), cancel } as never);
		expect(kit.confirm).toHaveBeenCalled();
		expect(cancel).toHaveBeenCalled();
		expect(after).toBeUndefined();
		expect(screen.getByRole('dialog')).toBeTruthy();
	});
});

describe('media library upload', () => {
	it('posts each file to the media endpoint and goes to the first page', async () => {
		const fetch = vi.fn(async () => new Response('{}', { status: 201 }));
		vi.stubGlobal('fetch', fetch);
		setup();

		const picker = screen.getByLabelText('Choose files to upload') as HTMLInputElement;
		const file = new File(['x'], 'new.png', { type: 'image/png' });
		Object.defineProperty(picker, 'files', { value: [file], configurable: true });
		await fireEvent.change(picker);

		await waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/admin/media', { invalidateAll: true }));
		expect(fetch).toHaveBeenCalledTimes(1);
		expect((fetch.mock.calls[0] as unknown[])[0]).toBe('/api/admin/media');
		expect(kit.success).toHaveBeenCalledWith('Uploaded 1 file');
		vi.unstubAllGlobals();
	});
});

describe('an upload whose session ended', () => {
	function pick() {
		const picker = screen.getByLabelText('Choose files to upload') as HTMLInputElement;
		Object.defineProperty(picker, 'files', { value: [new File(['x'], 'new.png', { type: 'image/png' })], configurable: true });
		return fireEvent.change(picker);
	}

	// The console renews the engine's short token only on a request its own
	// server handles, so an upload sent straight to the engine can carry one
	// that lapsed on a live session. Rerunning the loads renews it.
	it('renews the session and sends the file again', async () => {
		const answers = [new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }), new Response('{}', { status: 201 })];
		const fetch = vi.fn(async () => answers.shift() as Response);
		vi.stubGlobal('fetch', fetch);
		setup();
		await pick();
		await waitFor(() => expect(kit.success).toHaveBeenCalledWith('Uploaded 1 file'));
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(nav.invalidateAll).toHaveBeenCalledTimes(1);
		expect(nav.goto).toHaveBeenCalledTimes(1);
		expect(nav.goto).toHaveBeenCalledWith('/admin/media', { invalidateAll: true });
		vi.unstubAllGlobals();
	});

	it('says to sign in again when the renewed upload is refused too', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })));
		setup();
		await pick();
		await waitFor(() => expect(document.body.textContent).toContain('Your session ended. Sign in again in another tab, then try again here.'));
		expect(nav.goto).not.toHaveBeenCalled();
		expect(document.body.textContent).not.toContain('unauthorized');
		vi.unstubAllGlobals();
	});
});

describe('a refused or failed upload', () => {
	function pick(...names: string[]) {
		const picker = screen.getByLabelText('Choose files to upload') as HTMLInputElement;
		const files = (names.length > 0 ? names : ['new.png']).map((n) => new File(['x'], n, { type: 'image/png' }));
		Object.defineProperty(picker, 'files', { value: files, configurable: true });
		return fireEvent.change(picker);
	}
	const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

	it('relays the reason the engine gave for refusing the file', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => answer(415, { error: 'The file type image/x-icon is not allowed.', code: 'unsupported_media_type' })));
		setup();
		await pick();
		await waitFor(() => expect(document.body.textContent).toContain('The file type image/x-icon is not allowed.'));
		vi.unstubAllGlobals();
	});

	// Only the engine's refusals carry a code. A 4xx body without one, such
	// as a proxy's, is not the engine's sentence.
	it('says it in its own words when a refusal carries no code', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => answer(413, { error: 'client intended to send too large body' })));
		setup();
		await pick();
		await waitFor(() => expect(document.body.textContent).toContain('new.png was refused and was not uploaded.'));
		expect(document.body.textContent).not.toContain('client intended');
		vi.unstubAllGlobals();
	});

	// A 5xx body can carry driver or proxy text, and a proxy's 502 or 504 can
	// arrive after the engine stored the file, so the page names the file and
	// claims nothing it does not know.
	it('keeps the body of a 5xx answer off the page and claims only what it knows', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => answer(503, { error: 'dial tcp 10.0.0.4:5432: connect: connection refused' })));
		setup();
		await pick();
		await waitFor(() => expect(document.body.textContent).toContain('Could not confirm that new.png uploaded. Check the library before you try again.'));
		expect(document.body.textContent).not.toContain('dial tcp');
		expect(document.body.textContent).not.toContain('Nothing was uploaded');
		vi.unstubAllGlobals();
	});

	it('counts the files stored before a later one failed', async () => {
		const answers = [answer(201, {}), answer(502, { error: 'Bad Gateway' })];
		vi.stubGlobal('fetch', vi.fn(async () => answers.shift() as Response));
		setup();
		await pick('first.png', 'second.png');
		await waitFor(() => expect(kit.success).toHaveBeenCalledWith('Uploaded 1 file'));
		expect(document.body.textContent).toContain('Could not confirm that second.png uploaded.');
		expect(document.body.textContent).not.toContain('first.png');
		expect(document.body.textContent).not.toContain('Nothing was uploaded');
		vi.unstubAllGlobals();
	});
});

describe('media library controls carry a name', () => {
	it('names the file picker the upload button opens', () => {
		// sr-only hides the picker from the eye and not from a screen reader, so
		// without a label it is reached as a file field with no name at all.
		setup();

		const picker = screen.getByLabelText('Choose files to upload') as HTMLInputElement;
		expect(picker.type).toBe('file');
	});

	it('names the picker on an empty library too', () => {
		setup([]);

		expect(screen.getByLabelText('Choose files to upload')).toBeTruthy();
	});

	it('leaves no control on the page without a name', () => {
		const { container } = setup();

		const unnamed = [...container.querySelectorAll('button, input, a[href]')].filter((el) => {
			// A hidden input is a value, not a control anyone reaches.
			if (el.getAttribute('type') === 'hidden') return false;
			if (el.getAttribute('aria-label') || el.getAttribute('title')) return false;
			if (el.getAttribute('aria-hidden') === 'true') return false;
			const labeled = el.id && container.querySelector(`label[for="${el.id}"]`);
			return !labeled && (el.textContent ?? '').trim() === '';
		});

		expect(unnamed.map((el) => el.outerHTML)).toEqual([]);
	});
});

describe('media library read failures', () => {
	it('says the library could not be read rather than that nothing was uploaded', () => {
		failed({ state: 'unavailable' });
		expect(screen.queryByText('No files yet')).toBeNull();
		expect(screen.getByText(/did not load/)).toBeTruthy();
		expect(screen.getByRole('link', { name: /Try again/ })).toBeTruthy();
	});

	it('offers no upload or import over a library it could not read', () => {
		failed({ state: 'error', message: 'The media library could not be read.' });
		expect(screen.queryByRole('button', { name: /Upload files/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /Import from URL/ })).toBeNull();
		expect(screen.queryByText(/files?$/, { selector: 'p' })).toBeNull();
	});

	it('tells a role the engine refused that it cannot open the library', () => {
		failed({ state: 'forbidden' });
		expect(screen.getByText(/Your role cannot open media library/)).toBeTruthy();
		expect(screen.queryByText('No files yet')).toBeNull();
	});
});

describe('media library failures stay with their file and form', () => {
	function withForm(form: Record<string, unknown>) {
		return render(MediaPage, {
			props: {
				data: { items: { ok: true, value: ONE_OF_EACH }, limit: 60, offset: 0, total: ONE_OF_EACH.length, hasMore: false, q: '' } as unknown as PageData,
				form: form as never,
			},
		});
	}
	const open = async (name: string) => {
		const tile = screen.getAllByRole('button').find((el) => (el.textContent ?? '').includes(name)) as HTMLElement;
		await fireEvent.click(tile);
	};

	it('shows a failed save only in the drawer of the file it was for', async () => {
		withForm({ detailsError: 'Could not save the details. Try again.', detailsId: 'm-video' });
		await open(IMAGE.filename);
		expect(screen.queryByText('Could not save the details. Try again.')).toBeNull();
	});

	it('shows a failed save in its own file drawer', async () => {
		withForm({ detailsError: 'Could not save the details. Try again.', detailsId: IMAGE.id });
		await open(IMAGE.filename);
		expect(screen.getByText('Could not save the details. Try again.')).toBeTruthy();
	});

	it('shows a write that named no file at the top of the page', () => {
		withForm({ error: 'This form is missing its file. Reload the page and try again.' });
		expect(screen.getByText('This form is missing its file. Reload the page and try again.')).toBeTruthy();
	});

	it('shows a failed delete in the drawer the delete was asked from', async () => {
		withForm({ deleteError: 'media is referenced by a content entry', deleteId: IMAGE.id });
		await open(IMAGE.filename);
		expect(screen.getByRole('dialog').textContent).toContain('media is referenced by a content entry');
	});

	it('keeps a failed delete out of another file drawer', async () => {
		withForm({ deleteError: 'media is referenced by a content entry', deleteId: 'm-video' });
		await open(IMAGE.filename);
		expect(screen.queryByText('media is referenced by a content entry')).toBeNull();
	});

	it('leaves the import drawer clean after a failed delete', async () => {
		withForm({ error: 'Failed to delete media' });
		await fireEvent.click(screen.getByRole('button', { name: /Import from URL/ }));
		const importForm = document.querySelector('form#import-form') as HTMLFormElement;
		expect(importForm.textContent).not.toContain('Failed to delete media');
	});
});

