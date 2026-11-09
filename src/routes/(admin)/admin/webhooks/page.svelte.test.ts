// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entitlements } from '$lib/entitlements';

/*
 * enhance hands each form's submit function over here, so a test can run the
 * one behind a rotation and apply a result to it.
 */
const forms = vi.hoisted(() => ({ submits: [] as { node: HTMLFormElement; submit: unknown }[] }));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, submit?: unknown) => {
		forms.submits.push({ node, submit });
		return { destroy() {} };
	},
}));

const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, confirm: kit.confirm };
});

import WebhooksPage from './+page.svelte';

afterEach(() => {
	cleanup();
	forms.submits.length = 0;
});
beforeEach(() => {
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
});

const entitlements: Entitlements = {
	plan: 'example',
	state: 'active',
	features: ['webhook'],
	tenant_quota: 1,
};

const webhook = {
	id: 'w1',
	name: 'Ship it',
	url: 'https://example.com/hook',
	events: ['entry.created'],
	schemas: [],
	enabled: true,
	created_at: '2026-01-01T00:00:00Z',
};

function setup(roles: string[] = ['super_admin']) {
	return render(WebhooksPage, {
		props: {
			data: { webhooks: { ok: true, value: [webhook] }, schemas: { ok: true, value: [] }, entitlements, user: { roles } },
			form: null,
		} as never,
	});
}

