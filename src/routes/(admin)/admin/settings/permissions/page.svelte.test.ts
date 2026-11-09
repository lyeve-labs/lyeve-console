// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entitlements } from '$lib/entitlements';

/** The shape `use:enhance` hands its submit function's callback. */
type EnhanceResult = { type: 'success' | 'failure' | 'error' | 'redirect' };
type EnhanceCallback = (opts: {
	result: EnhanceResult;
	update: (options?: { reset?: boolean }) => Promise<void>;
}) => Promise<void> | void;
type SubmitFn = (input: unknown) => EnhanceCallback | void;

// The real enhance is not exercised here, but the submit function each form
// passes it is: it decides whether the modal closes and whether load reruns.
const forms = vi.hoisted(() => ({ submits: [] as SubmitFn[], byAction: new Map<string, SubmitFn>() }));

vi.mock('$app/state', () => ({ page: { url: new URL('http://admin/admin/settings/permissions') } }));
vi.mock('$app/forms', () => ({
	enhance: (_node: HTMLFormElement, submit?: SubmitFn) => {
		if (submit) forms.submits.push(submit);
		if (submit) forms.byAction.set(_node.getAttribute('action') ?? '', submit);
		return { destroy() {} };
	},
}));

// Removal asks through the kit's confirm dialog, which renders through a
// container the layout mounts and this test does not. The call is captured:
// what it said, and whether the page posted once it was agreed to.
const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

import PermissionsPage from './+page.svelte';

beforeEach(() => {
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
});

afterEach(() => {
	cleanup();
	forms.submits.length = 0;
});

const entitlements: Entitlements = {
	plan: 'example',
	state: 'active',
	features: ['rbac'],
	tenant_quota: 1,
};

const permission = {
	id: 'a1b2c3d4-0000-0000-0000-000000000000',
	role: 'editor',
	schema_name: 'article',
	actions: ['read'],
	field_mask: [],
	created_at: '2026-01-01T00:00:00Z',
};

function setup() {
	return render(PermissionsPage, {
		props: {
			data: {
				permissions: [permission],
				schemas: [{ name: 'article' }],
				entitlements,
				loadError: null,
			},
			form: null,
		} as never,
	});
}

function setupFailedLoad(loadGate: unknown = { state: 'error', message: 'Could not load permission rules.' }) {
	return render(PermissionsPage, {
		props: {
			data: {
				permissions: [],
				schemas: [],
				entitlements,
				loadGate,
			},
			form: null,
		} as never,
	});
}

/** Run the submit function the form under test handed to enhance. */
async function runEnhance(result: EnhanceResult) {
	const submit = forms.submits.at(-1);
	expect(submit, 'the form registered no submit function with enhance').toBeTruthy();
	const update = vi.fn(async () => {});
	const callback = await submit!({});
	expect(typeof callback, 'enhance was given no result callback').toBe('function');
	await (callback as EnhanceCallback)({ result, update });
	await tick();
	return update;
}

describe('permissions page', () => {
	it('posts the id the delete action reads, and only once agreed to', async () => {
		// The action deletes by id. A form that posts role and schema_name only
		// sends a null `id`, and removing a rule silently never succeeds.
		const { container, getAllByRole } = setup();
		const form = container.querySelector('form[action="?/delete"]') as HTMLFormElement;
		// The id is read when the form posts, so the spy captures it at that
		// moment. Read afterwards, it would pass even if the post went out first.
		let posted: string | null = null;
		const submit = vi.spyOn(form, 'requestSubmit').mockImplementation(() => {
			posted = new FormData(form).get('id') as string | null;
		});
		const remove = getAllByRole('button').find((b) =>
			b.getAttribute('aria-label')?.startsWith('Remove rule'),
		);
		expect(remove, 'no remove control on the row').toBeTruthy();

		await fireEvent.click(remove!);
		await tick();
		expect(submit, 'posted before the dialog answered').not.toHaveBeenCalled();

		kit.confirm.mockResolvedValue(true);
		await fireEvent.click(remove!);
		await tick();
		await tick();
		expect(submit).toHaveBeenCalled();
		expect(posted).toBe(permission.id);
	});

	it('names the rule it is about to remove', async () => {
		const { getAllByRole } = setup();
		const remove = getAllByRole('button').find((b) =>
			b.getAttribute('aria-label')?.startsWith('Remove rule'),
		);
		await fireEvent.click(remove!);
		await tick();
		// A destructive confirmation has to say which object it means.
		const [title, message, options] = kit.confirm.mock.calls[0] as unknown as [string, string, { confirmLabel: string }];
		expect(title).toBe('Delete the rule for editor on article?');
		// No parent rule grants anything once this one goes, so the title says it all.
		expect(message).toBe('');
		expect(options.confirmLabel).toBe('Delete');
	});
});

