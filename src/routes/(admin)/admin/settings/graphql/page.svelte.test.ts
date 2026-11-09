// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import GraphqlPage from './+page.svelte';

afterEach(cleanup);

const ROOTS = {
	query: [
		{ name: 'landing_page', description: 'A page of landing_page entries.', args: ['offset', 'locale', 'where', 'limit'] },
		{ name: 'health', description: 'Liveness.', args: [] },
	],
	mutation: [{ name: 'updateLandingPage', description: 'Updates one entry.', args: ['id', 'input'] }],
	subscription: [],
};

const props = (over: Record<string, unknown> = {}) => ({
	data: {
		gate: { state: 'ok' },
		schema: { ok: true, value: { roots: ROOTS, refused: null } },
		...over,
	} as never,
});

function nameCell(container: HTMLElement, name: string): HTMLTableCellElement {
	const cell = [...container.querySelectorAll('td')].find((td) => td.textContent?.trim().startsWith(name));
	if (!cell) throw new Error(`no cell for ${name}`);
	return cell;
}

/*
 * The kit's tables wrap a narrow column anywhere, so a field name in the
 * three-column schema grid broke mid-word. Every identifier is held whole,
 * and only the gaps between arguments may break.
 */
describe('Schema field names', () => {
	it('holds each name and argument whole', () => {
		const { container } = render(GraphqlPage, { props: props() });
		const cell = nameCell(container, 'landing_page');

		const whole = [...cell.querySelectorAll('.whitespace-nowrap')].map((el) => el.textContent);
		expect(whole).toEqual(['landing_page', '(offset,', 'locale,', 'where,', 'limit)']);
		expect(cell.textContent?.replace(/\s+/g, ' ').trim()).toBe('landing_page(offset, locale, where, limit)');
	});

	it('holds a name without arguments whole', () => {
		const { container } = render(GraphqlPage, { props: props() });
		const cell = nameCell(container, 'health');

		expect([...cell.querySelectorAll('.whitespace-nowrap')].map((el) => el.textContent)).toEqual(['health']);
		expect(cell.textContent?.trim()).toBe('health');
	});

	it('closes a one-argument list on the argument', () => {
		const { container } = render(GraphqlPage, {
			props: props({
				schema: { ok: true, value: { roots: { query: [{ name: 'post_one', description: '', args: ['id'] }], mutation: [], subscription: [] }, refused: null } },
			}),
		});

		const cell = nameCell(container, 'post_one');
		expect([...cell.querySelectorAll('.whitespace-nowrap')].map((el) => el.textContent)).toEqual(['post_one', '(id)']);
	});
});

describe('the endpoint table', () => {
	it('keeps each method and path on one line, so a narrow screen scrolls the table instead of breaking the path', () => {
		const { container } = render(GraphqlPage, { props: props() });
		const cells = [...container.querySelectorAll('td')].filter((td) =>
			/^(POST|GET) \//.test(td.textContent?.trim() ?? ''),
		);
		expect(cells).toHaveLength(2);
		for (const td of cells) expect(td.getAttribute('data-cell')).toBe('nowrap');
	});
});

describe('layout on narrow and medium screens', () => {
	// With the endpoint cells held on one line, the notes beside them got 43px
	// on a phone and ran forty lines tall.
	it('gives each endpoint note a minimum width, so the table scrolls in its box', () => {
		const { getByText } = render(GraphqlPage, { props: props() });
		for (const text of [/A GET on the same path/, /WebSocket with the graphql-ws protocol/]) {
			expect((getByText(text).closest('td') as HTMLElement).className).toContain('min-w-48');
		}
	});

	// Three tables across at 1024px left the description column 55px wide.
	it('puts the three schema tables side by side only from the extra large breakpoint', () => {
		const { container } = render(GraphqlPage, { props: props() });
		const grid = nameCell(container, 'landing_page').closest('.grid') as HTMLElement;
		expect(grid.className).toContain('xl:grid-cols-3');
		expect(grid.className).not.toContain('lg:grid-cols-3');
	});
});

describe('the schema tab', () => {
	it('opens the GraphQL lab from its try button', () => {
		const { getByRole } = render(GraphqlPage, { props: props() });
		expect(getByRole('link', { name: /Try it in API labs/ }).getAttribute('href')).toBe('/admin/api-labs/graphql');
	});

	it('marks its own tab and sends the allowlist to the other', () => {
		const { getByRole, container } = render(GraphqlPage, { props: props() });
		expect(getByRole('tab', { name: 'Schema' }).getAttribute('aria-selected')).toBe('true');
		expect(container.textContent?.replace(/\s+/g, ' ')).toContain('the query must be on the Persisted queries tab.');
		expect(container.textContent).not.toContain('No persisted queries yet');
	});
});
