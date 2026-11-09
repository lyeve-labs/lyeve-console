// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import LivePage from './+page.svelte';

afterEach(() => cleanup());

function setup(status: unknown[] | { ok: false; gate: unknown } = [], gate: unknown = { state: 'ok' }) {
	return render(LivePage, {
		props: {
			data: {
				status: Array.isArray(status) ? { ok: true, value: status } : status,
				gate,
			},
		} as never,
	});
}

// The sign-in protection keeps one bucket for requests that resolved no
// tenant and one per tenant, for the same rule, caller and endpoint.
const bucket = {
	rule_id: '6f1c2a54-0d1e-4c4f-9a57-1b2c3d4e5f60',
	kind: 'protection',
	client_ip: '203.0.113.0',
	endpoint: 'POST /api/admin/auth/login',
	rate: 0.0055,
	burst: 5,
	remaining: 3,
	reset_at: '2099-01-01T00:00:00Z',
};

describe('the live counters page', () => {
	it('carries the strip with Right now marked', () => {
		const { getByRole } = setup();
		expect(getByRole('tab', { name: 'Right now' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'Limits' })).toBeTruthy();
	});

	it('counts the callers at their limit, and says when nobody is near one', () => {
		const { getByText } = setup();
		expect(getByText('Callers at their limit')).toBeTruthy();
		expect(getByText('Nobody is near a limit')).toBeTruthy();
	});

	it('draws an unread status as its gate, never as quiet', () => {
		const { queryByText, getByText } = setup({ ok: false, gate: { state: 'busy' } });
		expect(queryByText('Nobody is near a limit')).toBeNull();
		expect(getByText('?')).toBeTruthy();
	});

	it('says rate limiting is not in this build while its plugin does not run', () => {
		const { getByText } = setup({ ok: false, gate: { state: 'absent' } }, { state: 'absent' });
		expect(getByText('Rate limiting is not included in this build.')).toBeTruthy();
	});
});

describe('the live counters', () => {
	it('shows two buckets that differ only by tenant as two rows that say what each counts', () => {
		const { getByRole } = setup([bucket, { ...bucket, tenant_id: 'default', remaining: 1 }]);
		const table = getByRole('region', { name: 'Right now' });
		const rows = [...table.querySelectorAll('tbody tr')];
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('No tenant');
		expect(rows[0].textContent).toContain('3 of 5');
		expect(rows[1].textContent).toContain('Tenant default');
		expect(rows[1].textContent).toContain('1 of 5');
		expect(rows[0].textContent).not.toBe(rows[1].textContent);
	});

	it('says a global limit bucket counts every tenant', () => {
		const global = { ...bucket, kind: 'global', endpoint: '*' };
		const { getByRole } = setup([global, { ...bucket, tenant_id: 'default' }]);
		const rows = [...getByRole('region', { name: 'Right now' }).querySelectorAll('tbody tr')];
		expect(rows[0].textContent).toContain('Every tenant');
		expect(rows[1].textContent).toContain('Tenant default');
	});

	it('keeps both rows when the masked address makes two buckets read alike', () => {
		const { getByRole } = setup([bucket, { ...bucket, remaining: 0 }]);
		expect(getByRole('region', { name: 'Right now' }).querySelectorAll('tbody tr')).toHaveLength(2);
	});
});