describe('permissions page load failure', () => {
	it('reports the failed read instead of drawing an empty matrix', () => {
		// A matrix with no rules is what an instance that restricts nothing
		// looks like. The operator's next act on this screen is granting access,
		// so an unreachable engine or an expired session must not share that
		// picture.
		const { container } = setupFailedLoad();
		expect(container.textContent).toContain('Could not load permission rules.');
		expect(container.querySelector('table'), 'a matrix was drawn from a failed read').toBeNull();
	});

	it('says a busy engine is busy rather than that the session expired', () => {
		const { container } = setupFailedLoad({ state: 'busy' });
		expect(container.textContent).toContain('Too many requests');
		expect(container.textContent).not.toContain('session has');
		expect(container.querySelector('table')).toBeNull();
	});

	it('offers no write control while the rules are unknown', () => {
		const { queryAllByRole } = setupFailedLoad();
		const add = queryAllByRole('button').find((b) => b.textContent?.includes('New role'));
		expect(add, 'add role stayed live on a failed read').toBeFalsy();
	});

	it('draws the matrix when the read succeeded', () => {
		const { container } = setup();
		expect(container.querySelector('table')).toBeTruthy();
	});
});

describe('permissions page enhance handling', () => {
	it('keeps the edit modal open when the save fails', async () => {
		const { container, getAllByRole } = setup();
		const edit = getAllByRole('button').find((b) => b.getAttribute('aria-label')?.startsWith('Edit rule'));
		await fireEvent.click(edit!);
		expect(container.querySelector('form[action="?/upsert"]')).toBeTruthy();

		const update = await runEnhance({ type: 'failure' });

		// Closing on a failure hides the only place the error can be read.
		expect(container.querySelector('form[action="?/upsert"]'), 'modal closed over a failed save').toBeTruthy();
		expect(update).toHaveBeenCalledWith({ reset: false });
	});

	it('closes the edit modal and reruns load on success', async () => {
		// A callback that replaces SvelteKit's handling entirely, with no
		// update() and no applyAction(), leaves the stale rule in the table.
		const { container, getAllByRole } = setup();
		const edit = getAllByRole('button').find((b) => b.getAttribute('aria-label')?.startsWith('Edit rule'));
		await fireEvent.click(edit!);

		const update = await runEnhance({ type: 'success' });

		expect(container.querySelector('form[action="?/upsert"]')).toBeNull();
		expect(update).toHaveBeenCalledWith({ reset: false });
	});

});

describe('permissions page role ceiling', () => {
	function setupAtCeiling(roleCap: number) {
		return render(PermissionsPage, {
			props: {
				data: { permissions: [permission], schemas: [{ name: 'article' }], entitlements, loadError: null, roleCap },
				form: null,
			} as never,
		});
	}

	it('states the ceiling the engine serves and offers no new role at it', () => {
		const { queryAllByRole, container } = setupAtCeiling(1);
		expect(container.textContent).toContain('1 of 1 roles');
		expect(container.textContent).toContain(
			"This engine's role ceiling is 1, so you cannot add another role. Your existing roles keep working.",
		);
		expect(queryAllByRole('button').find((b) => b.textContent?.includes('New role'))).toBeFalsy();
	});

	it('counts the roles the plugin reports rather than the rules on screen', () => {
		const { container } = render(PermissionsPage, {
			props: {
				data: { permissions: [permission], schemas: [{ name: 'article' }], entitlements, loadError: null, roleCap: 7, roleCount: 7 },
				form: null,
			} as never,
		});
		expect(container.textContent).toContain('7 of 7 roles');
	});

	it('says nothing of a ceiling below it', () => {
		const { container, getAllByRole } = setupAtCeiling(5);
		expect(container.textContent).not.toContain('of 5 roles');
		expect(getAllByRole('button').find((b) => b.textContent?.includes('New role'))).toBeTruthy();
	});
});

