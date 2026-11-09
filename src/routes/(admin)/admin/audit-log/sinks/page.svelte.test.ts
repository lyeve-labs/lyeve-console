// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// enhance keeps each form's submit handler, so a case can run the one a
// delete would run and read the question it asks.
const kit = vi.hoisted(() => ({
	submits: new Map<HTMLFormElement, (input: unknown) => unknown>(),
	confirm: vi.fn(async () => false),
}));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, submit: (input: unknown) => unknown) => {
		kit.submits.set(node, submit);
		return { destroy: () => kit.submits.delete(node) };
	},
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

import SinksPage from './+page.svelte';

afterEach(cleanup);

const sink = {
	id: 's1',
	name: 'Security SIEM',
	kind: 'splunk',
	url: 'https://splunk.example.com/services/collector/event',
	enabled: true,
	has_secret: true,
	cursor_sequence: 10,
	consecutive_failures: 2,
	last_error: 'receiver answered 503',
	last_error_at: '2026-10-02T09:00:00Z',
	pending_entries: 40,
	lag_seconds: 125,
	created_at: '',
	updated_at: '',
};

function setup(data: Record<string, unknown>, form: unknown = null) {
	return render(SinksPage, { props: { data: { gate: { state: 'ok' }, sinks: [], ...data }, form } as never });
}

describe('audit sinks page', () => {
	it('shows how far behind a destination is and its last error', () => {
		const { container, getByTestId } = setup({ sinks: [sink] });
		expect(container.textContent).toContain('40 entries waiting, 2 min behind');
		expect(container.textContent).toContain('2 failed attempts in a row');
		expect(getByTestId('sink-error').textContent).toContain('receiver answered 503');
	});

	it('says nothing receives the log when there is no destination', () => {
		const { container } = setup({});
		expect(container.textContent).toContain('No destinations yet');
	});

	it('shows a generated secret once, after the create', async () => {
		const { container } = setup({ sinks: [sink] }, { created: 'Hook', secret: 'whsec_once' });
		expect(document.body.textContent).toContain('It is not shown again');
		await vi.waitFor(() => expect(container.textContent).toContain('Hook created. It now receives the audit log'));
	});

	it('renders a refused delete as the refusal notice', () => {
		const { getAllByTestId } = setup(
			{ sinks: [sink] },
			{ action: 'delete', error: 'x', refused: { kind: 'feature', feature: 'example-capability', plugin: 'example', upgradeUrl: '' } },
		);
		expect(getAllByTestId('refusal-notice')[0].textContent).toContain('Not enabled on this engine');
	});

	it('says why the page is empty when the plugin is not there', () => {
		const { container } = setup({ gate: { state: 'absent' } });
		expect(container.textContent).toContain('Audit streaming is not included in this build');
	});
});

describe('audit sink controls', () => {
	// Three short kinds are a row of segments, every one in sight at once.
	it('offers the destination kinds as segments, not a list to open', async () => {
		setup({ sinks: [sink] });
		await fireEvent.click(screen.getByRole('button', { name: /new destination/i }));
		expect(screen.getByRole('radio', { name: 'HTTPS endpoint' })).toBeTruthy();
		expect(screen.getByRole('radiogroup', { name: 'Destination' })).toBeTruthy();
	});

	it('names the destination in the delete confirmation title', async () => {
		setup({ sinks: [sink] });
		const form = screen.getByRole('button', { name: 'Delete Security SIEM' }).closest('form');
		const submit = form && kit.submits.get(form);
		expect(submit).toBeTruthy();
		await submit?.({ cancel: vi.fn() });
		const [title] = kit.confirm.mock.calls[0] as unknown as [string];
		expect(title).toBe('Delete destination Security SIEM?');
	});
});

describe('audit sink failures stay where they were made', () => {
	it('shows a failed test on the page and opens the destination drawer clean', async () => {
		const { container } = setup({ sinks: [sink] }, { action: 'test', error: 'Could not send the test. Try again.' });
		expect(container.textContent).toContain('Could not send the test. Try again.');
		await fireEvent.click(screen.getByRole('button', { name: /new destination/i }));
		expect((document.getElementById('sink-form') as HTMLFormElement).textContent).not.toContain('Could not send the test');
	});

	it('keeps a refused create in the drawer and off the page', () => {
		const { container } = setup({ sinks: [sink] }, { action: 'create', error: 'Check the highlighted fields.', fields: { url: 'Enter the URL.' } });
		expect(container.textContent).not.toContain('Check the highlighted fields.');
	});
});
