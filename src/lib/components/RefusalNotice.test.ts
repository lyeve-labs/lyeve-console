// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import RefusalNotice from './RefusalNotice.svelte';
import FormErrors from './FormErrors.svelte';

afterEach(cleanup);

describe('RefusalNotice', () => {
	it('states a cap with the numbers the refusal carried and links the license page', () => {
		const { container, getByRole } = render(RefusalNotice, {
			props: { refusal: { kind: 'cap', cap: 'example.items', limit: 4, current: 4, upgradeUrl: '' } },
		});
		expect(container.textContent).toContain("You're using 4 of 4 items");
		expect(getByRole('link', { name: 'View the license' }).getAttribute('href')).toBe('/admin/settings/license');
	});

	it('says a feature refusal in the neutral locked state, without the capability', () => {
		const { container } = render(RefusalNotice, {
			props: { refusal: { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' } },
		});
		expect(container.textContent).toContain('Not enabled on this engine');
		expect(container.textContent).not.toContain('example-feature');
	});

	it('names a license before removing one, and offers the link the engine sent for more', () => {
		const link = 'https://shop.example.com/pricing?utm_source=admin&utm_medium=product&utm_campaign=example.items';
		const { container, getByRole } = render(RefusalNotice, {
			props: { refusal: { kind: 'cap', cap: 'example.items', limit: 4, current: 4, upgradeUrl: link } },
		});
		expect(container.textContent).toContain("You're using 4 of 4 items, the most this engine allows. A license that allows more lifts the limit. Removing one also makes room.");
		expect(getByRole('link', { name: 'View the license' }).getAttribute('href')).toBe('/admin/settings/license');
		// The link names neither a plan nor an add-on, so it keeps words of its own.
		const more = getByRole('link', { name: 'How to raise the limit' });
		expect(more.getAttribute('href')).toBe(link);
		expect(more.getAttribute('target')).toBe('_blank');
		expect(more.getAttribute('rel')).toBe('noopener noreferrer');
	});

	// The notice sits in a drawer or a page that has its own Create or Save,
	// and a surface holds one primary.
	it('leads with the plan the engine names as a secondary, and the license page after it as a ghost', () => {
		const link = 'https://shop.example.com/pricing?plan=basic&utm_source=admin&utm_medium=product&utm_campaign=admin.seats';
		const { getAllByRole } = render(RefusalNotice, {
			props: { refusal: { kind: 'cap', cap: 'admin.seats', limit: 3, current: 3, upgradeUrl: link } },
		});
		const [first, second] = getAllByRole('link');
		expect(first.textContent?.trim()).toBe('View the plan');
		expect(first.getAttribute('href')).toBe(link);
		expect(first.classList.contains('bg-brand')).toBe(false);
		expect(first.classList.contains('bg-surface-2')).toBe(true);
		expect(second.textContent?.trim()).toBe('View the license');
		expect(second.classList.contains('bg-brand')).toBe(false);
		expect(second.classList.contains('bg-surface-2')).toBe(false);
	});

	it('makes the way forward the primary only where it is the one action on its surface', () => {
		const link = 'https://shop.example.com/pricing?plan=basic';
		const { getAllByRole } = render(RefusalNotice, {
			props: { refusal: { kind: 'cap', cap: 'admin.seats', limit: 3, current: 3, upgradeUrl: link }, lead: true },
		});
		const [first, second] = getAllByRole('link');
		expect(first.classList.contains('bg-brand')).toBe(true);
		expect(second.classList.contains('bg-surface-2')).toBe(true);
	});

	it('keeps the license page a secondary when it is the only link', () => {
		const { getByRole } = render(RefusalNotice, {
			props: { refusal: { kind: 'cap', cap: 'admin.seats', limit: 3, current: 3, upgradeUrl: '' } },
		});
		expect(getByRole('link', { name: 'View the license' }).classList.contains('bg-surface-2')).toBe(true);
	});

	it('names an add-on link by what it opens', () => {
		const link = 'https://shop.example.com/pricing?skus=example-pro&utm_source=admin&utm_medium=product&utm_campaign=example.items';
		const { getAllByRole } = render(RefusalNotice, {
			props: { refusal: { kind: 'cap', cap: 'example.items', limit: 4, current: 4, upgradeUrl: link } },
		});
		expect(getAllByRole('link').map((a) => a.textContent?.trim())).toEqual(['View the add-on', 'View the license']);
	});

	it('offers only the license page when the cap refusal names no link', () => {
		const { queryAllByRole } = render(RefusalNotice, {
			props: { refusal: { kind: 'cap', cap: 'admin.seats', limit: 3, current: 3, upgradeUrl: '' } },
		});
		expect(queryAllByRole('link').map((a) => a.textContent?.trim())).toEqual(['View the license']);
	});

	it('offers the link the engine sent beside the license page', () => {
		const { getByRole } = render(RefusalNotice, {
			props: { refusal: { kind: 'feature', feature: 'feature-b', plugin: 'widgets', upgradeUrl: 'https://example.com/license' } },
		});
		expect(getByRole('link', { name: 'How to enable it' }).getAttribute('href')).toBe('https://example.com/license');
	});
});

describe('FormErrors with a refusal', () => {
	it('renders the refusal in place of the plain message', () => {
		const { container } = render(FormErrors, {
			props: {
				message: 'raw',
				refused: { kind: 'cap', cap: 'gadgets.probes', limit: 7, current: 7, upgradeUrl: '' },
			},
		});
		expect(container.textContent).toContain("You're using 7 of 7 probes");
		expect(container.textContent).not.toContain('raw');
	});
});

describe('FormErrors with a refusal in a form', () => {
	it('draws no primary beside the form\'s own Create or Save', () => {
		const { container } = render(FormErrors, {
			props: { refused: { kind: 'cap', cap: 'gadgets.probes', limit: 7, current: 7, upgradeUrl: 'https://shop.example.com/pricing?plan=basic' } },
		});
		expect(container.querySelector('a.bg-brand')).toBeNull();
	});
});