describe('permissions page new role', () => {
	it('opens a form that writes the new role wildcard rule', async () => {
		// A role held in component state would vanish on the next load. A role
		// is visible on this screen only where a rule names it, so the control
		// writes one.
		const { container, getAllByRole } = setup();
		const add = getAllByRole('button').find((b) => b.textContent?.includes('New role'));
		expect(add, 'no add role control').toBeTruthy();
		await fireEvent.click(add!);

		const form = container.querySelector('form[action="?/upsert"]') as HTMLFormElement;
		expect(form, 'add role did nothing').toBeTruthy();

		const input = container.querySelector('#new-role') as HTMLInputElement;
		expect(input.name).toBe('role');
		await fireEvent.input(input, { target: { value: 'reviewer' } });

		const posted = new FormData(form);
		expect(posted.get('role')).toBe('reviewer');
		expect(posted.get('schema_name')).toBe('*');
		// A new role grants nothing until a cell is edited.
		expect(posted.getAll('actions')).toEqual([]);
	});

	it('adds no role to the matrix until the write comes back', async () => {
		const { container, getAllByRole } = setup();
		const add = getAllByRole('button').find((b) => b.textContent?.includes('New role'));
		await fireEvent.click(add!);

		const input = container.querySelector('#new-role') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'reviewer' } });
		await tick();

		const table = container.querySelector('table') as HTMLTableElement;
		expect(table.textContent, 'a phantom role appeared before any rule existed').not.toContain('reviewer');
	});

	it('keeps the new role drawer open when the write fails', async () => {
		const { container, getAllByRole } = setup();
		const add = getAllByRole('button').find((b) => b.textContent?.includes('New role'));
		await fireEvent.click(add!);

		const update = await runEnhance({ type: 'failure' });

		expect(container.querySelector('#new-role'), 'modal closed over a refused role').toBeTruthy();
		expect(update).toHaveBeenCalledWith({ reset: false });
	});

	it('closes the new role drawer on success', async () => {
		const { container, getAllByRole } = setup();
		const add = getAllByRole('button').find((b) => b.textContent?.includes('New role'));
		await fireEvent.click(add!);

		const update = await runEnhance({ type: 'success' });

		expect(container.querySelector('#new-role')).toBeNull();
		expect(update).toHaveBeenCalledWith({ reset: false });
	});
});

interface Rule {
	id: string;
	role: string;
	schema_name: string;
	actions: string[];
	field_mask: string[];
	created_at: string;
}

let nextId = 0;
function rule(role: string, schema_name: string, actions: string[], field_mask: string[] = []): Rule {
	nextId++;
	return {
		id: `00000000-0000-0000-0000-${String(nextId).padStart(12, '0')}`,
		role,
		schema_name,
		actions,
		field_mask,
		created_at: '2026-01-01T00:00:00Z',
	};
}

function setupWith(permissions: Rule[], schemas: string[]) {
	return render(PermissionsPage, {
		props: {
			data: {
				permissions,
				schemas: schemas.map((name) => ({ name })),
				entitlements,
				loadError: null,
			},
			form: null,
		} as never,
	});
}

/** The role's own row, found through the disclosure that controls its rules. */
function roleRow(container: HTMLElement, role: string): HTMLElement {
	const button = container.querySelector(`button[aria-controls="rules-${role}"]`);
	expect(button, `no disclosure for ${role}`).toBeTruthy();
	return button!.closest('tr') as HTMLElement;
}

function childRow(container: HTMLElement, role: string, schema: string): HTMLElement {
	const rows = [...container.querySelectorAll(`#rules-${role} tr`)];
	const row = rows.find((r) => r.querySelector('td')?.textContent?.includes(schema));
	expect(row, `no row for ${schema} under ${role}`).toBeTruthy();
	return row as HTMLElement;
}

describe('permissions page role disclosure', () => {
	it('opens and closes a role from its own control', async () => {
		const { container } = setupWith([rule('editor', 'article', ['read'])], ['article']);
		const button = container.querySelector(
			'button[aria-controls="rules-editor"]',
		) as HTMLButtonElement;

		// A role holding a rule starts open, since its rules are the page.
		expect(button.getAttribute('aria-expanded')).toBe('true');
		expect(container.querySelectorAll('#rules-editor tr').length).toBeGreaterThan(0);

		await fireEvent.click(button);
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(container.querySelectorAll('#rules-editor tr').length).toBe(0);
	});

	it('renders no row for a role that holds no rule', () => {
		// One row per role and schema would bury a dozen rules among hundreds
		// of empty rows, so only a rule draws a row.
		const { container } = setupWith([rule('editor', 'article', ['read'])], ['article', 'page']);
		expect(container.querySelectorAll('#rules-admin tr').length).toBe(0);
		expect(container.querySelectorAll('#rules-editor tr').length).toBe(2);
	});

	it('pins the wildcard rule first inside a role', () => {
		const { container } = setupWith(
			[rule('editor', 'article', ['read']), rule('editor', '*', ['read'])],
			['article'],
		);
		const first = container.querySelector('#rules-editor tr') as HTMLElement;
		expect(first.textContent).toContain('Every content type');
	});
});

