// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import RoleDrawer from './RoleDrawer.svelte';

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

const roleForm = () => document.body.querySelector('form#role-form') as HTMLFormElement | null;

describe('RoleDrawer', () => {
	it('writes the new role as a wildcard rule with the field naming this drawer', async () => {
		render(RoleDrawer, { props: { open: true } });
		await fireEvent.input(screen.getByLabelText(/Role name/), { target: { value: 'reviewer' } });
		const sent = new FormData(roleForm() as HTMLFormElement);
		expect(roleForm()?.getAttribute('action')).toBe('?/upsert');
		expect(sent.get('drawer')).toBe('role');
		expect(sent.get('schema_name')).toBe('*');
		expect(sent.get('role')).toBe('reviewer');
		expect(sent.getAll('actions')).toEqual([]);
	});

	it('shows the failure it is given first in its form', () => {
		render(RoleDrawer, { props: { open: true, error: 'Could not save the rule. Try again.' } });
		expect(roleForm()?.firstElementChild?.textContent).toContain('Could not save the rule. Try again.');
	});

	it('shows the role ceiling refusal with its numbers', () => {
		const refused = { kind: 'cap', cap: 'rbac.roles', limit: 3, current: 3, upgradeUrl: '' } as const;
		render(RoleDrawer, { props: { open: true, refused: refused as never } });
		expect(roleForm()?.textContent).toContain("You're using 3 of 3 roles");
	});

	it('closes and clears the name on success, and stays open on a failure', async () => {
		render(RoleDrawer, { props: { open: true } });
		await fireEvent.input(screen.getByLabelText(/Role name/), { target: { value: 'reviewer' } });
		const update = vi.fn(async () => {});
		await (await (forms.submit as Submit)({ cancel: () => {} }))({ result: { type: 'failure' }, update });
		await tick();
		expect((screen.getByLabelText(/Role name/) as HTMLInputElement).value).toBe('reviewer');
		expect(update).toHaveBeenCalledWith({ reset: false });
		await (await (forms.submit as Submit)({ cancel: () => {} }))({ result: { type: 'success' }, update });
		await vi.waitFor(() => expect(roleForm()).toBeNull());
	});
});
