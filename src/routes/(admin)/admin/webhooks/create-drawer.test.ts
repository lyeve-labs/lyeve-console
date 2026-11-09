// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import WebhooksPage from './+page.svelte';

afterEach(cleanup);

const entitlements = { plan: 'example', state: 'active', features: ['webhook'], tenant_quota: 1 };

describe('webhooks create drawer posts a real event list', () => {
	it('names every checkbox so getAll("events") sees a list', async () => {
		const { container, getAllByText } = render(WebhooksPage, {
			props: {
				data: { webhooks: { ok: true, value: [] }, schemas: { ok: true, value: [{ name: 'post' }] }, entitlements, user: { roles: ['super_admin'] } },
				form: null
			} as never
		});

		await fireEvent.click(getAllByText("New webhook")[0]);

		const events = container.querySelectorAll('input[type="checkbox"][name="events"]');
		expect(events).toHaveLength(6);
		// The schemas are a searchable pick list. Nothing picked posts no schema,
		// which the plugin reads as every schema.
		expect(container.querySelector('#webhook-schemas')).toBeTruthy();
		expect(container.querySelectorAll('input[name="schemas"]')).toHaveLength(0);
		expect(container.querySelector('input[type="hidden"][name="enabled"]')).toBeTruthy();
		expect(container.querySelector('input[type="password"][name="secret"]')).toBeTruthy();
		expect(container.querySelector('form[action="?/create"]')).toBeTruthy();
	});

	it('says what an empty delivery option means and when an option is refused', async () => {
		const { container, getAllByText } = render(WebhooksPage, {
			props: {
				data: { webhooks: { ok: true, value: [] }, schemas: { ok: true, value: [{ name: 'post' }] }, entitlements, user: { roles: ['super_admin'] } },
				form: null
			} as never
		});

		await fireEvent.click(getAllByText("New webhook")[0]);

		const options =
			[...container.querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent === 'Delivery options')
				?.textContent ?? '';
		expect(options).toContain(
			'Leave a field empty to use the default. An option that is not enabled on this engine cannot be saved.'
		);
	});
});

describe('webhooks edit drawer posts the schemas it holds', () => {
	it('posts each schema the webhook names, also when the schema list was not read', async () => {
		const hook = { id: 'w1', name: 'Ship it', url: 'https://example.com/hook', events: [], schemas: ['orders', 'posts'], enabled: true };
		const { container, getByRole } = render(WebhooksPage, {
			props: {
				data: {
					webhooks: { ok: true, value: [hook] },
					schemas: { ok: false, gate: { state: 'unavailable' } },
					entitlements,
					user: { roles: ['super_admin'] },
				},
				form: null,
			} as never,
		});
		await fireEvent.click(getByRole('button', { name: 'Edit Ship it' }));
		const posted = [...container.querySelectorAll('form#webhook-form input[name="schemas"]')].map((i) => (i as HTMLInputElement).value);
		expect(posted).toEqual(['orders', 'posts']);
		expect(container.textContent).toContain('Could not load content types');
	});
});

/*
 * A new webhook names no schema, and one saved with none fires on every
 * schema. During a schema outage nothing can be picked, so the form says what
 * saving it now does.
 */
describe('webhooks create drawer during a schema outage', () => {
	it('says a webhook saved without a schema fires on every schema', async () => {
		const { container, getAllByText } = render(WebhooksPage, {
			props: {
				data: {
					webhooks: { ok: true, value: [] },
					schemas: { ok: false, gate: { state: 'unavailable' } },
					entitlements,
					user: { roles: ['super_admin'] },
				},
				form: null,
			} as never,
		});
		await fireEvent.click(getAllByText('New webhook')[0]);
		const form = container.querySelector('form#webhook-form') as HTMLFormElement;
		expect(form.textContent).toContain('If you save it like this, the webhook fires for every content type.');
		expect(form.textContent).not.toContain('already names');
	});
});