describe('permissions page collapsed summary', () => {
	it('rolls an empty set up to none, never to all', () => {
		// every() is true over an empty array, so the obvious fold reports a
		// fully granted column over zero schemas, and the operator reads a
		// blanket grant off a screen that shows nothing.
		const { container } = setupWith([], []);
		expect(roleRow(container, 'admin').textContent).toContain('admin grants read on no content type.');
		expect(roleRow(container, 'admin').textContent).not.toContain('on every content type');
	});

	it('reports a role with no rule as granting nothing', () => {
		const { container } = setupWith([], ['article', 'page']);
		expect(roleRow(container, 'admin').textContent).toContain('admin grants read on no content type.');
	});

	it('reports a partial grant as some and a wildcard grant as every schema', () => {
		const { container } = setupWith(
			[rule('editor', 'article', ['read']), rule('reviewer', '*', ['read'])],
			['article', 'page'],
		);
		expect(roleRow(container, 'editor').textContent).toContain(
			'editor grants read on some content types.',
		);
		expect(roleRow(container, 'reviewer').textContent).toContain(
			'reviewer grants read on every content type.',
		);
	});

	it('summarizes a collapsed role', async () => {
		const { container } = setupWith([rule('editor', 'article', ['read'])], ['article', 'page']);
		const button = container.querySelector(
			'button[aria-controls="rules-editor"]',
		) as HTMLButtonElement;
		await fireEvent.click(button);

		expect(container.querySelectorAll('#rules-editor tr').length).toBe(0);
		expect(roleRow(container, 'editor').textContent).toContain(
			'editor grants read on some content types.',
		);
		expect(roleRow(container, 'editor').textContent).toContain(
			'editor grants create on no content type.',
		);
	});
});

