// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import NewEntryPage from './+page.svelte';

afterEach(cleanup);

const schemaDef = {
	name: 'posts',
	display_name: 'Posts',
	with_localization: true,
	fields: [{ name: 'title', field_type: 'text', required: false, unique: false, indexed: false }],
};

function data(locales: unknown) {
	return { schemaDef, relations: {}, locales, mediaChoices: [] } as never;
}

describe('new entry locale', () => {
	it('names the locale picker', () => {
		const { getByLabelText } = render(NewEntryPage, {
			props: {
				data: data({ ok: true, value: [{ code: 'en', name: 'en', is_default: true }, { code: 'fr', name: 'fr', is_default: false }] }),
				form: null,
			},
		});
		expect(getByLabelText('Locale')).toBeTruthy();
	});

	it('says the locales could not be read instead of hiding the picker in silence', () => {
		const { getByText, queryByLabelText } = render(NewEntryPage, {
			props: { data: data({ ok: false, gate: { state: 'unavailable' } }), form: null },
		});
		expect(getByText(/Could not load the locales/)).toBeTruthy();
		expect(queryByLabelText('Locale')).toBeNull();
	});

	it('offers no locale on an engine without the localization plugin', () => {
		const { queryByLabelText, queryByText } = render(NewEntryPage, { props: { data: data(null), form: null } });
		expect(queryByLabelText('Locale')).toBeNull();
		expect(queryByText(/could not be read/)).toBeNull();
	});
});

describe('new entry refusals', () => {
	it('shows the message the plugin gave beside the field it refused', () => {
		const { container } = render(NewEntryPage, {
			props: {
				data: data(null),
				form: { error: 'The entry was not saved. Check the highlighted fields.', fieldErrors: { title: 'must be at least 3 characters' } } as never,
			},
		});
		const field = container.querySelector('[data-field-name="title"]');
		expect(field?.textContent).toContain('must be at least 3 characters');
		expect(container.textContent).toContain('1 field needs attention.');
	});

	it('offers the created entry instead of a second Create when a link did not save', () => {
		const { container, queryByRole } = render(NewEntryPage, {
			props: {
				data: data(null),
				form: { error: 'Entry created. Could not add 1 link in tags.', created: 'e1' } as never,
			},
		});
		expect(queryByRole('button', { name: 'Create' })).toBeNull();
		expect(container.querySelector('a[href="/admin/content/posts/e1"]')?.textContent).toContain('Open the entry');
	});
});
