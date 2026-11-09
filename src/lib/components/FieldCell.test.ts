// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import FieldCell from './FieldCell.svelte';
import type { FieldType, SchemaField } from '@lyeve-labs/client';

afterEach(cleanup);

// The shared empty marker rendered for every field type.
const EMPTY = 'Not set';

const field = (field_type: FieldType, extra: Partial<SchemaField> = {}): SchemaField => ({
	name: 'f',
	field_type,
	required: false,
	unique: false,
	indexed: false,
	...extra,
});

describe('FieldCell', () => {
	it('renders a plain text value', () => {
		const { getByText } = render(FieldCell, {
			props: { field: field('text'), value: 'Hello World' },
		});
		expect(getByText('Hello World')).toBeTruthy();
	});

	it('renders a number value', () => {
		const { getByText } = render(FieldCell, {
			props: { field: field('number'), value: 42 },
		});
		expect(getByText('42')).toBeTruthy();
	});

	it('renders a decimal with its trailing zeros', () => {
		const { getByText } = render(FieldCell, {
			props: { field: field('decimal', { precision: 10, scale: 2 }), value: '19.90' },
		});
		expect(getByText('19.90')).toBeTruthy();
	});

	it('renders a success badge for a true boolean', () => {
		const { getByText } = render(FieldCell, {
			props: { field: field('boolean'), value: true },
		});
		expect(getByText('true')).toBeTruthy();
	});

	it('renders "false" for a false boolean', () => {
		const { getByText } = render(FieldCell, {
			props: { field: field('boolean'), value: false },
		});
		expect(getByText('false')).toBeTruthy();
	});

	it('renders a url as a link with the protocol stripped', () => {
		const { getByRole, getByText } = render(FieldCell, {
			props: { field: field('url'), value: 'https://example.com/page' },
		});
		expect(getByText('example.com/page')).toBeTruthy();
		expect(getByRole('link').getAttribute('href')).toBe('https://example.com/page');
	});

	it('renders the empty marker for an empty url', () => {
		const { getByText } = render(FieldCell, {
			props: { field: field('url'), value: '' },
		});
		expect(getByText(EMPTY)).toBeTruthy();
	});

	it('renders an email as a mailto link', () => {
		const { getByRole } = render(FieldCell, {
			props: { field: field('email'), value: 'user@example.com' },
		});
		expect(getByRole('link').getAttribute('href')).toBe('mailto:user@example.com');
	});

	it('renders a redacted email as text, not as a mailto link', () => {
		// A read comes back through the tenant's field rules, and a value those
		// rules cover arrives as a sentinel. An underlined link to it invites a
		// click that opens a message addressed to nothing.
		const { getByText, queryByRole } = render(FieldCell, {
			props: { field: field('email'), value: '[redacted]' },
		});
		expect(getByText('[redacted]')).toBeTruthy();
		expect(queryByRole('link')).toBeNull();
	});

	it('renders a masked email as text, not as a mailto link', () => {
		const { getByText, queryByRole } = render(FieldCell, {
			props: { field: field('email'), value: 'j***@example.com' },
		});
		expect(getByText('j***@example.com')).toBeTruthy();
		expect(queryByRole('link')).toBeNull();
	});

	it('renders a redacted url as text, not as a link', () => {
		// href="[redacted]" is a relative path, so a link would navigate inside
		// the admin instead of doing nothing visible.
		const { getByText, queryByRole } = render(FieldCell, {
			props: { field: field('url'), value: '[redacted]' },
		});
		expect(getByText('[redacted]')).toBeTruthy();
		expect(queryByRole('link')).toBeNull();
	});

	it('renders a json placeholder', () => {
		const { getByText } = render(FieldCell, {
			props: { field: field('json'), value: { a: 1 } },
		});
		expect(getByText('{...}')).toBeTruthy();
	});

	it('strips html from rich_text', () => {
		const { getByText } = render(FieldCell, {
			props: { field: field('rich_text'), value: '<p>Hello <b>World</b></p>' },
		});
		expect(getByText('Hello World')).toBeTruthy();
	});

	it('renders an item count badge for a has_many relation array', () => {
		const { getByText } = render(FieldCell, {
			props: { field: field('relation'), value: ['id-1', 'id-2'] },
		});
		expect(getByText('2 items')).toBeTruthy();
	});

	it('renders a singular item label for a one-element relation array', () => {
		const { getByText } = render(FieldCell, {
			props: { field: field('relation'), value: ['id-1'] },
		});
		expect(getByText('1 item')).toBeTruthy();
	});

	it('renders a populated relation object using its title field', () => {
		const { getByText } = render(FieldCell, {
			props: { field: field('relation'), value: { title: 'Foo' } },
		});
		expect(getByText('Foo')).toBeTruthy();
	});

	it('renders the empty marker for a null value', () => {
		const { getByText } = render(FieldCell, {
			props: { field: field('text'), value: null },
		});
		expect(getByText(EMPTY)).toBeTruthy();
	});

	it('renders the empty marker for a json value and never the populated chip', () => {
		for (const value of [null, undefined, '']) {
			const { getByText, queryByText } = render(FieldCell, {
				props: { field: field('json'), value },
			});
			expect(getByText(EMPTY)).toBeTruthy();
			expect(queryByText('{...}')).toBeNull();
			cleanup();
		}
	});

	it('renders the empty marker for an empty boolean, number, relation and date', () => {
		for (const type of ['boolean', 'number', 'relation', 'date'] as const) {
			const { getByText } = render(FieldCell, {
				props: { field: field(type), value: null },
			});
			expect(getByText(EMPTY)).toBeTruthy();
			cleanup();
		}
	});

	it('renders the number zero as a value, not as empty', () => {
		const { getByText, queryByText } = render(FieldCell, {
			props: { field: field('number'), value: 0 },
		});
		expect(getByText('0')).toBeTruthy();
		expect(queryByText(EMPTY)).toBeNull();
	});

	it('renders the boolean false as a value, not as empty', () => {
		const { getByText, queryByText } = render(FieldCell, {
			props: { field: field('boolean'), value: false },
		});
		expect(getByText('false')).toBeTruthy();
		expect(queryByText(EMPTY)).toBeNull();
	});
	/*
	 * `toLocale*` with no locale reads the same row differently in two browsers
	 * and moves a date-only value to the day before for anyone behind UTC.
	 */
	it('renders a date cell as an ISO day in UTC', () => {
		const { getByText } = render(FieldCell, {
			props: { field: field('date'), value: '2026-03-04T23:30:00Z' },
		});
		expect(getByText('2026-03-04')).toBeTruthy();
	});

	it('renders a datetime cell with its zone named', () => {
		const { getByText } = render(FieldCell, {
			props: { field: field('datetime'), value: '2026-09-08T14:32:07Z' },
		});
		expect(getByText('2026-09-08 14:32 UTC')).toBeTruthy();
	});

	// A cell is the only place the reader sees what is in the column, so a value
	// that will not parse keeps its own text instead of reading "Invalid Date".
	it('keeps an unparseable stored value visible', () => {
		const { getByText } = render(FieldCell, {
			props: { field: field('datetime'), value: '0000-00-00 00:00:00' },
		});
		expect(getByText('0000-00-00 00:00:00')).toBeTruthy();
	});
});