describe('permissions page inherited grants', () => {
	// The engine reads a schema's own rule alone when it has one. The wildcard
	// rule's actions apply only to a schema without a rule of its own, so a
	// schema rule can take back what the wildcard grants everywhere else.
	it('marks the wildcard grant denied on a schema whose own rule leaves it out', () => {
		const { container } = setupWith(
			[rule('editor', '*', ['read']), rule('editor', 'article', ['create'])],
			['article'],
		);
		const row = childRow(container, 'editor', 'article');
		expect(row.textContent).toContain('editor is granted create on article by this rule.');
		expect(row.textContent).toContain(
			'editor is denied read on article. This rule replaces the wildcard rule, which grants it.',
		);
		expect(row.textContent).not.toContain('does not revoke');
	});

	it('names the wildcard rule as the source on a schema with no rule of its own', async () => {
		const { container } = setupWith([rule('editor', '*', ['read'])], ['article']);
		await fireEvent.click(container.querySelector('#show-unruled') as HTMLElement);
		const row = childRow(container, 'editor', 'article');
		expect(row.textContent).toContain(
			'editor is granted read on article by the wildcard rule, because article has no rule of its own.',
		);
	});

	it('counts a schema whose own rule takes back a wildcard grant as not granted', () => {
		const { container } = setupWith(
			[rule('editor', '*', ['read', 'update']), rule('editor', 'article', ['read'])],
			['article', 'page'],
		);
		expect(roleRow(container, 'editor').textContent).toContain('editor grants read on every content type.');
		expect(roleRow(container, 'editor').textContent).toContain('editor grants update on some content types.');
	});

	it('warns in the editor that an action left clear is denied on the schema', async () => {
		const { container, getAllByRole } = setupWith(
			[rule('editor', '*', ['read']), rule('editor', 'article', ['create'])],
			['article'],
		);
		const edit = getAllByRole('button').find(
			(b) => b.getAttribute('aria-label') === 'Edit rule for editor on article',
		);
		await fireEvent.click(edit!);

		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('This rule replaces the wildcard rule on article');
		expect(dialog.textContent).toContain('any action you leave clear is denied there');
		expect(dialog.textContent).not.toContain('does not revoke');
	});

	it('starts a new schema rule from the wildcard rule it replaces', async () => {
		const { container, getAllByRole, getByLabelText } = setupWith(
			[rule('editor', '*', ['read', 'update'])],
			['article'],
		);
		await fireEvent.click(container.querySelector('#show-unruled') as HTMLElement);
		const add = getAllByRole('button').find(
			(b) => b.getAttribute('aria-label') === 'Add rule for editor on article',
		);
		await fireEvent.click(add!);
		await tick();

		expect((getByLabelText('Read') as HTMLInputElement).checked).toBe(true);
		expect((getByLabelText('Update') as HTMLInputElement).checked).toBe(true);
		expect((getByLabelText('Delete') as HTMLInputElement).checked).toBe(false);
	});

	// A schema rule with no action is how one schema is shut to a role the
	// wildcard opens everything to, so the editor has to let it be saved.
	it('lets an empty schema rule be saved when it takes a wildcard grant back', async () => {
		const { container, getAllByRole } = setupWith(
			[rule('editor', '*', ['read']), rule('editor', 'payroll', [])],
			['payroll'],
		);
		const edit = getAllByRole('button').find(
			(b) => b.getAttribute('aria-label') === 'Edit rule for editor on payroll',
		);
		await fireEvent.click(edit!);
		await tick();

		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).not.toContain('This rule would do nothing');
		expect(dialog.textContent).toContain('editor is denied every action on payroll');
		const save = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save');
		expect(save, 'no Save button').toBeTruthy();
		expect((save as HTMLButtonElement).disabled).toBe(false);
	});

	it('tells the operator a removal puts the wildcard rule back in force', async () => {
		const { getAllByRole } = setupWith(
			[rule('editor', '*', ['read']), rule('editor', 'article', ['create'])],
			['article'],
		);
		const remove = getAllByRole('button').find(
			(b) => b.getAttribute('aria-label') === 'Remove rule for editor on article',
		);
		await fireEvent.click(remove!);

		await tick();
		const [, message] = kit.confirm.mock.calls[0] as unknown as [string, string];
		expect(message).toContain('The wildcard rule for editor then applies to this content type and grants read.');
		expect(message).not.toContain('does not revoke');
	});
});

describe('permissions page exempt role', () => {
	it('marks super_admin exempt and keeps its rows reachable', () => {
		const { container } = setupWith([rule('super_admin', 'article', ['read'])], ['article']);
		const row = roleRow(container, 'super_admin');
		expect(row.textContent).toContain('Exempt');
		// Hiding the role would hide rules that exist in the database.
		expect(container.querySelectorAll('#rules-super_admin tr').length).toBeGreaterThan(0);
	});

	it('offers no grant control under super_admin', () => {
		// checkPermission answers true for super_admin before it reads a rule,
		// so a control that writes one is offering a change with no effect.
		const { container, getAllByRole } = setupWith(
			[rule('super_admin', 'article', ['read'])],
			['article'],
		);
		const add = getAllByRole('button').find(
			(b) => b.getAttribute('aria-label') === 'Add a content type rule for super_admin',
		);
		expect((add as HTMLButtonElement).disabled).toBe(true);

		const edit = getAllByRole('button').find(
			(b) => b.getAttribute('aria-label') === 'Edit rule for super_admin on article',
		);
		expect((edit as HTMLButtonElement).disabled).toBe(true);

		const row = childRow(container, 'super_admin', 'article');
		expect(row.textContent).toContain('The role is exempt from these rules.');
	});
});

describe('permissions page schema filter', () => {
	it('narrows the child rows to the schemas that match', async () => {
		const { container } = setupWith(
			[rule('editor', 'article', ['read']), rule('editor', 'product', ['read'])],
			['article', 'product'],
		);
		expect(container.querySelectorAll('#rules-editor tr').length).toBe(3);

		const search = container.querySelector('input[type="search"]') as HTMLInputElement;
		await fireEvent.input(search, { target: { value: 'prod' } });

		const rows = [...container.querySelectorAll('#rules-editor tr')];
		// The wildcard rule stays pinned: it is what a matched schema inherits from.
		expect(rows.length).toBe(2);
		expect(rows.some((r) => r.textContent?.includes('product'))).toBe(true);
		expect(rows.some((r) => r.textContent?.includes('article'))).toBe(false);
	});
});

