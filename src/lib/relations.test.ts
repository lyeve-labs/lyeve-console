import { describe, expect, it } from 'vitest';
import type { Schema, SchemaField } from '@lyeve-labs/client';
import { fkColumn, pivotTable, planRelation, planSchemaRelations, tableName } from './relations';

function schema(name: string, fields: Partial<SchemaField>[] = [], display?: string): Schema {
	return {
		name,
		display_name: display ?? '',
		fields: fields.map((f) => ({
			name: '',
			field_type: 'text',
			required: false,
			unique: false,
			indexed: false,
			...f,
		})) as SchemaField[],
	} as Schema;
}

function relation(name: string, to: string, type: SchemaField['relation_type']): SchemaField {
	return {
		name,
		field_type: 'relation',
		relation_to: to,
		relation_type: type,
		required: false,
		unique: false,
		indexed: false,
	} as SchemaField;
}

describe('naming mirrors the engine', () => {
	it('lowercases a table name and folds its dashes', () => {
		expect(tableName('Blog-Post')).toBe('_blog_post');
	});

	it('orders a pivot pair alphabetically, so both sides name one table', () => {
		expect(pivotTable('tag', 'article')).toBe(pivotTable('article', 'tag'));
		expect(pivotTable('tag', 'article')).toBe('_pivot_article_tag');
	});

	it('orders a pivot pair after folding, not before', () => {
		// Sorting the raw names puts a capital ahead of every lowercase letter,
		// so the two sides of one relation would name two different tables.
		expect(pivotTable('Tag', 'article')).toBe('_pivot_article_tag');
	});

	it('takes an explicit key column over the derived one', () => {
		expect(fkColumn('author')).toBe('author_id');
		expect(fkColumn('author', 'written_by')).toBe('written_by');
	});
});

describe('planRelation', () => {
	const author = schema('author', [], 'Author');
	const post = schema('post', [relation('author', 'author', 'belongs_to')], 'Post');

	it('says nothing about a field that is not a relation', () => {
		expect(planRelation(post, post.fields[0], [post, author])).toBeTruthy();
		const plain = schema('post', [{ name: 'title' }]);
		expect(planRelation(plain, plain.fields[0], [plain])).toBeNull();
	});

	it('says nothing about a relation naming no target', () => {
		const orphan = schema('post', [{ name: 'author', field_type: 'relation' }]);
		expect(planRelation(orphan, orphan.fields[0], [orphan])).toBeNull();
	});

	it('names the column belongs_to adds, on this table', () => {
		const plan = planRelation(post, post.fields[0], [post, author])!;
		expect(plan.reads).toBe('_post.author_id');
		expect(plan.creates.join(' ')).toContain('_post');
		expect(plan.creates.join(' ')).toContain('_author(id)');
		expect(plan.kind.storage).toBe('this content type');
	});

	it('states which way a delete travels, because required changes it', () => {
		const optional = planRelation(post, post.fields[0], [post, author])!;
		expect(optional.creates.join(' ')).toContain('NULL');
		const req = schema('post', [{ ...relation('author', 'author', 'belongs_to'), required: true }], 'Post');
		const required = planRelation(req, req.fields[0], [req, author])!;
		expect(required.creates.join(' ')).toContain('NOT NULL');
		expect(required.creates.join(' ')).toContain('deletes every Post row');
	});

	it('reads an inverse relation through the key named after this schema', () => {
		// Not after the field. A field called `articles` on `author` still
		// resolves through `author_id`, so renaming it moves nothing.
		const withPosts = schema('author', [relation('articles', 'post', 'has_many')], 'Author');
		const plan = planRelation(withPosts, withPosts.fields[0], [withPosts, post])!;
		expect(plan.reads).toBe('_post.author_id');
		expect(plan.creates).toHaveLength(0);
		expect(plan.requires?.column).toBe('author_id');
		expect(plan.requires?.satisfied).toBe(true);
		expect(plan.problem).toBeNull();
	});

	it('reports an inverse relation the other schema cannot answer', () => {
		const lonely = schema('author', [relation('posts', 'post', 'has_many')], 'Author');
		const bare = schema('post', [{ name: 'title' }], 'Post');
		const plan = planRelation(lonely, lonely.fields[0], [lonely, bare])!;
		expect(plan.requires?.satisfied).toBe(false);
		expect(plan.problem).toContain('_post.author_id');
		expect(plan.problem).toContain('empty list');
	});

	it('accepts an inverse satisfied by an overridden key column', () => {
		const renamed = schema('post', [
			{ ...relation('writer', 'author', 'belongs_to'), relation_fk_name: 'author_id' },
		]);
		const owner = schema('author', [relation('posts', 'post', 'has_many')]);
		expect(planRelation(owner, owner.fields[0], [owner, renamed])!.requires?.satisfied).toBe(true);
	});

	it('does not count a has_many on the other side as the key it needs', () => {
		// Two inverse sides pointing at each other produce no column anywhere.
		const a = schema('author', [relation('posts', 'post', 'has_many')]);
		const b = schema('post', [relation('author', 'author', 'has_one')]);
		expect(planRelation(a, a.fields[0], [a, b])!.requires?.satisfied).toBe(false);
	});

	it('names the pivot a many-to-many builds and neither schema owns', () => {
		const article = schema('article', [relation('tags', 'tag', 'many_to_many')], 'Article');
		const tag = schema('tag', [], 'Tag');
		const plan = planRelation(article, article.fields[0], [article, tag])!;
		expect(plan.reads).toBe('_pivot_article_tag');
		expect(plan.creates.join(' ')).toContain('article_id');
		expect(plan.creates.join(' ')).toContain('tag_id');
		expect(plan.kind.storage).toBe('a pivot table');
	});

	it('takes an explicit pivot name over the derived one', () => {
		const article = schema('article', [
			{ ...relation('tags', 'tag', 'many_to_many'), relation_through: '_article_tags' },
		]);
		expect(planRelation(article, article.fields[0], [article, schema('tag')])!.reads).toBe(
			'_article_tags',
		);
	});

	it('refuses a pivot from a schema to itself, which needs one column twice', () => {
		const s = schema('tag', [relation('related', 'tag', 'many_to_many')], 'Tag');
		expect(planRelation(s, s.fields[0], [s])!.problem).toContain('tag_id');
	});

	it('reports a target that is not a schema here', () => {
		const s = schema('post', [relation('author', 'ghost', 'has_one')]);
		expect(planRelation(s, s.fields[0], [s])!.problem).toContain('not a content type');
	});
});

describe('planSchemaRelations', () => {
	it('returns one plan per relation field and skips the rest', () => {
		const post = schema('post', [
			{ name: 'title' },
			relation('author', 'author', 'belongs_to'),
			{ name: 'body', field_type: 'rich_text' },
			relation('tags', 'tag', 'many_to_many'),
		]);
		const plans = planSchemaRelations(post, [post, schema('author'), schema('tag')]);
		expect(plans.map((p) => p.field.name)).toEqual(['author', 'tags']);
	});
});
