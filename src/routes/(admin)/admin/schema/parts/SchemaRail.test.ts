// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Schema } from '@lyeve-labs/client';
import SchemaRail from './SchemaRail.svelte';

afterEach(cleanup);

function many(n: number): Schema[] {
	return Array.from({ length: n }, (_, i) => ({ name: `s${String(i).padStart(3, '0')}`, display_name: `S ${i}`, fields: [] }));
}

const schemas: Schema[] = [
	{
		name: 'posts',
		display_name: 'Posts',
		fields: [
			{ id: 'a', name: 'title', field_type: 'text', required: false, unique: false, indexed: false },
			{ id: 'b', name: 'author', field_type: 'relation', relation_type: 'belongs_to', relation_to: 'authors', required: false, unique: false, indexed: false },
		],
	},
	{ name: 'authors', display_name: 'Authors', fields: [] },
];

describe('SchemaRail', () => {
	it('names each row by its schema and marks the open one', () => {
		render(SchemaRail, { props: { schemas, rowCounts: { posts: 1 }, current: 'posts', onselect: vi.fn() } });
		const posts = screen.getByRole('button', { name: 'Posts' });
		expect(posts.getAttribute('aria-current')).toBe('true');
		const text = (posts.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toContain('2 fields');
		expect(text).toContain('1 rel');
		expect(text).toContain('1 row');
		expect(screen.getByRole('button', { name: 'Authors' }).getAttribute('aria-current')).toBeNull();
	});

	it('leaves out a row count it could not read rather than showing 0', () => {
		render(SchemaRail, { props: { schemas, rowCounts: {}, current: undefined, onselect: vi.fn() } });
		expect(screen.getByRole('button', { name: 'Authors' }).textContent).not.toMatch(/\brows?\b/);
	});

	it('hands the picked schema up', async () => {
		const onselect = vi.fn();
		render(SchemaRail, { props: { schemas, rowCounts: {}, current: undefined, onselect } });
		await fireEvent.click(screen.getByRole('button', { name: 'Authors' }));
		expect(onselect).toHaveBeenCalledWith(schemas[1]);
	});

	it('narrows by name or display name and says when nothing matches', async () => {
		render(SchemaRail, { props: { schemas, rowCounts: {}, current: undefined, onselect: vi.fn() } });
		const filter = screen.getByLabelText('Filter content types');
		await fireEvent.input(filter, { target: { value: 'auth' } });
		expect(screen.queryByRole('button', { name: 'Posts' })).toBeNull();
		await fireEvent.input(filter, { target: { value: 'zzz' } });
		expect(screen.getByText('No content types match this filter.')).toBeTruthy();
	});

	it('draws a hundred rows at a time and starts again from the top on a new filter', async () => {
		render(SchemaRail, { props: { schemas: many(230), rowCounts: {}, current: undefined, onselect: vi.fn() } });
		await fireEvent.click(screen.getByRole('button', { name: 'Show 100 more of 130' }));
		expect(screen.getByRole('button', { name: 'Show 30 more of 30' })).toBeTruthy();
		await fireEvent.input(screen.getByLabelText('Filter content types'), { target: { value: 's' } });
		expect(screen.getByRole('button', { name: 'Show 100 more of 130' })).toBeTruthy();
	});

	it('offers no filter for a single schema', () => {
		render(SchemaRail, { props: { schemas: schemas.slice(0, 1), rowCounts: {}, current: undefined, onselect: vi.fn() } });
		expect(screen.queryByLabelText('Filter content types')).toBeNull();
	});
});
