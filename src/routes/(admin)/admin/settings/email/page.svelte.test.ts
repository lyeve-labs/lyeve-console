// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProvidersPage from './+page.svelte';
import type { EmailProvider } from '$lib/api/email';

type Submit = (input: { cancel: () => void; formData: FormData }) => Promise<unknown>;
const forms = vi.hoisted(() => ({ submits: new Map<HTMLFormElement, unknown>() }));
vi.mock('$app/forms', () => ({
	enhance: (form: HTMLFormElement, submit: unknown) => {
		forms.submits.set(form, submit);
		return { destroy() {} };
	},
}));
const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => true) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

/**
 * Submit the form a row's delete button sits in, and return the question it
 * asked, what the form sends and whether the submit went ahead.
 */
async function pressDelete(button: HTMLElement, field: string, answer = true) {
	const form = button.closest('form') as HTMLFormElement;
	const cancel = vi.fn();
	kit.confirm.mockClear();
	kit.confirm.mockResolvedValueOnce(answer);
	await (forms.submits.get(form) as Submit)({ cancel, formData: new FormData(form) });
	return {
		action: form.getAttribute('action'),
		title: String((kit.confirm.mock.calls[0] as unknown[] | undefined)?.[0] ?? ''),
		sent: String(new FormData(form).get(field) ?? ''),
		sentOff: !cancel.mock.calls.length,
	};
}


afterEach(cleanup);

const smtp: EmailProvider = {
	id: 'p1',
	name: 'Primary',
	transport: 'smtp',
	host: 'smtp.example.test',
	port: 587,
	username: 'mailer',
	from_addr: 'noreply@example.test',
	use_tls: true,
	priority: 0,
	max_per_hour: 0,
	status: 'active',
};

const api: EmailProvider = {
	...smtp,
	id: 'p2',
	name: 'Mailgun',
	transport: 'api',
	host: '',
	port: 0,
	username: undefined,
	api_base_url: 'https://api.mailgun.net',
	api_method: 'POST',
	api_path: '/v3/example.test/messages',
	api_headers: { Authorization: 'Basic {{api_key}}' },
	api_body: '{"from": "{{from}}"}',
	api_message_id_path: 'id',
	api_webhook_event_path: 'event-data.event',
	api_webhook_recipient_path: 'event-data.recipient',
	api_webhook_message_id_path: 'event-data.message.headers.message-id',
	api_webhook_reason_path: 'event-data.delivery-status.message',
	api_webhook_event_map: { delivered: 'delivered', failed: 'bounced_hard' },
	priority: 1,
	status: 'degraded',
};

function setup(providers: EmailProvider[] = [smtp, api], overrides: Record<string, unknown> = {}, form: unknown = null) {
	return render(ProvidersPage, {
		props: { data: { providers: { ok: true, value: providers }, mail: null, ...overrides }, form } as never,
	});
}

function formEl(container: HTMLElement): HTMLFormElement {
	return container.querySelector('#provider-form') as HTMLFormElement;
}

function names(form: HTMLFormElement): string[] {
	return [...form.querySelectorAll('[name]')].map((el) => el.getAttribute('name') ?? '');
}

const down = { ok: false, gate: { state: 'unavailable' } };

const API_FIELDS = [
	'api_key',
	'api_base_url',
	'webhook_secret',
	'api_method',
	'api_path',
	'api_body',
	'api_message_id_path',
	'api_webhook_event_path',
	'api_webhook_recipient_path',
	'api_webhook_message_id_path',
	'api_webhook_reason_path',
];

function segment(container: HTMLElement, group: string, label: string): HTMLElement {
	const radios = container.querySelector(`[role="radiogroup"][aria-label="${group}"]`) as HTMLElement;
	return within(radios).getByRole('radio', { name: label });
}

async function chooseTransport(container: HTMLElement, label: string) {
	await fireEvent.click(segment(container, 'Transport', label));
}