describe('permissions page copy', () => {
	it('says a schema rule replaces the wildcard rule rather than adding to it', () => {
		const { container } = setupWith([], ['article']);
		const text = (container.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toContain('A content type rule replaces the wildcard rule on that content type.');
		expect(text).not.toContain('their actions are unioned');
		expect(text).not.toContain('cannot be taken back');
	});

	it('says a missing rule denies', () => {
		// The gate skips every role whose rule is missing and answers 403 when
		// none granted the action, so a row with no entry is not unrestricted.
		const { container } = setupWith([], ['article']);
		expect(container.textContent).toContain('denied every action on it');
		expect(container.textContent).not.toContain('unrestricted');
	});
});

describe('permissions page flow resources', () => {
	function setupFlows(permissions: Rule[], schemas: string[] = ['article'], flows = [{ id: 'f1', slug: 'send-receipt', name: 'Send receipt' }]) {
		return render(PermissionsPage, {
			props: {
				data: { permissions, schemas: schemas.map((name) => ({ name })), flows, entitlements, loadError: null },
				form: null,
			} as never,
		});
	}

	it('offers All flows and each flow as resources beside the schemas', async () => {
		const { container } = setupFlows([rule('editor', 'article', ['read'])]);
		await fireEvent.click(container.querySelector('button[aria-label="Add a content type rule for editor"]') as HTMLButtonElement);
		await tick();
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		const picker = (dialog.querySelector('input[role="combobox"]') ?? dialog.querySelector('input:not([type="hidden"])')) as HTMLInputElement;
		expect(picker).toBeTruthy();
		await fireEvent.focus(picker);
		await fireEvent.input(picker, { target: { value: 'flow' } });
		await tick();
		const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim());
		expect(options).toContain('All flows');
		expect(options).toContain('flow send-receipt');
	});

	it('shows activate only when the rule names a flow resource', async () => {
		const { container, queryByLabelText } = setupFlows([rule('editor', 'article', ['read']), rule('publisher', 'flows', ['read'])]);
		await fireEvent.click(container.querySelector('button[aria-label="Edit rule for editor on article"]') as HTMLButtonElement);
		await tick();
		expect(queryByLabelText('Activate')).toBeNull();
		expect(queryByLabelText('Read')).toBeTruthy();
		await fireEvent.click(container.querySelector('button[aria-label="Edit rule for publisher on All flows"]') as HTMLButtonElement);
		await tick();
		expect(queryByLabelText('Activate')).toBeTruthy();
	});

	it('draws no activate mark on a schema row, and a flow rule replaces the All flows rule', () => {
		const { container } = setupFlows([rule('publisher', 'flows', ['read', 'activate']), rule('publisher', 'flow:send-receipt', ['update'])]);
		const flowRow = childRow(container, 'publisher', 'flow:send-receipt');
		expect(flowRow.textContent).toContain(
			'publisher is denied activate on flow send-receipt. This rule replaces the All flows rule, which grants it.',
		);
		expect(flowRow.textContent).toContain('publisher is granted update on flow send-receipt by this rule.');
		const all = childRow(container, 'publisher', 'flows');
		expect(all.textContent).toContain('Every flow');
		expect(all.textContent).toContain('publisher is granted activate on All flows by this rule.');
	});

	it('keeps the wildcard rule away from flows in the summary', () => {
		const { container } = setupFlows([rule('reviewer', '*', ['read'])], ['article', 'page']);
		expect(roleRow(container, 'reviewer').textContent).toContain('reviewer grants read on every content type.');
		expect(roleRow(container, 'reviewer').textContent).toContain('reviewer grants read on no flow.');
		expect(roleRow(container, 'reviewer').textContent).toContain('reviewer grants activate on no flow.');
	});
});

