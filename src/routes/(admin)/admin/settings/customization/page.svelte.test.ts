// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import CustomizationPage from './+page.svelte';
import { outlineSkips } from '$lib/test-outline';

afterEach(cleanup);

const settings = {
	brand: { name: 'Acme', logo_url: '', favicon_url: '', accent: '', welcome: '' },
	menu: { hidden: [], pinned: [], links: [] },
	home_page: '',
};

function props(over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: {
			gate: { state: 'ok' },
			entitled: true,
			settings,
			mediaChoices: [],
			user: { roles: ['admin'] },
			...over,
		},
		form,
	} as never;
}

describe('customization when it could not be read', () => {
	it('says the engine did not answer rather than that customization is not enabled', () => {
		const { container } = render(CustomizationPage, {
			props: props({ gate: { state: 'unavailable' }, entitled: false }),
		});
		expect(container.textContent).toContain('so customization did not load');
		expect(screen.queryByTestId('not-enabled')).toBeNull();
	});
});

describe('the brand tab', () => {
	it('opens on the Brand tab of the customization strip', () => {
		render(CustomizationPage, { props: props() });
		expect(screen.getByRole('tab', { name: 'Brand' }).getAttribute('aria-selected')).toBe('true');
	});

	it('gives each top section a level 2 heading under the page title', () => {
		render(CustomizationPage, { props: props() });
		expect(screen.getByRole('heading', { name: 'Brand', level: 2 })).toBeTruthy();
	});
});

/*
 * A logo or tab icon save reruns the load. Reseeding the brand form from it
 * wiped what the form held unsaved, so a new logo took the brand name being
 * typed with it.
 */
describe('unsaved customization edits', () => {
	it('survive a save of another form', async () => {
		const { rerender } = render(CustomizationPage, { props: props() });
		const brandName = document.querySelector('#brand-name') as HTMLInputElement;
		await fireEvent.input(brandName, { target: { value: 'Acme Labs' } });
		await rerender(props({ settings: { ...settings, brand: { ...settings.brand, logo_url: '/api/v1/media/m1/logo.png' } } }, { logoSaved: true }));
		expect((document.querySelector('#brand-name') as HTMLInputElement).value).toBe('Acme Labs');
	});

	it('follow the brand once a brand save stores a new one', async () => {
		const { rerender } = render(CustomizationPage, { props: props() });
		await fireEvent.input(document.querySelector('#brand-name') as HTMLInputElement, { target: { value: 'Draft' } });
		await rerender(props({ settings: { ...settings, brand: { ...settings.brand, name: 'Stored' } } }, { brandSaved: true }));
		expect((document.querySelector('#brand-name') as HTMLInputElement).value).toBe('Stored');
	});
});

// A heading list that jumps from h1 to h3 reads to a screen reader as a
// missing section.
describe('heading outline', () => {
	it('steps its headings down one level at a time', () => {
		const { container } = render(CustomizationPage, { props: props() });
		expect(outlineSkips(container)).toEqual([]);
	});

	it('steps its headings down one level at a time while the feature is not enabled', () => {
		const { container } = render(CustomizationPage, { props: props({ gate: { state: 'locked', upgradeUrl: '' } }) });
		expect(container.querySelector('[data-testid="not-enabled"]')).toBeTruthy();
		expect(outlineSkips(container)).toEqual([]);
	});
});
