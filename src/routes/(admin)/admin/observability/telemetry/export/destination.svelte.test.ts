// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), invalidateAll: vi.fn(async () => {}) }));
const forms = vi.hoisted(() => ({ submits: new Map<string, unknown>() }));
vi.mock('$app/forms', () => ({
	enhance: (form: HTMLFormElement, submit: unknown) => {
		forms.submits.set(form.getAttribute('action') ?? '', submit);
		return { destroy() {} };
	},
}));

const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, confirm: kit.confirm };
});

import TelemetryPage from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

// A stored destination as the plugin answers it. The health is the plugin's
// exporter health, named for the tenant, with Go times that JSON writes as
// the zero time rather than leaving out. An OTLP push that fails is always
// reported unreachable, with addresses and URLs redacted from its error.
const STORED = {
	kind: 'otlp',
	url: 'https://otlp.example.com/v1/metrics',
	header_names: ['Authorization', 'X-Scope'],
	health: {
		name: 'acme',
		healthy: false,
		last_export: '2026-10-13T08:00:00Z',
		last_failure: '2026-10-14T09:00:00Z',
		last_error: 'otlp: export: Post "[redacted]": dial tcp [redacted]: connect: connection refused',
		last_error_class: 'unreachable',
		exports: 3,
		failures: 2,
	},
};

/** The page's data, with the destination read as given. */
function pageData(destination: unknown) {
	const read =
		destination !== null && typeof destination === 'object' && 'ok' in destination
			? destination
			: { ok: true, value: destination };
	return { superAdmin: false, families: { ok: true, value: [] }, exporters: null, destination: read } as never;
}

function props(destination: unknown, form: Record<string, unknown> | null = null) {
	return { data: pageData(destination), form: form as never };
}

function formFor(container: HTMLElement, action: string): HTMLFormElement {
	const form = container.querySelector<HTMLFormElement>(`form[action="${action}"]`);
	if (!form) throw new Error(`no form for ${action}`);
	return form;
}