describe('email providers page', () => {
	it('says the plugin did not answer, and offers nothing to create', () => {
		const { container, queryByText } = setup([], { providers: down });
		expect(container.textContent).toContain('so email providers did not load');
		expect(queryByText('No providers yet')).toBeNull();
		expect(queryByText('New provider')).toBeNull();
	});

	it('tells a role the plugin refuses that it cannot open the providers', () => {
		const { container, queryByText } = setup([], { providers: { ok: false, gate: { state: 'forbidden' } } });
		expect(container.textContent).toContain('Your role cannot open email providers');
		expect(queryByText('No providers yet')).toBeNull();
	});

	it('lists transport, endpoint and the webhook path per row and never a key', () => {
		const { container } = setup();
		expect(container.textContent).toContain('Beta');
		const rows = [...container.querySelectorAll('tbody tr')];
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('SMTP');
		expect(rows[0].textContent).toContain('smtp.example.test');
		expect(rows[0].textContent).not.toContain('/api/v1/email/webhook');
		expect(rows[1].textContent).toContain('API');
		expect(rows[1].textContent).toContain('https://api.mailgun.net');
		expect(rows[1].textContent).toContain('/api/v1/email/webhook/api/p2');
		expect(rows[1].textContent).toContain('degraded');
		expect(container.textContent).not.toMatch(/api_key|password|secret/i);
	});

	it('opens a new row on smtp with the server fields and no api fields', async () => {
		const { getAllByText, container } = setup([]);
		await fireEvent.click(getAllByText('New provider')[0]);
		const form = formEl(container);
		expect(form.getAttribute('action')).toBe('?/create');
		expect((form.querySelector('input[name="transport"]') as HTMLInputElement).value).toBe('smtp');
		expect(names(form)).toEqual(expect.arrayContaining(['host', 'port', 'username', 'password', 'use_tls']));
		expect((form.querySelector('[name="port"]') as HTMLInputElement).value).toBe('587');
		for (const name of API_FIELDS) expect(form.querySelector(`[name="${name}"]`), name).toBeNull();
	});

	it('starts with implicit TLS off on port 587 and names port 465 for it', async () => {
		const { getAllByText, container } = setup([]);
		await fireEvent.click(getAllByText('New provider')[0]);
		const form = formEl(container);
		expect((form.querySelector('[name="port"]') as HTMLInputElement).value).toBe('587');
		expect((form.querySelector('input[name="use_tls"]') as HTMLInputElement).value).toBe('false');
		expect(form.textContent).toContain('Implicit TLS');
		expect(form.textContent).toContain('465');
		expect(form.textContent).not.toContain('STARTTLS on the connection');
	});

	it('switches to the api fields, asks for the key and names the placeholders', async () => {
		const { getAllByText, container } = setup([]);
		await fireEvent.click(getAllByText('New provider')[0]);
		await chooseTransport(container, 'Provider API');
		const form = formEl(container);
		expect((form.querySelector('input[name="transport"]') as HTMLInputElement).value).toBe('api');
		expect(form.querySelector('[name="host"]')).toBeNull();
		expect(form.querySelector('[name="password"]')).toBeNull();
		expect(names(form)).toEqual(expect.arrayContaining(API_FIELDS));
		const key = form.querySelector('[name="api_key"]') as HTMLInputElement;
		expect(key.type).toBe('password');
		expect(key.required).toBe(true);
		expect(key.value).toBe('');
		expect((form.querySelector('[name="webhook_secret"]') as HTMLInputElement).type).toBe('password');
		expect((form.querySelector('[name="api_base_url"]') as HTMLInputElement).required).toBe(true);
		expect((form.querySelector('input[name="api_method"]') as HTMLInputElement).value).toBe('POST');
		expect(container.textContent).toContain('{{api_key}}');
		expect(container.textContent).toContain('{{basic:<user>}}');
		expect(container.textContent).toContain('{{to_first}}');
		expect(container.textContent).toContain('{{to_objects}}');
		expect(container.textContent).toContain('{{message_id}}');
		const methods = container.querySelector('[role="radiogroup"][aria-label="Method"]') as HTMLElement;
		expect(within(methods).getAllByRole('radio').map((o) => o.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
		expect(within(methods).getByRole('radio', { name: 'PATCH' })).toBeTruthy();
		await fireEvent.click(segment(container, 'Method', 'PUT'));
		expect((form.querySelector('input[name="api_method"]') as HTMLInputElement).value).toBe('PUT');

		await chooseTransport(container, 'SMTP');
		expect(form.querySelector('[name="api_key"]')).toBeNull();
		expect(form.querySelector('[name="host"]')).toBeTruthy();
	});

	it('edits an api row with the key blank and kept, the maps as rows and the webhook path named', async () => {
		const { getByLabelText, container } = setup();
		await fireEvent.click(getByLabelText('Edit Mailgun'));
		const form = formEl(container);
		expect(form.getAttribute('action')).toBe('?/update');
		expect((form.querySelector('[name="stored_transport"]') as HTMLInputElement).value).toBe('api');
		const key = form.querySelector('[name="api_key"]') as HTMLInputElement;
		expect(key.value).toBe('');
		expect(key.required).toBe(false);
		expect(container.textContent).toContain('Leave blank to keep it');
		expect(container.textContent).toContain('/api/v1/email/webhook/api/p2');
		expect((form.querySelector('[name="api_base_url"]') as HTMLInputElement).value).toBe('https://api.mailgun.net');
		expect([...form.querySelectorAll('[name="api_header_key"]')].map((el) => (el as HTMLInputElement).value)).toEqual(['Authorization']);
		expect([...form.querySelectorAll('[name="api_header_value"]')].map((el) => (el as HTMLInputElement).value)).toEqual(['Basic {{api_key}}']);
		expect([...form.querySelectorAll('[name="event_map_key"]')].map((el) => (el as HTMLInputElement).value)).toEqual(['delivered', 'failed']);
		expect([...form.querySelectorAll('input[name="event_map_value"]')].map((el) => (el as HTMLInputElement).value)).toEqual(['delivered', 'bounced_hard']);
		expect((form.querySelector('[name="api_body"]') as HTMLTextAreaElement).value).toBe('{"from": "{{from}}"}');
		expect((form.querySelector('[name="api_webhook_reason_path"]') as HTMLInputElement).value).toBe('event-data.delivery-status.message');
	});

	it('edits an smtp row with the password blank and kept, and asks for a key on a transport change', async () => {
		const { getByLabelText, container } = setup();
		await fireEvent.click(getByLabelText('Edit Primary'));
		const form = formEl(container);
		expect((form.querySelector('[name="host"]') as HTMLInputElement).value).toBe('smtp.example.test');
		const pw = form.querySelector('[name="password"]') as HTMLInputElement;
		expect(pw.type).toBe('password');
		expect(pw.value).toBe('');
		expect((form.querySelector('input[name="use_tls"]') as HTMLInputElement).value).toBe('true');
		expect(container.textContent).toContain('Leave blank to keep it');

		await chooseTransport(container, 'Provider API');
		expect((form.querySelector('[name="api_key"]') as HTMLInputElement).required).toBe(true);
		expect(container.textContent).toContain('Enter a key for the new transport.');
	});

	const drawerText = (container: HTMLElement) => formEl(container)?.textContent ?? '';

	it('reports a refused save inside the open drawer', async () => {
		const { getAllByText, container, rerender } = setup([smtp]);
		await fireEvent.click(getAllByText('New provider')[0]);
		await rerender({ data: { providers: { ok: true, value: [smtp] }, mail: null }, form: { action: 'provider', error: 'An API key is required.' } } as never);
		expect(drawerText(container)).toContain('An API key is required.');
	});

	it('shows a failed delete above the list and leaves a newly opened drawer clean', async () => {
		const failed = 'Could not delete the provider. Try again.';
		const { getAllByText, container } = setup([smtp], {}, { action: 'delete', error: failed });
		expect(container.textContent).toContain(failed);
		await fireEvent.click(getAllByText('New provider')[0]);
		expect(drawerText(container)).not.toContain(failed);
	});

	it('keeps a mail setting failure out of the provider drawer', async () => {
		const { getAllByText, container } = setup([smtp], {}, { key: 'SMTP_HOST', error: 'This setting cannot be changed here.' });
		await fireEvent.click(getAllByText('New provider')[0]);
		expect(drawerText(container)).not.toContain('This setting cannot be changed here.');
	});
});

// The fallback transport has to render even where the pool above it cannot,
// because the reset and sign-in mailers read these settings directly when no
// provider can send.
describe('email page fallback transport', () => {
	const mail = [
		{ key: 'SMTP_HOST', source: 'default', editable: true },
		{ key: 'SMTP_PASS', source: 'env', editable: false, secret: true },
	];

	it('keeps the engine mail settings, editable or pinned', () => {
		const { container } = setup([smtp], { mail: { ok: true, value: mail } });
		expect(container.querySelector('#set-SMTP_HOST')).toBeTruthy();
		expect(container.textContent).toContain('Stored, not shown.');
	});

	it('shows it when the provider pool did not answer', () => {
		const { container } = setup([], { providers: down, mail: { ok: true, value: mail } });
		expect(container.querySelector('#set-SMTP_HOST')).toBeTruthy();
		expect(container.textContent).toContain('Fallback transport');
	});

	it('says which of the two sends, so neither reads as the other', () => {
		// Normalized: the copy wraps, and textContent keeps the newline and the
		// indent, so a phrase that spans two source lines never matches raw.
		const text = (setup([smtp], { mail: { ok: true, value: mail } }).container.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toContain('Provider pool');
		expect(text).toContain('Set up how this engine sends mail.');
		expect(text).toContain('The healthy provider with the lowest priority number sends first');
		expect(text).toContain('used when the pool is empty or every provider in it fails');
		expect(text).toContain('takes effect at the next engine restart');
	});

	it('says the transport could not be read rather than leaving it out', () => {
		const { container } = setup([smtp], { mail: { ok: false, gate: { state: 'error', message: 'Could not load the fallback transport.' } } });
		expect(container.textContent).toContain('Fallback transport');
		expect(container.textContent).toContain('Could not load the fallback transport.');
		expect(container.querySelector('#set-SMTP_HOST')).toBeNull();
	});

	it('leaves the section out for a session that may not read it', () => {
		const { container } = setup([smtp], { mail: null });
		expect(container.querySelector('#set-SMTP_HOST')).toBeNull();
		expect(container.textContent).not.toContain('Fallback transport');
	});
});

describe('email provider controls', () => {
	it('offers the transport, the method and the status as segments, with every option in sight', async () => {
		const { getAllByText, container } = setup([]);
		await fireEvent.click(getAllByText('New provider')[0]);
		await chooseTransport(container, 'Provider API');
		for (const group of ['Transport', 'Method', 'Status']) {
			expect(container.querySelector(`[role="radiogroup"][aria-label="${group}"]`), group).toBeTruthy();
		}
		expect(container.querySelector('#ep-transport')).toBeNull();
		expect(container.querySelector('#ep-status')).toBeNull();
		await fireEvent.click(segment(container, 'Status', 'Paused'));
		expect((formEl(container).querySelector('input[name="status"]') as HTMLInputElement).value).toBe('paused');
	});

	it('names the transport and the method hints as the descriptions of their groups', async () => {
		const { getAllByText, container } = setup([]);
		await fireEvent.click(getAllByText('New provider')[0]);
		await chooseTransport(container, 'Provider API');
		const hints: Record<string, string> = {
			Transport: 'SMTP sends through a mail server.',
			Method: 'The HTTP method of the send request.',
		};
		for (const [group, hint] of Object.entries(hints)) {
			const radios = container.querySelector(`[role="radiogroup"][aria-label="${group}"]`) as HTMLElement;
			const ids = radios.getAttribute('aria-describedby') ?? '';
			expect(ids, group).not.toBe('');
			const read = ids.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
			expect(read, group).toContain(hint);
		}
	});
});

describe('email provider delete', () => {
	it('names the provider and sends its id', async () => {
		const { getByLabelText } = setup([smtp]);
		const out = await pressDelete(getByLabelText('Delete Primary'), 'id');
		expect(out.action).toBe('?/delete');
		expect(out.title).toBe('Delete provider Primary?');
		expect(out.sent).toBe('p1');
		expect(out.sentOff).toBe(true);
	});

	it('sends nothing when the question is declined', async () => {
		const { getByLabelText } = setup([smtp]);
		expect((await pressDelete(getByLabelText('Delete Primary'), 'id', false)).sentOff).toBe(false);
	});
});
