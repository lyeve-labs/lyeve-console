// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SchemaField } from '@lyeve-labs/client';
import type { Translation } from '$lib/api/localization';
import TranslationsPanel from './TranslationsPanel.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

const field = (name: string, field_type: SchemaField['field_type'], extra: Partial<SchemaField> = {}): SchemaField => ({
	name,
	field_type,
	required: false,
	unique: false,
	indexed: false,
	...extra,
});

const fields = [field('title', 'text'), field('price', 'number')];
const locales = { default_locale: 'en', enabled_locales: ['en', 'fr', 'de'], fallback_chain: ['fr'] };

const row = (locale: string, translation_status: Translation['translation_status'], title = ''): Translation => ({
	locale,
	title,
	body: { title },
	translation_status,
	updated_at: '2026-09-19T10:00:00Z',
});

function mount(translations: Translation[], extra: Record<string, unknown> = {}) {
	return render(TranslationsPanel, { props: { fields, locales, translations, ...extra } });
}

function hidden(name: string): HTMLInputElement {
	return document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
}

describe('TranslationsPanel', () => {
	it('gives the Locales link a touch-sized target', () => {
		mount([]);
		const link = screen.getByRole('link', { name: 'Locales' });
		expect(link.className).toContain('relative');
		expect(link.className).toContain('hit-area');
	});

	it('offers every enabled locale but the default as a tab, and wears the beta badge', () => {
		mount([]);
		expect(screen.getByText('Beta')).toBeTruthy();
		const tabs = screen.getAllByRole('tab').map((t) => t.textContent?.trim());
		expect(tabs).toEqual(['fr', 'de']);
	});

	it('names an outdated translation in the strip and highlights it on the tab', () => {
		mount([row('fr', 'outdated', 'Bonjour'), row('de', 'translated', 'Hallo')]);
		expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['fr, outdated', 'de']);
		const panel = screen.getByTestId('translation-fr');
		expect(panel.getAttribute('data-status')).toBe('outdated');
		expect(screen.getByText('Outdated')).toBeTruthy();
		expect(screen.getByText(/The source changed after this was translated/)).toBeTruthy();
		expect(screen.getByRole('button', { name: /Mark translated/ })).toBeTruthy();
	});

	it('offers no mark action once a translation is translated', async () => {
		mount([row('fr', 'outdated', 'Bonjour'), row('de', 'translated', 'Hallo')]);
		await fireEvent.click(screen.getByRole('tab', { name: 'de' }));
		expect(screen.getByTestId('translation-de').getAttribute('data-status')).toBe('translated');
		expect(screen.queryByRole('button', { name: /Mark translated/ })).toBeNull();
	});

	it('serializes only the text fields, for the active locale, and says whether the row exists', async () => {
		mount([row('fr', 'draft', 'Bonjour')]);
		expect(hidden('locale').value).toBe('fr');
		expect(hidden('exists').value).toBe('true');
		expect(screen.queryByRole('spinbutton')).toBeNull();

		const title = screen.getByRole('textbox', { name: /^title/ }) as HTMLInputElement;
		expect(title.value).toBe('Bonjour');
		await fireEvent.input(title, { target: { value: 'Salut' } });
		expect(JSON.parse(hidden('data').value)).toEqual({ title: 'Salut' });

		// A locale with no row yet is a create, and the save form says so.
		await fireEvent.click(screen.getByRole('tab', { name: 'de' }));
		expect(hidden('locale').value).toBe('de');
		expect(hidden('exists').value).toBe('false');
		expect(JSON.parse(hidden('data').value)).toEqual({ title: '' });
	});

	it('keeps an edit when switching tabs and back', async () => {
		mount([]);
		const title = screen.getByRole('textbox', { name: /^title/ }) as HTMLInputElement;
		await fireEvent.input(title, { target: { value: 'Salut' } });
		await fireEvent.click(screen.getByRole('tab', { name: 'de' }));
		await fireEvent.click(screen.getByRole('tab', { name: 'fr' }));
		expect((screen.getByRole('textbox', { name: /^title/ }) as HTMLInputElement).value).toBe('Salut');
	});

	it('opens on the locale a refusal was about and shows it there', () => {
		mount([], { error: 'Failed to save the translation.', errorLocale: 'de' });
		expect(hidden('locale').value).toBe('de');
		expect(screen.getByText('Failed to save the translation.')).toBeTruthy();
	});

	it('points at the locales page when nothing is enabled beyond the default', () => {
		render(TranslationsPanel, {
			props: { fields, locales: { ...locales, enabled_locales: ['en'] }, translations: [] },
		});
		expect(screen.queryByRole('tab')).toBeNull();
		expect(screen.getByRole('link', { name: 'locales' }).getAttribute('href')).toBe(
			'/admin/settings/localization',
		);
	});

	it('says so when the plugin is entitled and not answering', () => {
		mount([], { unavailable: true });
		expect(screen.getByText('Could not load translations')).toBeTruthy();
		expect(screen.queryByRole('tab')).toBeNull();
	});
});