describe('the tenant destination', () => {
	it('names the stored headers and never shows a value', () => {
		const { container } = render(TelemetryPage, props({ destination: STORED, licensed: true }));
		expect(said(container)).toContain('Authorization, X-Scope');
		expect(said(container)).toContain('Their values are never shown');
		expect((screen.getByLabelText(/^URL/) as HTMLInputElement).value).toBe(STORED.url);
		expect(said(container)).toContain('Failing');
		expect(said(container)).toContain('connect: connection refused');
	});

	it('warns before a save that moves the host while keeping the headers', async () => {
		render(TelemetryPage, props({ destination: STORED, licensed: true }));
		const url = screen.getByLabelText(/^URL/) as HTMLInputElement;
		await fireEvent.input(url, { target: { value: 'https://collector.example.net/v1/metrics' } });
		expect(screen.getByTestId('telemetry-destination').textContent).toContain('the stored headers do not carry over');
	});

	it('explains the refusal to carry the headers to another host', () => {
		const { container } = render(
			TelemetryPage,
			props(
				{ destination: STORED, licensed: true },
				{
					destinationAction: 'save',
					destinationError: 'the destination moved to another host, send its headers again',
					hostMoved: true,
				},
			),
		);
		expect(said(container)).toContain('Enter the headers again for the new host');
	});

	it('asks for headers directly when none are stored', () => {
		render(TelemetryPage, props({ destination: null, licensed: true }));
		expect(screen.queryByText('Keep the stored headers')).toBeNull();
		expect(screen.getByRole('button', { name: /Add header/ })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Delete destination' })).toBeNull();
	});

	it('says what an unlicensed install keeps', () => {
		const { container } = render(TelemetryPage, props({ destination: STORED, licensed: false }));
		expect(said(container)).toContain('needs a license that includes it');
		expect(screen.getByRole('button', { name: 'Delete destination' })).toBeTruthy();
	});

	// The form stayed live with Save enabled, so an unlicensed reader filled it
	// in only to be refused on submit.
	it('offers no save the license refuses, and says why beside the button', () => {
		const { container } = render(TelemetryPage, props({ destination: STORED, licensed: false }));
		const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		expect((screen.getByLabelText(/^URL/) as HTMLInputElement).matches(':disabled')).toBe(true);
		expect(said(container)).toContain('Not enabled on this engine.');
		expect((screen.getByRole('button', { name: 'Delete destination' }) as HTMLButtonElement).disabled).toBe(false);
	});

	// A disabled fieldset stops a press but not the arrow keys, which the
	// header choice handles itself, so the choice has to be disabled too.
	it('leaves the header choice unmovable on an unlicensed install', async () => {
		const { container } = render(TelemetryPage, props({ destination: STORED, licensed: false }));
		const keep = screen.getByRole('radio', { name: 'Keep the stored headers' });
		await fireEvent.keyDown(keep, { key: 'ArrowRight' });
		expect(said(container)).toContain('Their values are never shown');
		expect(screen.queryByRole('button', { name: /Add header/ })).toBeNull();
	});

	it('keeps the save live on a licensed install', () => {
		render(TelemetryPage, props({ destination: STORED, licensed: true }));
		expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('names the destination in the delete confirmation', async () => {
		render(TelemetryPage, props({ destination: STORED, licensed: true }));
		const submit = forms.submits.get('?/removeDestination') as (i: { cancel: () => void }) => Promise<unknown>;
		await submit({ cancel: vi.fn() });
		expect(kit.confirm).toHaveBeenCalledWith(
			'Delete the destination https://otlp.example.com/v1/metrics?',
			expect.any(String),
			{ confirmLabel: 'Delete' },
		);
	});

	it('renders a refused save through the refusal notice', () => {
		render(
			TelemetryPage,
			props(
				{ destination: null, licensed: false },
				{
					destinationAction: 'save',
					destinationError: 'x',
					refused: { kind: 'feature', feature: 'example-feature', plugin: 'telemetry', upgradeUrl: '' },
				},
			),
		);
		expect(screen.getByTestId('refusal-notice')).toBeTruthy();
	});

	it('reports an unread destination as a failure with its own sentence', () => {
		const message = 'Could not load the destination.';
		const { container } = render(TelemetryPage, props({ ok: false, gate: { state: 'error', message } }));
		expect(said(container)).toContain(message);
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
	});

	it('says the engine did not answer the destination read', () => {
		const { container } = render(TelemetryPage, props({ ok: false, gate: { state: 'unavailable' } }));
		expect(said(container)).toContain('so tenant destination did not load');
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
	});
});

describe('the destination failures', () => {
	it('shows a failed save inside the save form', () => {
		const { container } = render(
			TelemetryPage,
			props({ destination: STORED, licensed: true }, { destinationAction: 'save', destinationError: 'Could not save the destination. Try again.' }),
		);
		expect(formFor(container, '?/saveDestination').textContent).toContain('Could not save the destination. Try again.');
		expect(formFor(container, '?/removeDestination').textContent).not.toContain('Could not save');
	});

	// The save and the delete share one form result, so a failed delete
	// must not read as the save having failed.
	it('shows a failed delete beside the delete, never in the save form', () => {
		const { container } = render(
			TelemetryPage,
			props(
				{ destination: STORED, licensed: true },
				{ destinationAction: 'remove', destinationError: 'Could not delete the destination. Try again.' },
			),
		);
		expect(formFor(container, '?/removeDestination').textContent).toContain('Could not delete the destination. Try again.');
		expect(formFor(container, '?/saveDestination').textContent).not.toContain('Could not delete');
	});

	it('shows no destination failure for an export failure', () => {
		const { container } = render(
			TelemetryPage,
			props({ destination: STORED, licensed: true }, { name: 'otlp', error: 'Could not export otlp. Try again.' }),
		);
		expect(screen.getByTestId('telemetry-destination').textContent).not.toContain('Could not export');
		expect(formFor(container, '?/saveDestination').querySelector('[role="alert"]')?.textContent ?? '').toBe('');
	});
});

describe('the destination form across reloads', () => {
	// A refresh or an export reloads the page data, which hands the page a
	// new destination object holding the same values.
	it('keeps an edit in progress through a reload that changed nothing', async () => {
		const { rerender } = render(TelemetryPage, props({ destination: STORED, licensed: true }));
		const url = screen.getByLabelText(/^URL/) as HTMLInputElement;
		await fireEvent.input(url, { target: { value: 'https://otlp.example.com/v2/metrics' } });
		await rerender(props({ destination: { ...STORED, header_names: [...STORED.header_names] }, licensed: true }));
		expect((screen.getByLabelText(/^URL/) as HTMLInputElement).value).toBe('https://otlp.example.com/v2/metrics');
	});

	// A save that changed only header values leaves what the page reads the
	// same, so nothing but the save itself clears the values typed.
	it('clears the header values typed once a save of them succeeds', async () => {
		const { rerender } = render(TelemetryPage, props({ destination: STORED, licensed: true }));
		await fireEvent.click(screen.getByRole('radio', { name: 'Replace them' }));
		await fireEvent.click(screen.getByRole('button', { name: /Add header/ }));
		await fireEvent.input(screen.getByLabelText('Header'), { target: { value: 'Authorization' } });
		await fireEvent.input(screen.getByLabelText('Value'), { target: { value: 'Bearer new-key' } });
		expect((screen.getByLabelText('Value') as HTMLInputElement).value).toBe('Bearer new-key');

		const submit = forms.submits.get('?/saveDestination') as (i: unknown) => Promise<(o: unknown) => Promise<void>>;
		const after = await submit({ cancel: vi.fn(), formData: new FormData() });
		await after({
			result: { type: 'success', status: 200, data: { savedDestination: true } },
			update: async () => {
				await rerender(props({ destination: { ...STORED, header_names: [...STORED.header_names] }, licensed: true }));
			},
		});
		await tick();

		expect(screen.queryByLabelText('Value')).toBeNull();
		expect(screen.queryByDisplayValue('Bearer new-key')).toBeNull();
		expect((screen.getByLabelText(/^URL/) as HTMLInputElement).value).toBe(STORED.url);
		expect(said(document.body)).toContain('Their values are never shown');
	});

	it('follows a stored destination that changed', async () => {
		const { rerender } = render(TelemetryPage, props({ destination: STORED, licensed: true }));
		const url = screen.getByLabelText(/^URL/) as HTMLInputElement;
		await fireEvent.input(url, { target: { value: 'https://otlp.example.com/v2/metrics' } });
		await rerender(props({ destination: { ...STORED, url: 'https://collector.example.net/v1/metrics' }, licensed: true }));
		expect((screen.getByLabelText(/^URL/) as HTMLInputElement).value).toBe('https://collector.example.net/v1/metrics');
	});
});

describe('the stored headers note', () => {
	// Written after the choice, the note was not read with it.
	it('belongs to the header choice, so a screen reader reads it with the control', () => {
		render(TelemetryPage, props({ destination: STORED, licensed: true }));
		const group = screen.getByRole('radiogroup', { name: 'Headers' });
		const ids = (group.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
		const described = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
		expect(described).toContain('Stored: Authorization, X-Scope. Their values are never shown.');
	});
});
