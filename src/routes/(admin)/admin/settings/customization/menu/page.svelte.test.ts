// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import MenuPage from './+page.svelte';
import { outlineSkips } from '$lib/test-outline';

afterEach(cleanup);

const settings = {
	brand: { name: 'Acme', logo_url: '', favicon_url: '', accent: '', welcome: '' },
	menu: { hidden: [] as string[], pinned: [] as string[], links: [] as { label: string; url: string }[] },
	home_page: '',
};

function props(over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: {
			gate: { state: 'ok' },
			entitled: true,
			settings,
			navChoices: [{ id: 'media', label: 'Media', section: 'Content' }],
			user: { roles: ['admin'] },
			...over,
		},
		form,
	} as never;
}

describe('the menu tab', () => {
	it('opens on the Menu tab of the customization strip', () => {
		render(MenuPage, { props: props() });
		expect(screen.getByRole('tab', { name: 'Menu' }).getAttribute('aria-selected')).toBe('true');
	});

	it('gives each top section a level 2 heading under the page title', () => {
		render(MenuPage, { props: props() });
		for (const name of ['Menu', 'Links']) {
			expect(screen.getByRole('heading', { name, level: 2 })).toBeTruthy();
		}
	});

	it('says the engine did not answer rather than that customization is not enabled', () => {
		const { container } = render(MenuPage, { props: props({ gate: { state: 'unavailable' }, entitled: false }) });
		expect(container.textContent).toContain('so customization did not load');
		expect(screen.queryByTestId('not-enabled')).toBeNull();
	});

	it('picks hidden and pinned entries from searchable lists and posts each pick', () => {
		const { container } = render(MenuPage, {
			props: props({
				settings: { ...settings, menu: { hidden: ['media'], pinned: ['media', 'users'], links: [] } },
				navChoices: [
					{ id: 'media', label: 'Media', section: 'Content' },
					{ id: 'users', label: 'Users', section: 'Access' },
				],
			}),
		});
		expect(container.querySelectorAll('input[type="checkbox"][name="hidden"]')).toHaveLength(0);
		expect(container.querySelector('#menu-hidden')).toBeTruthy();
		const posted = (name: string) =>
			[...container.querySelectorAll(`input[type="hidden"][name="${name}"]`)].map((i) => (i as HTMLInputElement).value);
		expect(posted('hidden')).toEqual(['media']);
		// A hidden entry cannot also be pinned.
		expect(posted('pinned')).toEqual(['users']);
	});
});

/*
 * The link drawer reads its own failure key. A drawer opened over an older
 * failure starts clean.
 */
describe('the link drawer and older failures', () => {
	const linkText = () => document.body.querySelector('form#link-form')?.textContent ?? '';

	it('shows a failed link save first in the open link drawer, and not when reopened', async () => {
		const { rerender } = render(MenuPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new link/i }));
		await rerender(props({}, { action: 'addLink', linkError: 'Check the highlighted fields.', fields: { label: 'Required' } }));
		const form = document.body.querySelector('form#link-form') as HTMLFormElement;
		expect(form.firstElementChild?.textContent).toContain('Check the highlighted fields.');
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await fireEvent.click(screen.getByRole('button', { name: /new link/i }));
		expect(linkText()).not.toContain('Check the highlighted fields.');
	});
});

/*
 * A link save reruns the load. Reseeding the menu form from it wiped the
 * hidden and pinned entries being picked.
 */
describe('unsaved menu edits', () => {
	it('survive a link save', async () => {
		const { container, rerender } = render(MenuPage, { props: props({ settings: { ...settings, menu: { ...settings.menu, hidden: ['media'] } } }) });
		const hiddenNow = () => [...container.querySelectorAll('input[type="hidden"][name="hidden"]')].map((i) => (i as HTMLInputElement).value);
		expect(hiddenNow()).toEqual(['media']);
		await rerender(props({ settings: { ...settings, menu: { ...settings.menu, hidden: ['media'], links: [{ label: 'Wiki', url: 'https://wiki.example.com' }] } } }, { linkSaved: true }));
		expect(hiddenNow()).toEqual(['media']);
		expect(screen.getByText('Wiki')).toBeTruthy();
	});
});

describe('heading outline', () => {
	it('steps its headings down one level at a time', () => {
		const { container } = render(MenuPage, { props: props() });
		expect(outlineSkips(container)).toEqual([]);
	});

	it('steps its headings down one level at a time while the feature is not enabled', () => {
		const { container } = render(MenuPage, { props: props({ entitled: false }) });
		expect(container.querySelector('[data-testid="not-enabled"]')).toBeTruthy();
		expect(outlineSkips(container)).toEqual([]);
	});
});
