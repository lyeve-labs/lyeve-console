// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import IncomingPage from './+page.svelte';

afterEach(cleanup);

const entitlements = { plan: 'example', state: 'active', features: ['webhook'], tenant_quota: 1 };

const stripe = {
	id: 'i1',
	name: 'Stripe',
	schema_name: 'orders',
	enabled: true,
	field_map: { id: 'external_id' },
	allowed_ips: [],
};

function setup(over: Record<string, unknown> = {}, form: unknown = null) {
	return render(IncomingPage, {
		props: {
			data: {
				incomingWebhooks: { ok: true, value: [stripe] },
				schemas: { ok: true, value: [{ name: 'orders' }] },
				entitlements,
				user: { roles: ['super_admin'] },
				limit: 50,
				offset: 0,
				total: 1,
				hasMore: false,
				licensed: null,
				...over,
			},
			form,
		} as never,
	});
}

describe('the incoming webhook list when it could not be read', () => {
	it('says the engine did not answer and offers no first endpoint', () => {
		const { container, queryByRole } = setup({ incomingWebhooks: { ok: false, gate: { state: 'unavailable' } } });
		expect(container.textContent).toContain('so incoming webhooks did not load. Try again in a moment.');
		expect(container.textContent).not.toContain('No incoming webhooks yet');
		expect(queryByRole('button', { name: /new incoming webhook/i })).toBeNull();
	});

	it('keeps the first-run state for a list that answered empty', () => {
		const { container, getAllByRole } = setup({ incomingWebhooks: { ok: true, value: [] } });
		expect(container.textContent).toContain('No incoming webhooks yet');
		expect(getAllByRole('button', { name: /new incoming webhook/i })).toHaveLength(2);
	});
});

/*
 * The webhook plugin serves create, update and delete to a super admin only.
 * An admin offered them meets a refusal after filling the form in.
 */
describe('the incoming webhook controls by role', () => {
	it('offers an admin no write and says who may make one', () => {
		const { container, queryByRole } = setup({ user: { roles: ['admin'] } });
		expect(container.textContent).toContain('Stripe');
		expect(queryByRole('button', { name: /new incoming webhook/i })).toBeNull();
		expect(queryByRole('button', { name: 'Edit Stripe' })).toBeNull();
		expect(queryByRole('button', { name: 'Delete Stripe' })).toBeNull();
		expect(container.textContent).toContain('Only a super admin can create, change or delete them.');
	});

	it('offers a super admin every write', () => {
		const { getByRole } = setup();
		expect(getByRole('button', { name: /new incoming webhook/i })).toBeTruthy();
		expect(getByRole('button', { name: 'Edit Stripe' })).toBeTruthy();
		expect(getByRole('button', { name: 'Delete Stripe' })).toBeTruthy();
	});
});

/*
 * Every form on the page shares one action result. A drawer that read it
 * whole showed a failed delete in the next form opened as if that form had
 * failed.
 */
describe('the incoming webhook drawer and the failures of other actions', () => {
	const drawerText = () => document.body.querySelector('form#incoming-form')?.textContent ?? '';

	it('leaves a newly opened create drawer clean after a failed delete', async () => {
		const { container, getByRole } = setup({}, { action: 'delete', error: 'Could not delete the incoming webhook. Try again.' });
		expect(container.textContent).toContain('Could not delete the incoming webhook. Try again.');
		await fireEvent.click(getByRole('button', { name: /new incoming webhook/i }));
		expect(drawerText()).not.toContain('Could not delete the incoming webhook. Try again.');
	});

	it('shows a failed save inside the open drawer, first in its form', async () => {
		const { getByRole, rerender } = setup();
		await fireEvent.click(getByRole('button', { name: 'Edit Stripe' }));
		await rerender({
			data: {
				incomingWebhooks: { ok: true, value: [stripe] },
				schemas: { ok: true, value: [{ name: 'orders' }] },
				entitlements,
				user: { roles: ['super_admin'] },
			},
			form: { action: 'update', error: 'Enter the field map as valid JSON.' },
		} as never);
		const form = document.body.querySelector('form#incoming-form') as HTMLFormElement;
		expect(form.firstElementChild?.textContent).toContain('Enter the field map as valid JSON.');
	});
});

/*
 * The plugin refuses create and update without its license. A page that kept
 * them live let the reader fill in the whole form before the refusal arrived.
 */
describe('the incoming webhook controls and the license', () => {
	const HELD = 'Creating and changing incoming webhooks is not enabled on this engine.';

	it('holds New and Edit with the reason when the plugin says the license is missing', () => {
		const { container, getByRole } = setup({ licensed: false });
		expect(container.textContent).toContain(HELD);
		expect((getByRole('button', { name: /new incoming webhook/i }) as HTMLButtonElement).disabled).toBe(true);
		expect((getByRole('button', { name: 'Edit Stripe' }) as HTMLButtonElement).disabled).toBe(true);
		expect((getByRole('button', { name: 'Delete Stripe' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('holds the first endpoint too on an empty list', () => {
		const { getAllByRole } = setup({ licensed: false, incomingWebhooks: { ok: true, value: [] } });
		for (const b of getAllByRole('button', { name: /new incoming webhook/i })) {
			expect((b as HTMLButtonElement).disabled).toBe(true);
		}
	});

	it.each([[null], [true]])('keeps New and Edit live when the flag reads %s', (licensed) => {
		const { container, getByRole } = setup({ licensed });
		expect(container.textContent).not.toContain(HELD);
		expect((getByRole('button', { name: /new incoming webhook/i }) as HTMLButtonElement).disabled).toBe(false);
		expect((getByRole('button', { name: 'Edit Stripe' }) as HTMLButtonElement).disabled).toBe(false);
	});
});

describe('the incoming webhook pager', () => {
	it('links the next page when the plugin holds more', () => {
		const { container } = setup({ total: 120, hasMore: true });
		const next = [...container.querySelectorAll('a')].find((a) => a.getAttribute('href')?.includes('offset=50'));
		expect(next?.getAttribute('href')).toBe('/admin/webhooks/incoming?limit=50&offset=50');
	});
});
