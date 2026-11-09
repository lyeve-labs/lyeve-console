// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * enhance hands each form's submit function over here, so a test can run the
 * one behind a delete and read the question it asks.
 */
const forms = vi.hoisted(() => ({ submits: [] as { node: HTMLFormElement; submit: unknown }[] }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, submit?: unknown) => {
		forms.submits.push({ node, submit });
		return { destroy() {} };
	},
}));
const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

/** The title of the question the first delete form on the page asks. */
async function deleteTitle(): Promise<string> {
	const entry = forms.submits.find((f) => f.node.getAttribute('action') === '?/delete' && f.node.isConnected);
	const submit = entry?.submit as ((input: { cancel: () => void }) => Promise<unknown>) | undefined;
	if (!submit) throw new Error('no delete form registered a submit function');
	kit.confirm.mockClear();
	await submit({ cancel: () => {} });
	return String((kit.confirm.mock.calls[0] as unknown[] | undefined)?.[0] ?? '');
}

import RateLimitsPage from './+page.svelte';

afterEach(() => cleanup());

const customRule = {
	id: 'r1',
	tenant_id: null,
	endpoint: 'GET /api/content/{schema}',
	rate: 1,
	burst: 5,
	enabled: true,
	kind: 'custom',
	role: 'editor',
	key_by: 'user',
	enforced: false,
	created_at: '2026-09-23T00:00:00Z',
	updated_at: '2026-09-23T00:00:00Z',
};

const protection = {
	name: 'POST /api/admin/auth/login',
	plugin: 'rate-limit',
	description: 'Sign-in attempts per address.',
	route: true,
	requests: 5,
	window_seconds: 900,
	default_requests: 5,
	default_window_seconds: 900,
	customized: false,
};

type Over = {
	customEnabled?: boolean | null;
	superAdmin?: boolean;
	rules?: unknown[];
	total?: number;
	form?: unknown;
};

function setup(over: Over = {}) {
	return render(RateLimitsPage, { props: props(over) });
}

function props(over: Over = {}) {
	const customEnabled = over.customEnabled === undefined ? false : over.customEnabled;
	return {
		data: {
			routes: [],
			rules: over.rules ?? [customRule],
			total: over.total ?? 1,
			limit: 50,
			offset: 0,
			hasMore: false,
			overview:
				customEnabled === null
					? null
					: {
							custom_licensed: customEnabled,
							global: {
								...customRule,
								id: 'g1',
								endpoint: '*',
								kind: 'global',
								role: null,
								key_by: 'ip',
								enabled: false,
								enforced: false,
							},
							protections: [protection],
							engine: [
								{
									scope: 'public',
									endpoint: 'POST /api/admin/auth/login',
									rate: 5,
									burst: 10,
									source: 'environment',
									setting: 'PUBLIC_RATE_LIMITS',
								},
							],
						},
			superAdmin: over.superAdmin ?? true,
			gate: { state: 'ok' },
			installed: true,
		},
		form: over.form ?? null,
	} as never;
}

describe('rate-limits page', () => {
	it('without the capability, shows custom rules as not enabled and says stored ones are not enforced', () => {
		const { getByText, queryByRole } = setup({ customEnabled: false });
		expect(getByText('Custom rate limits')).toBeTruthy();
		expect(getByText(/saved rule is not enforced, because custom rules are not enabled on this engine\./)).toBeTruthy();
		expect(getByText('Not enforced')).toBeTruthy();
		expect(queryByRole('button', { name: /New rule/ })).toBeNull();
		expect(queryByRole('button', { name: /Edit POST \/api\/admin\/auth\/login/ })).toBeNull();
	});

	it('with the capability, offers a new rule and editing a protection', () => {
		const { getAllByRole, getByRole } = setup({ customEnabled: true, rules: [{ ...customRule, enforced: true }] });
		expect(getAllByRole('button', { name: /New rule/ }).length).toBeGreaterThan(0);
		expect(getByRole('button', { name: /Edit POST \/api\/admin\/auth\/login/ })).toBeTruthy();
	});

	it('shows a tenant admin the global limit without an edit control or the thresholds', () => {
		const { getByText, queryByRole, queryByText } = setup({ customEnabled: true, superAdmin: false });
		expect(getByText('Every request, per address, every tenant')).toBeTruthy();
		expect(queryByRole('button', { name: 'Edit the global limit' })).toBeNull();
		expect(queryByText('Sign-in and reset protections')).toBeNull();
	});

	it('offers an admin no change to a rule for every tenant, and says why', () => {
		const own = { ...customRule, id: 'r2', tenant_id: 'acme', endpoint: 'GET /api/own', enforced: true };
		const { getByText, queryByRole, getByRole } = setup({
			customEnabled: true,
			superAdmin: false,
			rules: [{ ...customRule, enforced: true }, own],
		});
		expect(getByText('Only a super admin can change a rule for every tenant.')).toBeTruthy();
		expect(queryByRole('button', { name: 'Edit the rule for GET /api/content/{schema}' })).toBeNull();
		expect(queryByRole('button', { name: 'Delete the rule for GET /api/content/{schema}' })).toBeNull();
		expect(getByRole('button', { name: 'Duplicate the rule for GET /api/content/{schema}' })).toBeTruthy();
		expect(getByRole('button', { name: 'Edit the rule for GET /api/own' })).toBeTruthy();
		expect(getByRole('button', { name: 'Delete the rule for GET /api/own' })).toBeTruthy();
	});

	it('lets a super admin change a rule for every tenant', () => {
		const { getByRole, queryByText } = setup({ customEnabled: true, rules: [{ ...customRule, enforced: true }] });
		expect(getByRole('button', { name: 'Edit the rule for GET /api/content/{schema}' })).toBeTruthy();
		expect(getByRole('button', { name: 'Delete the rule for GET /api/content/{schema}' })).toBeTruthy();
		expect(queryByText('Only a super admin can change a rule for every tenant.')).toBeNull();
	});

	it('names the setting behind an engine limit', () => {
		const { getByText } = setup();
		expect(getByText('PUBLIC_RATE_LIMITS')).toBeTruthy();
	});

	it('treats an unread overview as unknown rather than locked', () => {
		const { getByText, queryByText } = setup({ customEnabled: null });
		expect(getByText(/whether they are enforced is unknown/)).toBeTruthy();
		expect(queryByText('Custom rate limits')).toBeNull();
	});
});