describe('webhooks page', () => {
	it('asks first, names the webhook, and posts its id only once agreed', async () => {
		const { getByTitle } = setup();
		const form = getByTitle('Delete').closest('form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/delete');
		expect(new FormData(form).get('id')).toBe('w1');
		const submit = forms.submits.find((f) => f.node === form)?.submit as (input: unknown) => Promise<unknown>;

		const declined = vi.fn();
		await submit({ cancel: declined });
		expect(kit.confirm).toHaveBeenCalledWith('Delete webhook Ship it?', 'This cannot be undone.', {
			confirmLabel: 'Delete',
		});
		expect(declined).toHaveBeenCalled();

		kit.confirm.mockResolvedValue(true);
		const agreed = vi.fn();
		const formData = new FormData(form);
		await submit({ cancel: agreed, formData });
		expect(agreed).not.toHaveBeenCalled();
		expect(formData.get('confirmed')).toBe('yes');
	});

	it('creates and edits in one drawer, Create on new and Save on a row', async () => {
		const { container, getAllByRole, getByRole } = setup();
		expect(container.querySelector('[role="dialog"]')).toBeNull();

		await fireEvent.click(getAllByRole('button', { name: /new webhook/i })[0]);
		let dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('New webhook');
		expect(dialog.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Create');
		await fireEvent.click(getByRole('button', { name: 'Cancel' }));

		await fireEvent.click(getByRole('button', { name: 'Edit Ship it' }));
		dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('Edit Ship it');
		expect((dialog.querySelector('#webhook-url') as HTMLInputElement).value).toBe('https://example.com/hook');
		expect(dialog.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Save');
	});
});

/*
 * The first-run state invites the reader to create the first webhook. Drawn
 * over a read that failed, it tells somebody whose engine is down that no
 * callback is configured.
 */
describe('the webhook list when it could not be read', () => {
	function failed(gate: Record<string, unknown>) {
		return render(WebhooksPage, {
			props: {
				data: { webhooks: { ok: false, gate }, schemas: { ok: true, value: [] }, entitlements, user: { roles: ['super_admin'] } },
				form: null,
			} as never,
		});
	}

	it('says the engine did not answer and offers no first webhook', () => {
		const { container, queryByRole } = failed({ state: 'unavailable' });
		expect(container.textContent).toContain('so webhooks did not load. Try again in a moment.');
		expect(container.textContent).not.toContain('No webhooks yet');
		expect(queryByRole('button', { name: /new webhook/i })).toBeNull();
		// The queue is the same plugin's read, so it is not offered either.
		expect(queryByRole('link', { name: /dead letters/i })).toBeNull();
		expect(container.querySelector('table')).toBeNull();
	});

	it('names the role for a refusal', () => {
		const { container } = failed({ state: 'forbidden' });
		expect(container.textContent).toContain('Your role cannot open webhooks.');
		expect(container.textContent).not.toContain('No webhooks yet');
	});
});

/*
 * The webhook plugin serves create, update, delete and rotate to a super admin
 * only. An admin offered them meets a refusal after filling the form in.
 */
describe('the webhook controls by role', () => {
	const superAdminOnly = 'Only a super admin can create, change or delete them.';

	it('offers an admin the reads and tests, and says who may change a webhook', () => {
		const { container, queryByRole, getByRole } = setup(['admin']);
		expect(queryByRole('button', { name: /new webhook/i })).toBeNull();
		expect(queryByRole('button', { name: 'Edit Ship it' })).toBeNull();
		expect(queryByRole('button', { name: 'Duplicate Ship it' })).toBeNull();
		expect(queryByRole('button', { name: 'Delete Ship it' })).toBeNull();
		expect(queryByRole('button', { name: /rotate the signing secret/i })).toBeNull();
		expect(getByRole('button', { name: 'Test Ship it' })).toBeTruthy();
		expect(getByRole('link', { name: 'Delivery history for Ship it' })).toBeTruthy();
		expect(container.textContent).toContain(superAdminOnly);
	});

	it('offers a super admin every write', () => {
		const { container, getByRole, getAllByRole } = setup();
		expect(getAllByRole('button', { name: /new webhook/i })).toHaveLength(1);
		expect(getByRole('button', { name: 'Edit Ship it' })).toBeTruthy();
		expect(getByRole('button', { name: 'Delete Ship it' })).toBeTruthy();
		expect(getByRole('button', { name: /rotate the signing secret/i })).toBeTruthy();
		expect(container.textContent).not.toContain(superAdminOnly);
	});
});

/*
 * Every form on the page shares one action result. A drawer that read it
 * whole showed a failed delete in the next New webhook form as if that form
 * had failed.
 */
describe('the webhook drawer and the failures of other actions', () => {
	const props = (form: unknown) =>
		({
			data: {
				webhooks: { ok: true, value: [webhook] },
				schemas: { ok: true, value: [] },
				entitlements,
				user: { roles: ['super_admin'] },
			},
			form,
		}) as never;
	const drawerText = () => document.body.querySelector('form#webhook-form')?.textContent ?? '';

	it('leaves a newly opened create drawer clean after a failed delete', async () => {
		const { container, getByRole } = render(WebhooksPage, { props: props({ action: 'delete', error: 'Could not delete the webhook. Try again.' }) });
		expect(container.textContent).toContain('Could not delete the webhook. Try again.');
		await fireEvent.click(getByRole('button', { name: /new webhook/i }));
		expect(drawerText()).not.toContain('Could not delete the webhook. Try again.');
	});

	it('shows a failed save inside the open drawer, first in its form', async () => {
		const { getByRole, rerender } = render(WebhooksPage, { props: props(null) });
		await fireEvent.click(getByRole('button', { name: /new webhook/i }));
		await rerender(props({ action: 'create', error: 'Could not create the webhook. Try again.' }));
		const form = document.body.querySelector('form#webhook-form') as HTMLFormElement;
		expect(form.firstElementChild?.textContent).toContain('Could not create the webhook. Try again.');
	});
});

/*
 * The test result lands in a map keyed by webhook. An effect that tracked the
 * map it rewrote reran on its own write until Svelte threw.
 */
describe('the result of a webhook test', () => {
	const props = (form: unknown) =>
		({
			data: { webhooks: { ok: true, value: [webhook] }, schemas: { ok: true, value: [] }, entitlements, user: { roles: ['admin'] } },
			form,
		}) as never;

	it('settles and shows under the row it tested', async () => {
		const { container, rerender } = render(WebhooksPage, { props: props(null) });
		await rerender(props({ testResult: { id: 'w1', success: false, status_code: 502, message: 'Bad gateway' } }));
		expect(container.querySelector('tbody')?.textContent).toContain('HTTP 502: Bad gateway');
		await rerender(props({ testResult: { id: 'w1', success: true, status_code: 200, message: 'OK' } }));
		expect(container.querySelector('tbody')?.textContent).toContain('HTTP 200: OK');
	});
});

/*
 * The plugin generates the new secret and shows it once. The page used to
 * toast "Rotated the secret for undefined" and drop the secret, so the
 * receiver could no longer verify a signature and nobody could learn why.
 */
describe('a rotated signing secret', () => {
	const props = (form: unknown) =>
		({
			data: { webhooks: { ok: true, value: [webhook] }, schemas: { ok: true, value: [] }, entitlements, user: { roles: ['super_admin'] } },
			form,
		}) as never;

	type After = (input: { result: { type: string; data?: unknown }; update: () => Promise<void> }) => Promise<void>;

	/** Runs the rotation's submit with a result, as enhance would. */
	async function rotate(result: { type: string; data?: unknown }) {
		const entry = forms.submits.find((f) => f.node.getAttribute('action') === '?/rotate-secret' && f.node.isConnected);
		const after = (await (entry?.submit as () => Promise<After>)()) as After;
		const update = vi.fn(async () => {});
		await after({ result, update });
		await tick();
		return update;
	}

	const secretShown = () =>
		[...document.body.querySelectorAll('[role="dialog"] input')].some((i) => (i as HTMLInputElement).value === 'c0ffee-secret');

	it('is shown once in a panel that names the webhook and copies the secret', async () => {
		render(WebhooksPage, { props: props(null) });
		const update = await rotate({ type: 'success', data: { rotated: { id: 'w1', name: 'Ship it', secret: 'c0ffee-secret' } } });
		const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('New signing secret for Ship it');
		expect(dialog.textContent).toContain('It is not shown again.');
		expect(secretShown()).toBe(true);
		// Applying the result would keep the secret in the page's form.
		expect(update).not.toHaveBeenCalled();
	});

	it('is gone once the panel closes', async () => {
		render(WebhooksPage, { props: props(null) });
		await rotate({ type: 'success', data: { rotated: { id: 'w1', name: 'Ship it', secret: 'c0ffee-secret' } } });
		const close = [...document.body.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === 'Close');
		await fireEvent.click(close!);
		await tick();
		expect(secretShown()).toBe(false);
		expect(document.body.textContent).not.toContain('New signing secret');
	});

	it('clears an earlier failure once a rotation succeeds', async () => {
		const { container } = render(WebhooksPage, { props: props({ action: 'test', error: 'Could not test the webhook. Try again.' }) });
		expect(container.textContent).toContain('Could not test the webhook. Try again.');
		const update = await rotate({ type: 'success', data: { rotated: { id: 'w1', name: 'Ship it', secret: 'c0ffee-secret' } } });
		expect(container.textContent).not.toContain('Could not test the webhook. Try again.');
		expect(update).not.toHaveBeenCalled();
	});

	it('applies a failed rotation so the page reports it', async () => {
		render(WebhooksPage, { props: props(null) });
		const update = await rotate({ type: 'failure', data: { action: 'rotate-secret', error: 'Could not rotate the signing secret. Try again.' } });
		expect(update).toHaveBeenCalled();
		expect(secretShown()).toBe(false);
	});
});

describe('the failures of the history and the queue', () => {
	const props = (form: unknown) =>
		({
			data: { webhooks: { ok: true, value: [webhook] }, schemas: { ok: true, value: [] }, entitlements, user: { roles: ['admin'] } },
			form,
		}) as never;

	it.each(['retry-delivery', 'dead-letter-replay', 'dead-letter-dismiss', 'dead-letter-delete'])(
		'leaves a failed %s to its drawer rather than the page behind it',
		(action) => {
			const { container } = render(WebhooksPage, { props: props({ action, error: 'refused here' }) });
			expect(container.textContent).not.toContain('refused here');
		},
	);

	// Each drawer opens from the address, so a link or a reload opens it too.
	it('links the queue and each row\'s history by the address that opens them', () => {
		const { getByRole } = render(WebhooksPage, { props: props(null) });
		expect(getByRole('link', { name: 'Delivery history for Ship it' }).getAttribute('href')).toContain('deliveries=w1');
		expect(getByRole('link', { name: /dead letters/i }).getAttribute('href')).toContain('dead=1');
	});
});
