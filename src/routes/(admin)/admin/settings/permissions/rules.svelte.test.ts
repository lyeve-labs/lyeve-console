import { describe, expect, it } from 'vitest';
import type { Permission, Schema } from '@lyeve-labs/client';
import { RuleMatrix, rollUp, parentOf, schemaLabel, type RuleSource } from './rules.svelte';

let n = 0;
function rule(role: string, schema_name: string, actions: string[], field_mask: string[] = []): Permission {
	n++;
	return { id: `r${n}`, role, schema_name, actions, field_mask, created_at: '2026-01-01T00:00:00Z' } as Permission;
}

function matrix(permissions: Permission[], schemas: string[] = ['article', 'page'], flows: string[] = []) {
	const source: RuleSource = {
		permissions,
		schemas: schemas.map((name) => ({ name }) as Schema),
		flows: flows.map((slug) => ({ id: slug, slug, name: slug })),
	};
	return new RuleMatrix(() => source);
}

describe('rule matrix', () => {
	it('folds an empty set to none, never to all', () => {
		expect(rollUp([], () => true)).toBe('none');
		expect(rollUp([1, 2], (x) => x === 1)).toBe('some');
		expect(rollUp([1, 2], () => true)).toBe('all');
	});

	it('names the parent rule of each kind of resource', () => {
		expect(parentOf('article')).toBe('*');
		expect(parentOf('flow:sync')).toBe('flows');
		expect(parentOf('*')).toBeNull();
		expect(parentOf('flows')).toBeNull();
		expect(schemaLabel('*')).toBe('every content type');
		expect(schemaLabel('flows')).toBe('All flows');
	});

	it('seeds the built-in roles and adds every role a rule names', () => {
		expect(matrix([rule('reviewer', '*', [])]).allRoles).toEqual(['super_admin', 'admin', 'editor', 'reviewer']);
	});

	it('lets a schema rule replace the wildcard rule on that schema alone', () => {
		const m = matrix([rule('editor', '*', ['read', 'update']), rule('editor', 'article', ['create'])]);
		expect(m.effectiveActions('editor', 'article')).toEqual(['create']);
		expect(m.effectiveActions('editor', 'page')).toEqual(['read', 'update']);
		expect(m.markFor('editor', 'article', 'read')).toBe('none');
		expect(m.markFor('editor', 'article', 'create')).toBe('stored');
		expect(m.markFor('editor', 'page', 'read')).toBe('inherited');
		expect(m.markText('editor', 'article', 'read')).toBe(
			'editor is denied read on article. This rule replaces the wildcard rule, which grants it.',
		);
	});

	it('reads the rules again when the data it was given changes', () => {
		const source = $state<RuleSource>({ permissions: [rule('editor', '*', ['read'])], schemas: [{ name: 'article' }] as Schema[] });
		const m = new RuleMatrix(() => source);
		expect(m.markFor('editor', 'article', 'read')).toBe('inherited');
		source.permissions = [rule('editor', 'article', [])];
		expect(m.markFor('editor', 'article', 'read')).toBe('none');
		source.permissions = [rule('editor', 'article', ['read'])];
		expect(m.markFor('editor', 'article', 'read')).toBe('stored');
	});

	it('marks the exempt role exempt whatever its rules say', () => {
		const m = matrix([rule('super_admin', 'article', [])]);
		expect(m.markFor('super_admin', 'article', 'read')).toBe('exempt');
	});

	it('keeps the wildcard rule away from flows in the summary', () => {
		const m = matrix([rule('editor', '*', ['read'])], ['article'], ['sync']);
		expect(m.summaryState('editor', 'read')).toBe('some');
		expect(m.summaryText('editor', 'read')).toBe('editor grants read on every content type. editor grants read on no flow.');
		expect(m.summaryText('editor', 'activate')).toBe('editor grants activate on no flow.');
	});

	it('counts a rule on a dropped schema among the role resources', () => {
		const m = matrix([rule('editor', 'gone', ['read'])]);
		expect(m.roleSchemas.editor).toContain('gone');
		expect(m.unruledSchemas('editor').map((o) => o.value)).not.toContain('gone');
	});

	it('says an empty rule replaces a grant only where something is inherited or admin holds a flow', () => {
		const m = matrix([rule('editor', '*', ['read'])]);
		expect(m.replacesAGrant('editor', 'article')).toBe(true);
		expect(m.replacesAGrant('reviewer', 'article')).toBe(false);
		expect(m.replacesAGrant('admin', 'flow:sync')).toBe(true);
		expect(m.replacesAGrant('editor', '')).toBe(false);
	});
});