describe('permissions page drawers', () => {
	function setupWith(form: unknown, over: Record<string, unknown> = {}) {
		return render(PermissionsPage, {
			props: {
				data: { permissions: [permission], schemas: [{ name: 'article' }], entitlements, loadError: null, ...over },
				form,
			} as never,
		});
	}

	const dataWith = (over: Record<string, unknown> = {}) => ({
		permissions: [permission],
		schemas: [{ name: 'article' }],
		entitlements,
		loadError: null,
		...over,
	});
	const ruleText = () => document.body.querySelector('form#rule-form')?.textContent ?? '';
	const roleText = () => document.body.querySelector('form#role-form')?.textContent ?? '';
	const editButton = (all: HTMLElement[]) => all.find((b) => b.getAttribute('aria-label')?.startsWith('Edit rule'))!;
	const newRoleButton = (all: HTMLElement[]) => all.find((b) => b.textContent?.includes('New role'))!;

	it('shows a refused rule save inside the open rule drawer', async () => {
		const { getAllByRole, rerender } = setupWith(null);
		await fireEvent.click(editButton(getAllByRole('button')));
		await rerender({ data: dataWith(), form: { action: 'rule', error: 'Could not save the rule. Try again.' } } as never);
		expect(ruleText()).toContain('Could not save the rule. Try again.');
	});

	it('shows a refused role inside the open role drawer', async () => {
		const { getAllByRole, rerender } = setupWith(null);
		await fireEvent.click(newRoleButton(getAllByRole('button')));
		await rerender({ data: dataWith(), form: { action: 'role', error: 'Could not save the rule. Try again.' } } as never);
		expect(roleText()).toContain('Could not save the rule. Try again.');
	});

	it('takes the ceiling from the refusal when the limits read failed', () => {
		const refused = { kind: 'cap', cap: 'rbac.roles', limit: 5, current: 5, upgradeUrl: '' };
		const { container } = setupWith({ action: 'role', roleCapReached: true, refused }, { roleCap: 0, roleCount: null });
		expect(container.textContent).toContain('The ceiling is 5 roles and this engine has 5.');
		expect(container.textContent).not.toContain('The ceiling is 0 roles');
	});

	it('states no ceiling when neither the refusal nor the read gave one', () => {
		const { container } = setupWith({ action: 'role', roleCapReached: true }, { roleCap: 0, roleCount: null });
		expect(container.textContent).toContain('This engine allows no more roles.');
		expect(container.textContent).not.toContain('The ceiling is 0 roles');
	});

	it('shows the role ceiling refusal with its numbers in the role drawer', async () => {
		const refused = { kind: 'cap', cap: 'rbac.roles', limit: 3, current: 3, upgradeUrl: '' };
		const { getAllByRole, rerender } = setupWith(null);
		await fireEvent.click(newRoleButton(getAllByRole('button')));
		await rerender({ data: dataWith(), form: { action: 'role', roleCapReached: true, refused } } as never);
		expect(roleText()).toContain("You're using 3 of 3 roles");
	});

	it('leaves newly opened drawers clean after a failed delete', async () => {
		const failed = 'Could not remove the rule. Try again.';
		const { container, getAllByRole } = setupWith({ action: 'delete', error: failed });
		expect(container.textContent).toContain(failed);
		await fireEvent.click(newRoleButton(getAllByRole('button')));
		expect(roleText()).not.toContain(failed);
		await fireEvent.click(editButton(getAllByRole('button')));
		expect(ruleText()).not.toContain(failed);
	});

	it('keeps a failed rule save out of the role drawer', async () => {
		const { getAllByRole, rerender } = setupWith(null);
		await fireEvent.click(newRoleButton(getAllByRole('button')));
		await rerender({ data: dataWith(), form: { action: 'rule', error: 'Could not save the rule. Try again.' } } as never);
		expect(roleText()).not.toContain('Could not save');
	});

	it('says in the new rule form that the flows could not be read', async () => {
		const { container, getAllByRole } = setupWith(null, { flowsFailed: true });
		const add = getAllByRole('button').find((b) => b.getAttribute('aria-label') === 'Add a content type rule for editor');
		expect(add, 'no control adds a rule for a new resource').toBeTruthy();
		await fireEvent.click(add!);
		expect(container.ownerDocument.body.textContent).toContain('Could not load flows');
	});
});