describe('rate-limits drawers', () => {
	const drawerText = (id: string) => document.body.querySelector(`form#${id}`)?.textContent ?? '';
	const deleted = { action: 'delete', error: 'Could not delete the rule. Try again.' };

	it('shows a refused rule save inside the open drawer', async () => {
		const { getAllByRole, rerender } = setup({ customEnabled: true });
		await fireEvent.click(getAllByRole('button', { name: /New rule/ })[0]);
		await rerender(props({ customEnabled: true, form: { action: 'rule', error: 'Could not save the rule. Try again.' } }));
		expect(drawerText('rate-rule-form')).toContain('Could not save the rule. Try again.');
	});

	it('leaves a newly opened rule drawer clean after a failed delete', async () => {
		const { container, getAllByRole } = setup({ customEnabled: true, form: deleted });
		expect(container.textContent).toContain('Could not delete the rule. Try again.');
		await fireEvent.click(getAllByRole('button', { name: /New rule/ })[0]);
		expect(drawerText('rate-rule-form')).not.toContain('Could not delete');
	});

	it('shows a refused global save in its own drawer and in no other', async () => {
		const { getByRole, rerender, container } = setup({ customEnabled: true });
		await fireEvent.click(getByRole('button', { name: 'Edit the global limit' }));
		await rerender(props({ customEnabled: true, form: { action: 'global', error: 'Could not save the global limit. Try again.' } }));
		expect(drawerText('rate-global-form')).toContain('Could not save the global limit. Try again.');
		expect(drawerText('rate-rule-form')).not.toContain('Could not save');
		expect(container.textContent?.split('Could not save the global limit. Try again.').length).toBe(2);
	});

	it('shows a refused protection save inside the protection drawer', async () => {
		const { getByRole, rerender } = setup({ customEnabled: true });
		await fireEvent.click(getByRole('button', { name: /Edit POST \/api\/admin\/auth\/login/ }));
		await rerender(props({ customEnabled: true, form: { action: 'protection', error: 'Could not save the protection. Try again.' } }));
		expect(drawerText('rate-protection-form')).toContain('Could not save the protection. Try again.');
	});

	it('leaves a reopened drawer clean of the failure it showed before', async () => {
		const { getAllByRole } = setup({ customEnabled: true, form: { action: 'rule', error: 'Could not save the rule. Try again.' } });
		await fireEvent.click(getAllByRole('button', { name: /New rule/ })[0]);
		expect(drawerText('rate-rule-form')).not.toContain('Could not save');
	});
});

describe('rate-limits controls', () => {
	it('names the rule in the delete confirmation', async () => {
		setup({ customEnabled: true, rules: [{ ...customRule, enforced: true }] });
		expect(await deleteTitle()).toBe('Delete rule GET /api/content/{schema}?');
	});

	it('offers the two ways of counting as radios, each with its sentence', async () => {
		const { getAllByRole } = setup({ customEnabled: true });
		await fireEvent.click(getAllByRole('button', { name: /New rule/ })[0]);
		const group = document.body.querySelector('form#rate-rule-form [role="radiogroup"]') as HTMLElement;
		expect(group).toBeTruthy();
		expect(group.textContent).toContain('Each address a request comes from has a budget of its own.');
		expect(group.textContent).toContain('One budget across every address an account calls from.');
		expect(document.body.querySelector('#rl-key')).toBeNull();
	});
});

describe('the stored rule count on a paged list', () => {
	it('counts every stored rule from the total, not the rows on this page', () => {
		const { getByText } = setup({ total: 120 });
		expect(getByText(/120\s+saved rules are not enforced/)).toBeTruthy();
	});
});
