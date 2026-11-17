// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageData } from './$types';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import LocalesPage from './+page.svelte';
import { outlineSkips } from '#lib/test-outline.ts';

afterEach(cleanup);

const LOCALES = { default_locale: 'en', enabled_locales: ['en', 'fr', 'de'], fallback_chain: ['fr', 'de'] };

function data(overrides: Record<string, unknown> = {}): PageData {
	return {
		locales: { ok: true, value: LOCALES },
		...overrides,
	} as unknown as PageData;
}

function hidden(name: string): string[] {
	return JSON.parse((document.querySelector(`input[name="${name}"]`) as HTMLInputElement).value);
}

/** Each heading level that follows one more than a level shallower, in document order. */
function skippedLevels(): string[] {
	const levels = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => ({ level: Number(h.tagName[1]), text: h.textContent?.trim() ?? '' }));
	return levels.filter((h, i) => i > 0 && h.level > levels[i - 1].level + 1).map((h) => `h${h.level} ${h.text}`);
}

describe('locales page', () => {
	it('puts its cards one level under the page title', () => {
		render(LocalesPage, { props: { data: data(), form: null } });
		expect(document.querySelector('h1')).not.toBeNull();
		expect(skippedLevels()).toEqual([]);
	});

	it('says the plugin did not answer, and draws no form', () => {
		render(LocalesPage, { props: { data: data({ locales: { ok: false, gate: { state: 'unavailable' } } }), form: null } });
		expect(screen.getByText(/so locales did not load/)).toBeTruthy();
		expect(screen.queryByText('No locales enabled yet.')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
	});

	it('tells a role the plugin refuses that it cannot open the locales', () => {
		render(LocalesPage, { props: { data: data({ locales: { ok: false, gate: { state: 'forbidden' } } }), form: null } });
		expect(screen.getByText(/Your role cannot open locales/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
	});

	it('lists the enabled locales with the default marked and the chain in order', () => {
		render(LocalesPage, { props: { data: data(), form: null } });
		expect(screen.getByText('Beta')).toBeTruthy();
		expect(screen.getByText('en (default)')).toBeTruthy();
		expect(screen.getByRole('list', { name: 'Fallback chain' }).textContent).toMatch(/1\.\s*fr.*2\.\s*de/s);
		expect(hidden('enabled_locales')).toEqual(['en', 'fr', 'de']);
		expect(hidden('fallback_chain')).toEqual(['fr', 'de']);
	});

	it('centers the locale tags in their row, so the default sits level with a removable one', () => {
		render(LocalesPage, { props: { data: data(), form: null } });
		expect(screen.getByRole('list', { name: 'Enabled locales' }).classList.contains('items-center')).toBe(true);
	});

	it('adds a locale, reorders the chain and takes a removed locale out of both', async () => {
		render(LocalesPage, { props: { data: data(), form: null } });

		const input = screen.getByRole('textbox', { name: /Add locale/ });
		await fireEvent.input(input, { target: { value: 'pt-BR' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add locale' }));
		expect(hidden('enabled_locales')).toEqual(['en', 'fr', 'de', 'pt-BR']);

		await fireEvent.click(screen.getByRole('button', { name: 'Move de up' }));
		expect(hidden('fallback_chain')).toEqual(['de', 'fr']);

		await fireEvent.click(screen.getByRole('button', { name: 'Remove fr' }));
		expect(hidden('enabled_locales')).toEqual(['en', 'de', 'pt-BR']);
		expect(hidden('fallback_chain')).toEqual(['de']);
	});

	it('reports the refusal and the save', async () => {
		render(LocalesPage, { props: { data: data(), form: { error: 'The fallback chain names de, which is not an enabled locale.', saved: false } as never } });
		expect(screen.getByText(/names de/).closest('.contents[aria-live="assertive"]')).toBeTruthy();
		cleanup();
		render(LocalesPage, { props: { data: data(), form: { saved: true, error: null, locales: LOCALES } as never } });
		expect(await screen.findByText('Locales saved.')).toBeTruthy();
	});
});

describe('the fallback picker', () => {
	it('lets the locale to append be searched', async () => {
		render(LocalesPage, { props: { data: data({ locales: { ok: true, value: { ...LOCALES, fallback_chain: [] } } }), form: null } });
		await fireEvent.click(document.body.querySelector('#chain-pick') as HTMLElement);
		expect(screen.getByRole('combobox', { name: 'Search Append a locale' })).toBeTruthy();
	});
});

// A heading list that jumps from h1 to h3 reads to a screen reader as a
// missing section.
describe('heading outline', () => {
	it('steps its headings down one level at a time', () => {
		const { container } = render(LocalesPage, { props: { data: data(), form: null } });
		expect(outlineSkips(container)).toEqual([]);
	});

	it('steps its headings down one level at a time while the feature is not enabled', () => {
		const { container } = render(LocalesPage, { props: { data: data({ locales: { ok: false, gate: { state: 'locked', upgradeUrl: '' } } }), form: null } });
		expect(container.querySelector('[data-testid="not-enabled"]')).toBeTruthy();
		expect(outlineSkips(container)).toEqual([]);
	});
});
