// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import EditorPage from './+page.svelte';
import { outlineSkips } from '$lib/test-outline';

/**
 * The engine stores a page with empty fields left out. A callout saved with no
 * heading comes back with no `title`, and binding the heading input to that
 * undefined throws during the mount, so "Edit page" would change the address
 * and leave the page it came from on screen.
 */

afterEach(cleanup);

const stored = {
	slug: 'launch',
	title: 'Launch checklist',
	description: '',
	roles: [],
	position: 0,
	blocks: [
		{ type: 'callout', body: 'Nothing ships on Friday' },
		{ type: 'content', schema: 'articles', limit: 5 },
		{ type: 'stats', schemas: ['articles'] },
		{ type: 'links', links: [{ label: 'Docs', url: 'https://docs.example.com' }] },
	],
};

function mount() {
	render(EditorPage, {
		props: { data: { customPage: stored, schemas: ['articles'], schemasGate: { state: 'ok' }, user: { roles: ['admin'] } }, form: null } as never,
	});
}

describe('custom page editor', () => {
	it('opens a stored page whose blocks omit their empty fields', () => {
		expect(mount).not.toThrow();
		expect(screen.getByRole('heading', { level: 1, name: 'Launch checklist' })).toBeTruthy();
		expect((screen.getByLabelText('Text') as HTMLTextAreaElement).value).toBe('Nothing ships on Friday');
		expect(screen.getAllByLabelText('Heading').map((el) => (el as HTMLInputElement).value)).toEqual(['', '', '', '']);
	});

	it('marks the editor as beta', () => {
		mount();
		expect(screen.getByText('Beta')).toBeTruthy();
	});
});

describe('custom page block controls', () => {
	it('picks the status from a segmented control and the counted schemas from a searchable list', () => {
		mount();
		expect(screen.getByRole('radiogroup', { name: 'Status' })).toBeTruthy();
		expect(screen.getByRole('radio', { name: 'Any status' }).getAttribute('aria-checked')).toBe('true');
		expect(document.querySelector('#block-1-status')).toBeNull();
		expect(document.querySelector('#block-2-schemas')).toBeTruthy();
	});

	it('keeps the schema a block names on screen when the schema list was not read', () => {
		render(EditorPage, {
			props: { data: { customPage: stored, schemas: [], schemasGate: { state: 'error', message: 'Could not load content types. Blocks keep the content types they already use.' }, user: { roles: ['admin'] } }, form: null } as never,
		});
		expect(document.body.textContent).toContain('Could not load content types');
		expect(document.querySelector('#block-2-schemas')?.closest('div')?.parentElement?.textContent).toContain('articles');
	});
});

// A heading list that jumps from h1 to h3 reads to a screen reader as a
// missing section.
describe('heading outline', () => {
	it('steps its headings down one level at a time', () => {
		cleanup();
		mount();
		expect(outlineSkips(document.body)).toEqual([]);
	});

	it('names the schema list in lower case inside the role refusal', () => {
		render(EditorPage, {
			props: { data: { customPage: stored, schemas: [], schemasGate: { state: 'forbidden' }, user: { roles: ['admin'] } }, form: null } as never,
		});
		expect(document.body.textContent).toContain('Your role cannot open the content type list.');
	});

	it('steps its headings down one level at a time while the feature is not enabled', () => {
		const { container } = render(EditorPage, {
			props: { data: { customPage: stored, schemas: [], schemasGate: { state: 'locked', upgradeUrl: '' }, user: { roles: ['admin'] } }, form: null } as never,
		});
		expect(container.querySelector('[data-testid="not-enabled"]')).toBeTruthy();
		expect(outlineSkips(container)).toEqual([]);
	});
});
