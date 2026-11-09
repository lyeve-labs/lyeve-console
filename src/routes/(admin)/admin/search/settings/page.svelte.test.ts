// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import SettingsPage from './+page.svelte';
import { outlineSkips } from '$lib/test-outline';

afterEach(cleanup);

const ok = (value: unknown) => ({ ok: true, value });

function data(overrides: Record<string, unknown> = {}) {
	return {
		ranking: ok({
			id: '',
			schema_name: '*',
			title_weight: 1,
			body_weight: 0.4,
			tag_weight: 0.2,
			boost_rules: [],
			created_at: '',
			updated_at: '',
		}),
		publicSchemas: ok([]),
		schemas: ok(['blog']),
		canReindex: false,
		...overrides,
	};
}

/** Each heading level that follows one more than a level shallower, in document order. */
function skippedLevels(): string[] {
	const levels = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => ({ level: Number(h.tagName[1]), text: h.textContent?.trim() ?? '' }));
	return levels.filter((h, i) => i > 0 && h.level > levels[i - 1].level + 1).map((h) => `h${h.level} ${h.text}`);
}

describe('Search settings refusals', () => {
	it('names public search in lower case inside the role refusal', () => {
		const { container } = render(SettingsPage, {
			props: { data: data({ publicSchemas: { ok: false, gate: { state: 'forbidden' } } }) as never, form: null },
		});
		expect(container.textContent).toContain('Your role cannot open public search.');
	});

	it('names the schemas in lower case inside the role refusal', () => {
		const { container } = render(SettingsPage, {
			props: { data: data({ schemas: { ok: false, gate: { state: 'forbidden' } } }) as never, form: null },
		});
		expect(container.textContent).toContain('Your role cannot open the content types.');
	});
});

describe('Search settings', () => {
	it('puts its settings cards one level under the page title', () => {
		render(SettingsPage, { props: { data: data({ publicSchemas: ok(['blog']), canReindex: true }) as never, form: null } });
		expect(document.querySelector('h1')).not.toBeNull();
		expect(skippedLevels()).toEqual([]);
		for (const name of ['Public search', 'Ranking weights', 'Index']) {
			expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
		}
	});

	it('offers each schema for public search in a searchable picker', () => {
		const { container } = render(SettingsPage, {
			props: { data: data({ publicSchemas: ok(['blog']) }) as never, form: null },
		});
		expect(container.querySelector('input[type="hidden"][name="schemas"]')?.getAttribute('value')).toBe('blog');
		expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
	});

	it('offers no weights and no Save when the ranking read failed', () => {
		const { getByText, queryByLabelText } = render(SettingsPage, {
			props: { data: data({ ranking: { ok: false, gate: { state: 'unavailable' } } }) as never, form: null },
		});
		expect(getByText(/ranking weights did not load/)).toBeTruthy();
		expect(queryByLabelText('Title')).toBeNull();
	});

	it('says the schemas could not be read instead of calling them empty', () => {
		const { getByText, queryByText } = render(SettingsPage, {
			props: {
				data: data({ schemas: { ok: false, gate: { state: 'error', message: 'Could not load schemas.' } } }) as never,
				form: null,
			},
		});
		expect(getByText('Could not load schemas.')).toBeTruthy();
		expect(queryByText('No content types yet')).toBeNull();
	});

	it('offers the index to a super admin only', () => {
		render(SettingsPage, { props: { data: data() as never, form: null } });
		expect(screen.queryByRole('button', { name: 'Rebuild index' })).toBeNull();
		cleanup();
		render(SettingsPage, { props: { data: data({ canReindex: true }) as never, form: null } });
		expect(screen.getByRole('button', { name: 'Rebuild index' })).toBeTruthy();
	});
});

describe('Search settings public request', () => {
	// The field shows the request it copies, so what lands on the clipboard
	// is what the reader read.
	it('shows the example request in a field that copies exactly that', () => {
		render(SettingsPage, { props: { data: data({ publicSchemas: ok(['blog']) }) as never, form: null } });
		const field = screen.getByLabelText('Example GET request') as HTMLTextAreaElement;
		expect(field.value).toBe('/api/v1/search/blog?q=kettle');
		expect(field.readOnly).toBe(true);
		expect(screen.getByRole('button', { name: 'Copy the request' })).toBeTruthy();
	});

	// A public query matches every field and its snippet can quote any of
	// them, so the picker must not promise that the body stays private.
	it('says a public schema exposes every field to a query', () => {
		const { container } = render(SettingsPage, { props: { data: data() as never, form: null } });
		const text = container.textContent ?? '';
		expect(text).toContain('A query matches every field, and the snippet can quote any of them');
		expect(text).not.toContain('never the stored body');
	});
});

describe('heading outline', () => {
	it('steps its headings down one level at a time', () => {
		const { container } = render(SettingsPage, { props: { data: data({ canReindex: true }) as never, form: null } });
		expect(outlineSkips(container)).toEqual([]);
	});
});
