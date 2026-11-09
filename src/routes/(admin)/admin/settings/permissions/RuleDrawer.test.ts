// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import type { Permission, Schema } from '@lyeve-labs/client';
import RuleDrawer from './RuleDrawer.svelte';
import { RuleMatrix } from './rules.svelte';

type After = (o: { result: { type: string }; update: (o?: unknown) => Promise<void> }) => Promise<void>;
type Submit = (input: { cancel: () => void }) => Promise<After>;

const forms = vi.hoisted(() => ({ submit: null as Submit | null }));
vi.mock('$app/forms', () => ({
	enhance: (_form: HTMLFormElement, submit: Submit) => {
		forms.submit = submit;
		return { destroy() {} };
	},
}));

afterEach(cleanup);
beforeEach(() => {
	forms.submit = null;
});

let n = 0;
function rule(role: string, schema_name: string, actions: string[], field_mask: string[] = []): Permission {
	n++;
	return { id: `r${n}`, role, schema_name, actions, field_mask, created_at: '2026-01-01T00:00:00Z' } as Permission;
}

const wildcard = rule('editor', '*', ['read', 'update']);
const article = rule('editor', 'article', ['create'], ['notes']);
const rules = new RuleMatrix(() => ({
	permissions: [wildcard, article],
	schemas: [{ name: 'article' }, { name: 'page' }] as Schema[],
	flows: [{ id: 'f1', slug: 'sync', name: 'Sync' }],
}));

function setup(props: Record<string, unknown> = {}) {
	const ondelete = vi.fn();
	const view = render(RuleDrawer, { props: { rules, ondelete, ...props } as never });
	return { ...view, ondelete };
}

const ruleForm = () => document.body.querySelector('form#rule-form') as HTMLFormElement | null;

describe('RuleDrawer', () => {
	it('stays closed until the page asks it to edit', () => {
		setup();
		expect(ruleForm()).toBeNull();
	});

	it('posts a stored rule with the field naming this drawer, its role, resource, actions and mask', () => {
		const { component } = setup();
		flushSync(() => component.edit('editor', 'article'));
		const sent = new FormData(ruleForm() as HTMLFormElement);
		expect(ruleForm()?.getAttribute('action')).toBe('?/upsert');
		expect(sent.get('drawer')).toBe('rule');
		expect(sent.get('role')).toBe('editor');
		expect(sent.get('schema_name')).toBe('article');
		expect(sent.getAll('actions')).toEqual(['create']);
		expect(sent.get('field_mask')).toBe('notes');
		expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
	});

	it('starts a new schema rule from the wildcard rule it replaces and warns what it replaces', () => {
		const { component } = setup();
		flushSync(() => component.edit('editor', 'page'));
		expect(new FormData(ruleForm() as HTMLFormElement).getAll('actions')).toEqual(['read', 'update']);
		expect(ruleForm()?.textContent).toContain('This rule replaces the wildcard rule on page');
		expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
	});

	it('offers activate only on a flow resource', () => {
		const { component } = setup();
		flushSync(() => component.edit('editor', 'flow:sync'));
		expect(screen.getByRole('checkbox', { name: /Activate/ })).toBeTruthy();
		cleanup();
		const again = setup();
		flushSync(() => again.component.edit('editor', 'article'));
		expect(screen.queryByRole('checkbox', { name: /Activate/ })).toBeNull();
	});

	it('says the flows could not be read when a new resource is to be chosen', () => {
		const { component } = setup({ flowsFailed: true });
		flushSync(() => component.edit('editor', null));
		expect(ruleForm()?.textContent).toContain('Could not load flows');
		expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('shows the failure it is given first in its form', () => {
		const { component } = setup({ error: 'Could not save the rule. Try again.' });
		flushSync(() => component.edit('editor', 'article'));
		expect(ruleForm()?.firstElementChild?.textContent).toContain('Could not save the rule. Try again.');
	});

	it('hands a stored rule emptied of every grant to the page to delete', async () => {
		const reviewer = rule('reviewer', 'article', ['read']);
		const lone = new RuleMatrix(() => ({ permissions: [reviewer], schemas: [{ name: 'article' }] as Schema[] }));
		const { component, ondelete } = setup({ rules: lone });
		flushSync(() => component.edit('reviewer', 'article'));
		await fireEvent.click(screen.getByRole('checkbox', { name: /Read/ }));
		expect(ruleForm()?.textContent).toContain('This rule would do nothing');
		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		expect(ondelete).toHaveBeenCalledWith(reviewer);
	});

	it('closes on success and stays open on a failure, keeping the fields', async () => {
		const { component } = setup();
		flushSync(() => component.edit('editor', 'article'));
		const update = vi.fn(async () => {});
		await (await (forms.submit as Submit)({ cancel: () => {} }))({ result: { type: 'failure' }, update });
		await tick();
		expect(ruleForm()).toBeTruthy();
		expect(update).toHaveBeenCalledWith({ reset: false });
		await (await (forms.submit as Submit)({ cancel: () => {} }))({ result: { type: 'success' }, update });
		await vi.waitFor(() => expect(ruleForm()).toBeNull());
	});
});
