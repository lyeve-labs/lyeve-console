import { describe, expect, it } from 'vitest';
import type { Schema, SchemaField } from '@lyeve-labs/client';
import { apiQuery, filterKeys, listQueryFrom, readView, viewQuery, type Definitions } from './entry-view';

describe('listQueryFrom', () => {
	it('hands back every value of the list view and nothing else', () => {
		const url = new URL(
			'http://localhost/admin/content/posts/e1?filters[author][in]=a1&filters[author][in]=a2&sort=title&tab=history&q=x&offset=100',
		);
		const back = new URLSearchParams(listQueryFrom(url).slice(1));
		expect(back.getAll('filters[author][in]')).toEqual(['a1', 'a2']);
		expect(back.get('sort')).toBe('title');
		expect(back.get('q')).toBe('x');
		expect(back.get('offset')).toBe('100');
		expect(back.has('tab')).toBe(false);
	});

	it('is empty when the detail URL carries no view', () => {
		expect(listQueryFrom(new URL('http://localhost/admin/content/posts/e1'))).toBe('');
	});
});

describe('filter keys through relations', () => {
	const field = (name: string, field_type: string, more: Record<string, unknown> = {}) =>
		({ name, field_type, system: false, ...more }) as SchemaField;
	const relation = (name: string, relation_type: string, relation_to: string, more: Record<string, unknown> = {}) =>
		field(name, 'relation', { relation_type, relation_to, ...more });
	const schema = (name: string, fields: SchemaField[]) => ({ name, display_name: name, fields }) as Schema;

	const posts = schema('posts', [
		field('title', 'text'),
		relation('author', 'belongs_to', 'people'),
		relation('tags', 'many_to_many', 'tag'),
		relation('cover', 'has_one', 'images'),
		relation('comments', 'has_many', 'comments'),
		relation('reviews', 'has_many', 'reviews'),
	]);
	const defs: Definitions = {
		posts,
		people: schema('people', [
			field('name', 'text'),
			field('age', 'integer'),
			field('avatar', 'media'),
			relation('company', 'belongs_to', 'companies'),
			relation('reviews', 'has_many', 'reviews'),
		]),
		tag: schema('tag', [field('slug', 'text')]),
		images: schema('images', [field('alt', 'text'), relation('post', 'belongs_to', 'posts')]),
		comments: schema('comments', [field('body', 'text'), relation('post', 'belongs_to', 'posts')]),
		companies: schema('companies', [
			field('name', 'text'),
			field('founded', 'date'),
			relation('country', 'belongs_to', 'countries'),
		]),
		// No belongs_to toward posts or people, so the list cannot read either Reviews.
		reviews: schema('reviews', [field('stars', 'integer')]),
		countries: schema('countries', [field('code', 'text')]),
	};

	// The listed type's definitions after one content type was deleted.
	function withoutType(name: string): Definitions {
		return Object.fromEntries(Object.entries(defs).filter(([n]) => n !== name));
	}

	it('offers the own fields first, then each relation under its name, two relations deep', () => {
		expect(filterKeys(posts, defs).map((k) => [k.key, k.label])).toEqual([
			['title', 'Entry'],
			['author', 'Author'],
			['tags', 'Tags'],
			['cover', 'Cover'],
			['comments', 'Comments'],
			['reviews', 'Reviews'],
			['created_at', 'Created'],
			['updated_at', 'Updated'],
			['author.name', 'Author, Name'],
			['author.age', 'Author, Age'],
			['author.avatar', 'Author, Avatar'],
			['author.company', 'Author, Company'],
			['author.company.name', 'Author, Company, Name'],
			['author.company.founded', 'Author, Company, Founded'],
			['tags.slug', 'Tags, Slug'],
			['cover.alt', 'Cover, Alt'],
			['cover.post', 'Cover, Post'],
			['cover.post.title', 'Cover, Post, Title'],
			['comments.body', 'Comments, Body'],
			['comments.post', 'Comments, Post'],
			['comments.post.title', 'Comments, Post, Title'],
		]);
	});

	it('takes the operators and the related type of the field a path ends on', () => {
		const keys = new Map(filterKeys(posts, defs).map((k) => [k.key, k]));
		expect(keys.get('author.age')?.family).toBe('number');
		expect(keys.get('author.company.founded')?.family).toBe('date');
		expect(keys.get('author.company')?.family).toBe('relation');
		expect(keys.get('author.company')?.field?.relation_to).toBe('companies');
	});

	it('offers no path through a type whose definition was not read', () => {
		const rest = withoutType('companies');
		const keys = filterKeys(posts, rest).map((k) => k.key);
		expect(keys).toContain('author.name');
		expect(keys.filter((k) => k.startsWith('author.company'))).toEqual([]);
		expect(filterKeys(posts).map((k) => k.key).some((k) => k.includes('.'))).toBe(false);
	});

	it('reads a path from the URL with its operator, and the keys go back out as written', () => {
		const params = new URLSearchParams(
			'filters[author.name][contains]=Ann&filters[tags.slug][eq]=go&filters[author.company.name][eq]=Acme&filters[author.company][in]=c1&filters[author.company][in]=c2',
		);
		const view = readView(params, posts, 100, defs);
		expect(view.filters).toEqual([
			{ key: 'author.name', op: 'contains', values: ['Ann'] },
			{ key: 'tags.slug', op: 'eq', values: ['go'] },
			{ key: 'author.company.name', op: 'eq', values: ['Acme'] },
			{ key: 'author.company', op: 'in', values: ['c1', 'c2'] },
		]);
		const sent = apiQuery('posts', view, '', 0);
		expect(sent.get('filters[author.name][contains]')).toBe('Ann');
		expect(sent.get('filters[tags.slug][eq]')).toBe('go');
		expect(sent.getAll('filters[author.company][in]')).toEqual(['c1', 'c2']);
		const linked = new URLSearchParams(viewQuery(view, posts).slice(1));
		expect(linked.get('filters[author.company.name][eq]')).toBe('Acme');
	});

	it('drops a path that does not resolve, the way a removed field is dropped', () => {
		const rest = withoutType('companies');
		const params = new URLSearchParams(
			[
				'filters[author.company.name][eq]=Acme',
				'filters[author.reviews.stars][gt]=3',
				'filters[reviews.stars][gt]=3',
				'filters[author.company.country.code][eq]=NL',
				'filters[author.nickname][eq]=x',
				'filters[title.name][eq]=x',
				'filters[author.age][contains]=4',
				'filters[author.name][eq]=Ann',
			].join('&'),
		);
		expect(readView(params, posts, 100, rest).filters).toEqual([{ key: 'author.name', op: 'eq', values: ['Ann'] }]);
		// Three relations are one too many, even with every definition read.
		const deep = new URLSearchParams('filters[author.company.country.code][eq]=NL&filters[author.company.country][eq]=n1');
		expect(readView(deep, posts, 100, defs).filters).toEqual([]);
	});
});