describe('permissions page marks without color', () => {
	// Each state has a shape of its own, so a reader who cannot tell the
	// colors apart still reads the matrix. Every mark is an SVG drawn in
	// currentColor and none is a background, which a forced-colors theme
	// would erase, so the shapes also hold when that theme paints them all
	// one ink.
	function shapeOf(el: Element | null): string {
		expect(el).toBeTruthy();
		expect(el!.tagName.toLowerCase()).toBe('svg');
		const icon = [...el!.classList].find((c) => c.startsWith('lucide-') && c !== 'lucide-icon');
		if (icon) return icon;
		const circle = el!.querySelector('circle');
		if (circle?.getAttribute('fill') === 'currentColor') return 'dot';
		if (circle?.getAttribute('stroke') === 'currentColor') return 'ring';
		return 'unknown';
	}

	it('draws a stored grant, an inherited one, a denial and an exempt role as four shapes', async () => {
		const { container } = setupWith(
			[
				rule('editor', '*', ['read']),
				rule('editor', 'article', ['create']),
				rule('super_admin', 'article', ['read']),
			],
			['article', 'page'],
		);
		await fireEvent.click(container.querySelector('#show-unruled') as HTMLElement);
		const article = childRow(container, 'editor', 'article');
		const page = childRow(container, 'editor', 'page');
		const shapes = {
			stored: shapeOf(article.querySelector('[data-mark="stored"]')),
			none: shapeOf(article.querySelector('[data-mark="none"]')),
			inherited: shapeOf(page.querySelector('[data-mark="inherited"]')),
			exempt: shapeOf(childRow(container, 'super_admin', 'article').querySelector('[data-mark="exempt"]')),
		};
		expect(shapes).toEqual({ stored: 'dot', none: 'lucide-minus', inherited: 'ring', exempt: 'lucide-shield-check' });
		expect(new Set(Object.values(shapes)).size).toBe(4);
	});

	it('fills a summary bar empty for none, half for some and full for all', () => {
		const { container } = setupWith(
			[rule('editor', 'article', ['read']), rule('reviewer', '*', ['read']), rule('reviewer', 'flows', ['read'])],
			['article', 'page'],
		);
		const fill = (role: string, state: string) => {
			const bar = roleRow(container, role).querySelector(`svg[data-summary="${state}"]`);
			// The outline and the fill are both drawn in currentColor, so the bar
			// keeps its shape under forced colors.
			expect(bar?.querySelector('rect:not([data-fill])')?.getAttribute('stroke')).toBe('currentColor');
			const rect = bar?.querySelector('rect[data-fill]');
			expect(rect?.getAttribute('fill')).toBe('currentColor');
			return rect?.getAttribute('width');
		};
		expect(fill('admin', 'none')).toBe('0');
		expect(fill('editor', 'some')).toBe('16');
		expect(fill('reviewer', 'all')).toBe('32');
		expect(roleRow(container, 'super_admin').querySelector('[data-mark="exempt"]')).toBeTruthy();
	});
});

// The row and the drawer that asked for a removal are gone once it lands, so
// focus has to go somewhere a keyboard can carry on from.
describe('after a rule is removed', () => {
	it('moves focus to the filter above the rules', async () => {
		const { container } = setup();
		const submit = forms.byAction.get('?/delete');
		expect(submit, 'the delete form registered no submit function').toBeTruthy();
		const callback = (await submit!({})) as EnhanceCallback;
		await callback({ result: { type: 'success' } as EnhanceResult, update: vi.fn(async () => {}) });
		expect(document.activeElement).toBe(container.ownerDocument.getElementById('schema-filter'));
	});
});


describe('a refusal shown on the page', () => {
	const link = 'https://shop.example.com/pricing?plan=basic';
	const refused = { kind: 'feature', feature: 'feature-b', plugin: 'rbac', upgradeUrl: link };
	const render_ = (over: Record<string, unknown>) =>
		render(PermissionsPage, {
			props: {
				data: { permissions: [permission], schemas: [{ name: 'article' }], entitlements, loadError: null, ...over },
				form: { action: 'delete', error: 'refused', refused },
			} as never,
		});

	// The page leads with New role, so the way forward is not a second primary.
	it('makes the way forward a secondary beside New role', () => {
		const { getByRole } = render_({ roleCap: 0 });
		expect(getByRole('button', { name: 'New role' })).toBeTruthy();
		expect(getByRole('link', { name: 'View the plan' }).classList.contains('bg-brand')).toBe(false);
	});

	// At the ceiling New role is withdrawn, and the way forward is the one action left.
	it('makes the way forward the primary at the ceiling, where New role is withdrawn', () => {
		const { queryByRole, getByRole } = render_({ roleCap: 1, roleCount: 1 });
		expect(queryByRole('button', { name: 'New role' })).toBeNull();
		expect(getByRole('link', { name: 'View the plan' }).classList.contains('bg-brand')).toBe(true);
	});
});
