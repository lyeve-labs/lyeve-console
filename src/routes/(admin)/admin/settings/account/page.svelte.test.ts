// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { setThemePreference } from '@lyeve-labs/ui-kit';
import AccountPage from './+page.svelte';
import { outlineSkips } from '#lib/test-outline.ts';

/**
 * The appearance picker.
 *
 * The header of every authed screen carries the kit's theme toggle, which
 * cycles. This page carries the same three choices as a radiogroup, because a
 * cycle is a poor way to reach a named option and the account page is where a
 * preference is stated rather than flipped. Both write through the kit, so the
 * cases here check that this page still offers the third choice, that choosing
 * it repaints, and that the two controls cannot end up showing different
 * answers while both are on screen.
 */

vi.mock('#lib/api/csrf.ts', () => ({ csrfHeaders: () => ({}) }));

const data = { user: { email: 'a@b.c', roles: ['super_admin'] }, remembersDevices: false, hasMfa: true };

/** Answers both spellings of the query, so either direction reads the desktop. */
function desktopPrefers(theme: 'light' | 'dark'): void {
	vi.stubGlobal('matchMedia', (query: string) => ({
		matches: query.includes(theme),
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {},
	}));
}

function mount(over: Record<string, unknown> = {}) {
	render(AccountPage, { props: { data: { ...data, ...over } } as never });
}

function segment(name: string): HTMLElement {
	return screen.getByRole('radio', { name });
}

/** The picker reacts to a document mutation, which lands a microtask later. */
async function settle(): Promise<void> {
	await Promise.resolve();
	await tick();
}

beforeEach(() => {
	localStorage.clear();
	document.documentElement.removeAttribute('data-theme');
	desktopPrefers('dark');
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('the account card', () => {
	it('offers two-factor authentication only while the plugin runs', () => {
		mount();
		expect(screen.getByRole('link', { name: /Two-factor authentication/ })).toBeTruthy();
		cleanup();
		mount({ hasMfa: false });
		expect(screen.queryByRole('link', { name: /Two-factor authentication/ })).toBeNull();
	});
});

describe('appearance', () => {
	it('offers the desktop as a third choice beside light and dark', () => {
		mount();

		expect(segment('Light')).toBeTruthy();
		expect(segment('Dark')).toBeTruthy();
		expect(segment('System')).toBeTruthy();
	});

	it('shows the stored choice as the chosen segment', async () => {
		localStorage.setItem('lyeve-theme', 'light');
		mount();
		await tick();

		expect(segment('Light').getAttribute('aria-checked')).toBe('true');
		expect(segment('System').getAttribute('aria-checked')).toBe('false');
	});

	// Nothing stored is not a choice to follow the desktop, but it resolves the
	// same way, so the segment that describes what is happening is System.
	it('shows the desktop as the chosen segment before anyone chooses', async () => {
		mount();
		await tick();

		expect(segment('System').getAttribute('aria-checked')).toBe('true');
	});

	it('stores the desktop as a standing instruction and paints what it asks for', async () => {
		desktopPrefers('light');
		localStorage.setItem('lyeve-theme', 'dark');
		mount();
		await tick();

		await fireEvent.click(segment('System'));

		expect(localStorage.getItem('lyeve-theme')).toBe('system');
		expect(document.documentElement.getAttribute('data-theme')).toBe('light');
		expect(segment('System').getAttribute('aria-checked')).toBe('true');
	});

	it('paints and persists an explicit choice', async () => {
		mount();
		await tick();

		await fireEvent.click(segment('Light'));

		expect(localStorage.getItem('lyeve-theme')).toBe('light');
		expect(document.documentElement.getAttribute('data-theme')).toBe('light');
	});

	/**
	 * The header toggle is mounted at the same time as this picker and holds its
	 * own copy of the preference. Both write through the kit, so the persisted
	 * answer is right either way. What breaks is the picker showing the previous
	 * answer until the reader navigates.
	 */
	it('follows a choice made through the toggle in the header', async () => {
		mount();
		await tick();
		expect(segment('System').getAttribute('aria-checked')).toBe('true');

		setThemePreference('light');
		await settle();

		expect(segment('Light').getAttribute('aria-checked')).toBe('true');
		expect(segment('System').getAttribute('aria-checked')).toBe('false');
	});

	// The toggle cycles dark to system on a dark desktop without changing what
	// is painted. An observer that only reacted to a new value would miss it.
	it('follows a toggle press that changes the choice but not the palette', async () => {
		localStorage.setItem('lyeve-theme', 'dark');
		mount();
		await tick();

		setThemePreference('system');
		await settle();

		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
		expect(segment('System').getAttribute('aria-checked')).toBe('true');
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
});
