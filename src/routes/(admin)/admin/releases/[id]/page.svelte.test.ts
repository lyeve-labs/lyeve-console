// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

const kit = vi.hoisted(() => ({ confirm: vi.fn(async (..._args: unknown[]) => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

import ReleasePage from './+page.svelte';
import { outlineSkips } from '$lib/test-outline';

afterEach(cleanup);

const release = {
	id: 'r1',
	name: 'Launch',
	description: '',
	status: 'draft',
	created_by: 'u1',
	updated_by: 'u1',
	created_at: '',
	updated_at: '',
	item_count: 1,
	items: [{ entry_id: 'e1', action: 'publish', added_by: 'u1', created_at: '' }],
};

function setup(data: Record<string, unknown> = {}, form: unknown = null) {
	return render(ReleasePage, {
		props: {
			data: { release, gate: { state: 'ok' }, conflicts: [], conflictsRead: true, labels: { e1: { title: 'Hello', schema: 'posts', status: 'draft' } }, ...data },
			form,
		} as never,
	});
}

/** Each heading level that follows one more than a level shallower, in document order. */
function skippedLevels(): string[] {
	const levels = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => ({ level: Number(h.tagName[1]), text: h.textContent?.trim() ?? '' }));
	return levels.filter((h, i) => i > 0 && h.level > levels[i - 1].level + 1).map((h) => `h${h.level} ${h.text}`);
}

describe('release page', () => {
	it('puts its cards one level under the page title', () => {
		setup();
		expect(document.querySelector('h1')).not.toBeNull();
		expect(skippedLevels()).toEqual([]);
	});

	it('links each entry to its editor by the collection it lives in', () => {
		const { getByRole } = setup();
		expect(getByRole('link', { name: 'Hello' }).getAttribute('href')).toBe('/admin/content/posts/e1');
	});

	it('lists a blocking conflict and holds back the publish', () => {
		const { getByTestId, getByRole } = setup({ conflicts: [{ entry_id: 'e1', kind: 'other_release', detail: '', release_id: 'r2' }] });
		expect(getByTestId('release-conflicts').textContent).toContain('Another scheduled release also moves it');
		expect((getByRole('button', { name: /Publish now/ }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('shows the conflicts a refused publish returned', () => {
		const { getByTestId } = setup({}, { error: 'conflicts', conflicts: [{ entry_id: 'e1', kind: 'entry_schedule', detail: '' }] });
		expect(getByTestId('release-conflicts').textContent).toContain('Has its own publish or unpublish date');
	});

	it('renders a refused write as the refusal notice', () => {
		const { getAllByTestId } = setup({}, { error: 'x', refused: { kind: 'feature', feature: 'example-capability', plugin: 'example', upgradeUrl: '' } });
		expect(getAllByTestId('refusal-notice')[0].textContent).toContain('Not enabled on this engine');
	});

	it('offers no edits once the release went out', () => {
		const { queryByRole } = setup({ release: { ...release, status: 'published', published_at: '2026-10-01T00:00:00Z' } });
		expect(queryByRole('button', { name: /Publish now/ })).toBeNull();
		expect(queryByRole('button', { name: /Include entry/ })).toBeNull();
	});
});

describe('including an entry', () => {
	const choices = [
		{ id: 'e2', title: 'Pricing', slug: 'pricing', schema: 'pages' },
		{ id: 'e3', title: '', slug: 'spring-sale', schema: 'posts' },
	];

	it('offers the entries by title to pick from, and adds the one picked', async () => {
		const { getByRole, getAllByRole, queryByRole } = setup({ choices });
		await fireEvent.click(getByRole('button', { name: /Include entry/ }));
		expect(queryByRole('textbox', { name: /Entry ID/ })).toBeNull();
		await fireEvent.click(document.getElementById('release-entry') as HTMLElement);
		expect(getAllByRole('option').map((o) => o.textContent?.trim())).toEqual(['Pricing', 'spring-sale']);
		await fireEvent.click(getByRole('option', { name: 'Pricing' }));
		expect((document.querySelector('input[name="entry_id"]') as HTMLInputElement).value).toBe('e2');
		const add = getByRole('button', { name: 'Include' }) as HTMLButtonElement;
		expect(add.disabled).toBe(false);
		expect(queryByRole('button', { name: 'Create' })).toBeNull();
	});

	it('asks for an id when the entries could not be read', async () => {
		const { getByRole } = setup({ choices: null });
		await fireEvent.click(getByRole('button', { name: /Include entry/ }));
		expect(getByRole('textbox', { name: /Entry ID/ })).toBeTruthy();
	});
});

describe('confirmed release actions', () => {
	it('names the release in the delete question', async () => {
		const { getByRole } = setup();
		await fireEvent.click(getByRole('button', { name: /Delete/ }));
		expect(kit.confirm.mock.calls[0][0]).toBe('Delete release Launch?');
	});

	it('submits the hidden form with the action the dialog confirmed', async () => {
		kit.confirm.mockResolvedValueOnce(true);
		const submitted: string[] = [];
		const spy = vi
			.spyOn(HTMLFormElement.prototype, 'requestSubmit')
			.mockImplementation(function (this: HTMLFormElement) {
				submitted.push(this.getAttribute('action') ?? '');
			});
		const { getByRole } = setup();
		await fireEvent.click(getByRole('button', { name: /Delete/ }));
		await vi.waitFor(() => expect(submitted).toEqual(['?/delete']));
		spy.mockRestore();
	});

	it('offers the two item actions as a segmented control', async () => {
		const { getByRole } = setup({ choices: [] });
		await fireEvent.click(getByRole('button', { name: /Include entry/ }));
		const group = getByRole('radiogroup', { name: 'When the release publishes' });
		expect(group.querySelectorAll('[role="radio"], input[type="radio"]').length).toBe(2);
	});
});

describe('release drawers', () => {
	it('keeps a failed delete out of the edit drawer', async () => {
		const { getByRole, getByText, getAllByText } = setup({}, { action: 'delete', error: 'Could not delete the release. Try again.' });
		expect(getByText('Could not delete the release. Try again.')).toBeTruthy();
		await fireEvent.click(getByRole('button', { name: /Edit/ }));
		expect(getAllByText('Could not delete the release. Try again.')).toHaveLength(1);
		const drawerForm = document.querySelector('form#release-edit') as HTMLFormElement;
		expect(drawerForm.textContent).not.toContain('Could not delete the release. Try again.');
	});

	it('shows a failed edit in the edit drawer and not in the include drawer', async () => {
		const { getByRole } = setup({ choices: [] }, { action: 'update', error: 'name already in use' });
		await fireEvent.click(getByRole('button', { name: /Edit/ }));
		expect((document.querySelector('form#release-edit') as HTMLFormElement).textContent).toContain('name already in use');
		await fireEvent.click(getByRole('button', { name: /Include entry/ }));
		expect((document.querySelector('form#release-add') as HTMLFormElement).textContent).not.toContain('name already in use');
	});

	it('says why the conflicts could not be checked', () => {
		const { getByText } = setup({ conflictsRead: false, conflictsGate: { state: 'forbidden' } });
		expect(getByText(/Your role cannot open/)).toBeTruthy();
	});
});

// A heading list that jumps from h1 to h3 reads to a screen reader as a
// missing section.
describe('heading outline', () => {
	it('steps its headings down one level at a time', () => {
		const { container } = setup();
		expect(outlineSkips(container)).toEqual([]);
	});

	it('steps its headings down one level at a time while the feature is not enabled', () => {
		const { container } = setup({ release: null, gate: { state: 'locked', upgradeUrl: '' } });
		expect(container.querySelector('[data-testid="not-enabled"]')).toBeTruthy();
		expect(outlineSkips(container)).toEqual([]);
	});
});

describe('the release page links under a finger', () => {
	const hasHitArea = (el: Element | null) => !!el && ['relative', 'hit-area'].every((c) => el.classList.contains(c));

	// Both are one line of small text, and the only way to the other release or the entry.
	it('gives the other release and the entry title a touch hit area', () => {
		const { getByRole } = setup({ conflicts: [{ entry_id: 'e1', kind: 'other_release', detail: '', release_id: 'r2' }] });
		expect(hasHitArea(getByRole('link', { name: 'Open the other release' }))).toBe(true);
		expect(hasHitArea(getByRole('link', { name: 'Hello' }))).toBe(true);
	});

	// A row is about 22px tall and each link's box is 44px, so rows 8px apart
	// let one conflict's link take the taps meant for the next one's.
	it('spaces the conflict rows so their links do not overlap', () => {
		const { getByTestId } = setup({
			conflicts: [
				{ entry_id: 'e1', kind: 'other_release', detail: '', release_id: 'r2' },
				{ entry_id: 'e2', kind: 'other_release', detail: '', release_id: 'r3' },
			],
		});
		expect(getByTestId('release-conflicts').classList.contains('coarse:gap-6')).toBe(true);
	});
});
