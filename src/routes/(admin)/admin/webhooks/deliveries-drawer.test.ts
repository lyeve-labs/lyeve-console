// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
const nav = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => nav);
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/webhooks?offset=50&deliveries=w1') } }));

import DeliveriesDrawer from './DeliveriesDrawer.svelte';

afterEach(() => {
	cleanup();
	nav.goto.mockReset();
});

const delivery = (id: string, success: boolean) => ({
	id,
	webhook_id: 'w1',
	event_type: 'after_create',
	schema_name: 'post',
	status_code: success ? 200 : 500,
	success,
	error: success ? null : 'Connection refused',
	duration_ms: 12,
	attempted_at: '2026-01-01T00:00:00Z',
});

/** The history the load read for the webhook the address names. */
function read(items: ReturnType<typeof delivery>[], limit = 50) {
	return { id: 'w1', limit, read: { ok: true as const, value: items } };
}

const props = (deliveries: unknown, form: unknown = null, held: unknown = null) =>
	({ form, deliveries, name: 'Ship it', held }) as never;

describe('the delivery history drawer', () => {
	it('stays shut while the address names no webhook', () => {
		render(DeliveriesDrawer, { props: props(null) });
		expect(document.body.querySelector('[role="dialog"]')).toBeNull();
	});

	it('opens on the history the load read, titled with the webhook it belongs to', () => {
		render(DeliveriesDrawer, { props: props(read([delivery('d1', true), delivery('d2', false)])) });
		const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('Delivery history for Ship it');
		expect(dialog.querySelectorAll('tbody tr')).toHaveLength(2);
	});

	it('offers a retry on a failed delivery only, posting the webhook and the delivery', () => {
		render(DeliveriesDrawer, { props: props(read([delivery('d1', true), delivery('d2', false)])) });
		const retries = [...document.body.querySelectorAll<HTMLFormElement>('form[action="?/retry-delivery"]')];
		expect(retries).toHaveLength(1);
		const body = new FormData(retries[0]);
		expect(body.get('id')).toBe('w1');
		expect(body.get('delivery_id')).toBe('d2');
	});

	it('says so when the webhook has made no attempt', () => {
		render(DeliveriesDrawer, { props: props(read([])) });
		expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('No deliveries yet');
	});

	// A failed read is never drawn as a webhook that made no attempt.
	it('shows a failed read in the drawer rather than an empty history', () => {
		render(DeliveriesDrawer, {
			props: props({ id: 'w1', limit: 50, read: { ok: false, gate: { state: 'error', message: 'Could not load deliveries.' } } }),
		});
		const dialog = document.body.querySelector('[role="dialog"]');
		expect(dialog?.textContent).toContain('Could not load deliveries.');
		expect(dialog?.textContent).not.toContain('No deliveries yet');
	});

	it('takes the webhook out of the address on close and keeps the rest', () => {
		render(DeliveriesDrawer, { props: props(read([])) });
		const close = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Close');
		close?.click();
		expect(nav.goto).toHaveBeenCalledWith('/admin/webhooks?offset=50', { noScroll: true, keepFocus: true });
	});
});

/*
 * A retry result lands in a map keyed by delivery. An effect that tracked the
 * map it rewrote reran on its own write until Svelte threw.
 */
describe('the result of a delivery retry', () => {
	it('settles and shows under the failed delivery, which keeps its retry button', async () => {
		const listed = read([delivery('d1', true), delivery('d2', false)]);
		const { rerender } = render(DeliveriesDrawer, { props: props(listed) });
		await rerender(props(listed, { retryResult: { delivery_id: 'd2', success: true, status_code: 200, message: 'Delivered' } }));
		const row = [...document.body.querySelectorAll('tbody tr')][1];
		expect(row.textContent).toContain('Delivered');
		expect(row.querySelector('form[action="?/retry-delivery"]')).toBeTruthy();
	});
});

describe('the history and its own failures', () => {
	const listed = (n = 2, limit = 50) => read(Array.from({ length: n }, (_, i) => delivery(`d${i}`, false)), limit);

	it('shows a failed retry inside the drawer, where the reader clicked', async () => {
		const { rerender } = render(DeliveriesDrawer, { props: props(listed()) });
		await rerender(props(listed(), { action: 'retry-delivery', error: 'cannot retry: webhook is disabled' }));
		expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('cannot retry: webhook is disabled');
	});

	it('holds the retry with the reason once the license refused one', () => {
		const held = { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' };
		render(DeliveriesDrawer, { props: props(listed(), null, held) });
		const retry = document.body.querySelector<HTMLButtonElement>('form[action="?/retry-delivery"] button');
		expect(retry?.disabled).toBe(true);
		expect(document.body.querySelector('[data-testid="retry-held"]')?.textContent).toContain('This is not enabled on this engine.');
	});

	// The plugin offers no offset on this list, so a full page says the older
	// attempts are not listed rather than passing for the whole history.
	it('says when the newest attempts fill the list', () => {
		render(DeliveriesDrawer, { props: props(listed(3, 3)) });
		expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Showing the newest 3 attempts.');
		cleanup();
		render(DeliveriesDrawer, { props: props(listed(2, 3)) });
		expect(document.body.querySelector('[role="dialog"]')?.textContent).not.toContain('Showing the newest');
	});
});
