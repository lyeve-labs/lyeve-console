// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/analytics-destinations') } }));

import DestinationsPage from './+page.svelte';

afterEach(cleanup);

const provider = (over: Record<string, unknown> = {}) => ({
	id: 'p1',
	name: 'Product',
	type: 'ga4',
	enabled: true,
	retry_policy: { max_attempts: 1, backoff_seconds: 0 },
	created_at: '',
	updated_at: '',
	...over,
});

const delivery = {
	id: 'd1',
	event_id: 'e1e1e1e1-0000-0000-0000-000000000000',
	provider_id: 'p1',
	provider_type: 'ga4',
	status: 'failed',
	attempts: 3,
	last_error: 'HTTP 500',
	next_attempt_at: null,
	created_at: '',
	updated_at: '',
};

function setup(over: Record<string, unknown> = {}, form: unknown = null) {
	return render(DestinationsPage, {
		props: {
			data: {
				gate: { state: 'ok' },
				providers: [provider()],
				licensed: true,
				deliveries: { data: [delivery], licensed: true },
				status: '',
				...over,
			},
			form,
		} as never,
	});
}

describe('analytics destinations', () => {
	it('lists each destination with its type and retry policy', () => {
		setup({ providers: [provider({ retry_policy: { max_attempts: 3, backoff_seconds: 30 } })] });
		const row = screen.getByTestId('destination-row');
		expect(row.textContent).toContain('Google Analytics 4');
		expect(row.textContent).toContain('3 attempts, first retry after 30s');
	});

	it('offers every destination type, the newer three included', async () => {
		setup();
		await fireEvent.click(screen.getAllByRole('button', { name: /new destination/i })[0]);
		const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('New destination');
		expect((dialog.querySelector('input[name="config_measurement_id"]') as HTMLInputElement).required).toBe(true);
		expect(dialog.querySelector('input[name="config_api_secret"]')).not.toBeNull();
	});

	it('lists a delivery owed with its error, and sends it again when the plugin would', () => {
		setup();
		const row = screen.getByTestId('delivery-row');
		expect(row.textContent).toContain('Product');
		expect(row.textContent).toContain('HTTP 500');
		expect((row.querySelector('button[aria-label="Send this delivery again"]') as HTMLButtonElement).disabled).toBe(false);
		expect(screen.queryByTestId('replay-locked')).toBeNull();
	});

	it('closes replay and a new retry policy when the plugin would refuse them', async () => {
		setup({ licensed: false, deliveries: { data: [delivery], licensed: false } });
		expect(screen.getByTestId('replay-locked')).toBeTruthy();
		expect((screen.getByRole('button', { name: 'Send this delivery again' }) as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.click(screen.getAllByRole('button', { name: /new destination/i })[0]);
		expect((document.querySelector('#destination-attempts') as HTMLInputElement).disabled).toBe(true);
	});

	it('says a replaced config returns the settings the form does not show to their defaults', async () => {
		setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Edit Product' }));
		expect(screen.getByText(/such as a timeout set through the API, to its default/)).toBeTruthy();
	});

	it('keeps a stored retry policy editable after a lapse, so it can go back to one attempt', async () => {
		setup({ licensed: false, providers: [provider({ retry_policy: { max_attempts: 3, backoff_seconds: 30 } })] });
		await fireEvent.click(screen.getByRole('button', { name: 'Edit Product' }));
		expect((document.querySelector('#destination-attempts') as HTMLInputElement).disabled).toBe(false);
	});

	it('says a failed delivery read failed', () => {
		setup({ deliveries: null });
		expect(document.body.textContent).toContain('Could not load deliveries.');
	});

	it('says more deliveries are owed than the list holds', () => {
		setup({ moreDeliveries: true, deliveryLimit: 50 });
		expect(screen.getByTestId('more-deliveries').textContent).toContain('Showing the 50 newest deliveries. More are owed');
	});

	it('names an outage of the delivery read as an outage', () => {
		setup({ deliveries: null, deliveriesGate: { state: 'unavailable' } });
		expect(document.body.textContent).toContain('is unavailable');
	});

	it('says a filtered queue matched nothing and offers to clear the filter', () => {
		setup({ deliveries: { data: [], licensed: true }, status: 'failed' });
		expect(document.body.textContent).toContain('No deliveries match these filters');
		expect(screen.getByRole('link', { name: 'Clear filters' }).getAttribute('href')).toBe('/admin/analytics-destinations');
	});

	it('says nothing is owed when the queue is empty', () => {
		setup({ deliveries: { data: [], licensed: true } });
		expect(document.body.textContent).toContain('No deliveries owed');
	});

	it('renders a refusal over the page', () => {
		setup({}, { error: 'refused', refused: { kind: 'feature', feature: 'example-feature', plugin: 'analytics', upgradeUrl: '' } });
		expect(screen.getByTestId('refusal-notice')).toBeTruthy();
	});

	it('shows a webhook signing secret once', () => {
		setup({}, { saved: 'Hook', signingSecret: 'z'.repeat(64) });
		expect(document.body.textContent).toContain('Webhook signing secret');
	});
});