/*
 * How far along, and what a reader gets meanwhile.
 *
 * The panel states a denominator to be complete against, and names the
 * fallback chain beside the boxes, so an empty box says which locale reaches
 * the reader instead.
 */
describe('TranslationsPanel progress and fallback', () => {
	const field = (name: string, over: Record<string, unknown> = {}) =>
		({ name, field_type: 'text', required: false, unique: false, indexed: false, ...over }) as never;

	const panel = (over: Record<string, unknown> = {}) =>
		render(TranslationsPanel, {
			props: {
				fields: [field('title', { localized: true }), field('body', { localized: true })],
				locales: { default_locale: 'en', enabled_locales: ['en', 'fr', 'es'], fallback_chain: [] },
				translations: [],
				...over,
			} as never,
		});

	it('measures the locale on screen', () => {
		const { container } = panel({
			translations: [
				{ locale: 'fr', title: 'Bonjour', body: {}, translation_status: 'draft' },
			],
		});
		const bar = container.querySelector('[data-testid="completeness-fr"]');
		expect(bar?.textContent).toContain('1 of 2');
		expect(bar?.textContent).toContain('50%');
	});

	it('an untranslated locale reads as nothing written', () => {
		const { container } = panel();
		expect(container.querySelector('[data-testid="completeness-fr"]')?.textContent).toContain('0 of 2');
	});

	// The reader gets the source, and the box is the only place that can say so
	// while somebody is looking at it.
	it('says an empty field falls through to the source', () => {
		const { container } = panel();
		expect(container.textContent).toContain('see the source while this is empty');
	});

	it('says a new translation saves the source title as it is now when its title is empty', () => {
		const { container } = panel();
		const hint = container.querySelector('[data-field-name="title"]')?.textContent ?? '';
		expect(hint).toContain(
			'A new translation needs a title. If you leave it empty, it copies the current source title, and later changes to the source do not update it.',
		);
		expect(hint).not.toContain('see the source while this is empty');
	});

	it('says a saved title stays, and an empty field reads from the source, once the locale has a translation', async () => {
		const { container } = panel({
			locales: { default_locale: 'en', enabled_locales: ['en', 'fr', 'es'], fallback_chain: ['es'] },
			translations: [
				{ locale: 'fr', title: 'Bonjour', body: { title: 'Bonjour' }, translation_status: 'draft' },
				{ locale: 'es', title: 'Hola', body: { title: 'Hola', body: 'Texto' }, translation_status: 'translated' },
			],
		});
		await fireEvent.input(document.getElementById('translation-fr-title') as HTMLInputElement, { target: { value: '' } });
		expect(container.querySelector('[data-field-name="title"]')?.textContent).toContain(
			'If you leave it empty, the title saved for fr stays as it is.',
		);
		// The reader of fr gets the fr row, so an empty body comes from the source, not from es.
		const body = container.querySelector('[data-field-name="body"]')?.textContent ?? '';
		expect(body).toContain('see the source while this is empty');
		expect(body).not.toContain('in es');
	});

	// The chain is the whole reason this is per field rather than per locale.
	it('names the locale the reader actually gets, when it is not the source', () => {
		const { container } = panel({
			locales: { default_locale: 'en', enabled_locales: ['en', 'fr', 'es'], fallback_chain: ['es'] },
			translations: [
				{ locale: 'es', title: 'Hola', body: { body: 'Texto' }, translation_status: 'translated' },
			],
		});
		expect(container.textContent).toContain('in es');
	});

	// A schema nobody has marked shows every text field, and that has to read
	// as the fallback it is rather than as a decision somebody made.
	it('says when it is guessing from the field types', () => {
		const { container } = panel({ fields: [field('title'), field('body')] });
		expect(container.textContent).toContain('No field on this content type is marked');
	});

	it('says nothing about guessing once the schema is marked', () => {
		const { container } = panel();
		expect(container.textContent).not.toContain('No field on this content type is marked');
	});
});
