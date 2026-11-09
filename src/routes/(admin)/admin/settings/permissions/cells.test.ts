// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Permission, Schema } from '@lyeve-labs/client';
import FieldMaskCell from './FieldMaskCell.svelte';
import MarkCell from './MarkCell.svelte';
import RuleControls from './RuleControls.svelte';
import SummaryCell from './SummaryCell.svelte';
import { RuleMatrix } from './rules.svelte';

afterEach(cleanup);

let n = 0;
function rule(role: string, schema_name: string, actions: string[], field_mask: string[] = []): Permission {
	n++;
	return { id: `r${n}`, role, schema_name, actions, field_mask, created_at: '2026-01-01T00:00:00Z' } as Permission;
}

function matrix(permissions: Permission[]) {
	const source = { permissions, schemas: [{ name: 'article' }, { name: 'page' }] as Schema[], flows: [] };
	return new RuleMatrix(() => source);
}

const rules = matrix([
	rule('editor', '*', ['read'], ['secret']),
	rule('editor', 'article', ['create'], ['notes']),
	rule('super_admin', 'article', ['read']),
]);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('MarkCell', () => {
	const mark = (role: string, schema: string, action: string) =>
		render(MarkCell, { props: { rules, role, schema, action } as never }).container;

	it('draws a stored grant as a filled dot and says which rule grants it', () => {
		const c = mark('editor', 'article', 'create');
		expect(c.querySelector('svg[data-mark="stored"] circle')?.getAttribute('fill')).toBe('currentColor');
		expect(said(c)).toBe('editor is granted create on article by this rule.');
	});

	it('draws an inherited grant as a ring and names the parent rule', () => {
		const c = mark('editor', 'page', 'read');
		expect(c.querySelector('svg[data-mark="inherited"] circle')?.getAttribute('stroke')).toBe('currentColor');
		expect(said(c)).toContain('by the wildcard rule, because page has no rule of its own');
	});

	it('draws a denial as a dash', () => {
		const c = mark('editor', 'article', 'read');
		expect(c.querySelector('[data-mark="none"]')?.classList.contains('lucide-minus')).toBe(true);
		expect(said(c)).toContain('editor is denied read on article.');
	});

	it('draws the exempt role as a shield that screen readers skip', () => {
		const c = mark('super_admin', 'article', 'delete');
		const svg = c.querySelector('svg[data-mark="exempt"]');
		expect(svg?.classList.contains('lucide-shield-check')).toBe(true);
		expect(svg?.getAttribute('aria-hidden')).toBe('true');
		expect(said(c)).toContain('The role is exempt from these rules.');
	});

	it('draws nothing for activate on a schema and says it does not apply', () => {
		const c = mark('editor', 'article', 'activate');
		expect(c.querySelector('svg')).toBeNull();
		expect(said(c)).toBe('activate does not apply to article.');
	});
});

describe('SummaryCell', () => {
	const summary = (role: string, action: string) =>
		render(SummaryCell, { props: { rules, role, action } as never }).container;

	it('fills the bar by how much of the role grants the action, drawn in currentColor', () => {
		const some = summary('editor', 'create');
		const bar = some.querySelector('svg[data-summary="some"]');
		expect(bar?.querySelector('rect:not([data-fill])')?.getAttribute('stroke')).toBe('currentColor');
		expect(bar?.querySelector('rect[data-fill]')?.getAttribute('width')).toBe('16');
		cleanup();
		expect(summary('admin', 'read').querySelector('rect[data-fill]')?.getAttribute('width')).toBe('0');
	});

	it('says what the bar shows to a screen reader', () => {
		expect(said(summary('editor', 'read'))).toBe('editor grants read on some content types. editor grants read on no flow.');
	});

	it('marks the exempt role with a shield and says it is always allowed', () => {
		const c = summary('super_admin', 'update');
		expect(c.querySelector('[data-mark="exempt"]')).toBeTruthy();
		expect(said(c)).toBe('super_admin is always allowed update on every content type. The role is exempt from these rules.');
	});
});

describe('FieldMaskCell', () => {
	const cell = (role: string, schema: string, perm: Permission | undefined) =>
		render(FieldMaskCell, { props: { rules, role, schema, perm } }).container;

	it('names the mask of a schema rule and the wildcard mask that adds to it', () => {
		const c = cell('editor', 'article', rules.rule('editor', 'article'));
		expect(said(c)).toBe('notes plus secret from the wildcard rule');
	});

	it('says none on a rule with no mask', () => {
		expect(said(cell('admin', 'article', undefined))).toBe('none');
	});

	it('adds nothing beneath the wildcard rule itself', () => {
		expect(said(cell('editor', '*', rules.rule('editor', '*')))).toBe('secret');
	});
});

describe('RuleControls', () => {
	function controls(role: string, schema: string, perm: Permission | undefined) {
		const onedit = vi.fn();
		const ondelete = vi.fn();
		render(RuleControls, { props: { role, schema, perm, onedit, ondelete } });
		return { onedit, ondelete };
	}

	it('edits and removes a stored rule through the page', async () => {
		const perm = rules.rule('editor', 'article') as Permission;
		const { onedit, ondelete } = controls('editor', 'article', perm);
		await fireEvent.click(screen.getByRole('button', { name: 'Edit rule for editor on article' }));
		expect(onedit).toHaveBeenCalledWith('editor', 'article');
		await fireEvent.click(screen.getByRole('button', { name: 'Remove rule for editor on article' }));
		expect(ondelete).toHaveBeenCalledWith(perm);
	});

	it('offers only an add where the row has no rule', () => {
		controls('editor', 'page', undefined);
		expect(screen.getByRole('button', { name: 'Add rule for editor on page' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Remove rule/ })).toBeNull();
	});

	it('disables the grant control under the exempt role', () => {
		controls('super_admin', 'article', rules.rule('super_admin', 'article'));
		expect((screen.getByRole('button', { name: /Edit rule for super_admin/ }) as HTMLButtonElement).disabled).toBe(true);
	});
});
