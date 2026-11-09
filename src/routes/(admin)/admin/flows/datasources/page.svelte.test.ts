// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DatasourcesPage from './+page.svelte';
import type { Entitlements } from '$lib/entitlements';
import type { Datasource } from '$lib/api/flows';
import { AUTH_TYPES } from '$lib/flow/datasources';

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/flows/datasources') } }));
// enhance keeps each form's submit handler, so a case can run the one a
// delete would run and read the question it asks.
const forms = vi.hoisted(() => ({
	submits: new Map<HTMLFormElement, (input: unknown) => unknown>(),
	confirm: vi.fn(async () => false),
}));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, submit: (input: unknown) => unknown) => {
		forms.submits.set(node, submit);
		return { destroy: () => forms.submits.delete(node) };
	},
}));
vi.mock('@lyeve-labs/ui-kit', async (original) => ({
	...(await original<typeof import('@lyeve-labs/ui-kit')>()),
	confirm: forms.confirm,
}));
const upgrade = vi.hoisted(() => ({ link: null as { href: string; label?: string } | null }));
vi.mock('$lib/instance.svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/instance.svelte')>();
	return {
		...actual,
		useInstance: () => ({ ...actual.instanceFrom(() => null), upgradeLink: () => upgrade.link }),
	};
});

afterEach(() => {
	cleanup();
	upgrade.link = null;
});

const licensed: Entitlements = { plan: 'example', state: 'active', features: ['flow'], tenant_quota: 1 };

const warehouse: Datasource = {
	id: 'd1',
	name: 'warehouse',
	kind: 'postgres',
	config: { host: 'db.example.test', port: 5432, database: 'wh', user: 'ro', ssl: 'prefer' },
	has_secret: true,
	allow_writes: false,
	allow_private: false,
	created_at: '2026-09-01T00:00:00Z',
	updated_at: '2026-09-01T00:00:00Z',
};

const inventory: Datasource = {
	...warehouse,
	id: 'd2',
	name: 'inventory',
	kind: 'http',
	config: { base_url: 'https://inventory.example.test', chat_id: '@releases', headers: { Accept: 'application/json' } },
	allow_writes: true,
};

function setup(datasources: Datasource[] = [warehouse, inventory], form: unknown = null, locked = false, gate: unknown = { state: 'ok' }, roles: string[] = ['super_admin']) {
	return render(DatasourcesPage, {
		props: { data: { datasources, locked, gate, user: { roles }, entitlements: licensed }, form } as never,
	});
}

describe('datasources page', () => {
	it('lists every datasource with its kind, secret, write and private flags', () => {
		const { container } = setup();
		expect(container.textContent).toContain('Beta');
		const rows = container.querySelectorAll('tbody tr');
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('Postgres');
		expect(rows[0].textContent).toContain('Stored');
		expect(rows[0].textContent).toContain('read only');
		expect(rows[1].textContent).toContain('HTTP base');
		expect(rows[1].textContent).toContain('allowed');
	});

	it('opens the create drawer with the database fields for the default kind', async () => {
		const { getAllByText, container } = setup([]);
		await fireEvent.click(getAllByText('New datasource')[0]);
		const form = container.querySelector('#datasource-form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/create');
		expect(form.querySelector('[name="host"]')).toBeTruthy();
		expect((form.querySelector('[name="port"]') as HTMLInputElement).value).toBe('5432');
		expect(form.querySelector('[name="password"]')).toBeTruthy();
		expect(form.querySelector('[name="base_url"]')).toBeNull();
		expect(form.querySelector('[name="chat_id"]')).toBeNull();
		expect((form.querySelector('input[name="ssl"]:checked') as HTMLInputElement).value).toBe('require');
	});

	it('offers the TLS modes of the chosen kind and submits the stored one on edit', async () => {
		const { getByLabelText, getByRole, container } = setup();
		await fireEvent.click(getByLabelText('Edit warehouse'));
		const form = container.querySelector('#datasource-form') as HTMLFormElement;
		expect((form.querySelector('input[name="ssl"]:checked') as HTMLInputElement).value).toBe('prefer');
		// Each mode says what it tells the driver, so they are choices with a
		// sentence each rather than a strip of bare words.
		const radios = [...form.querySelectorAll('input[type="radio"][name="ssl"]')] as HTMLInputElement[];
		expect(radios.map((r) => r.value)).toEqual(['require', 'prefer', 'disable']);
		expect(getByRole('radio', { name: /Prefer TLS/ })).toBeTruthy();
		expect(form.textContent).toContain('connects without encryption when it does not');
	});

	it('says on edit that every blank secret keeps the stored ones and any typed one replaces them all', async () => {
		const { getByLabelText, container } = setup();
		await fireEvent.click(getByLabelText('Edit inventory'));
		const rule = container.querySelector('[data-testid="secret-rule"]') as HTMLElement;
		expect(rule.textContent).toContain('Leave every secret field empty to keep');
		expect(rule.textContent).toContain('all stored secrets are replaced');
	});

	it('puts the name rule at the name field when the plugin refused the name', async () => {
		const { getAllByText, container, rerender } = setup();
		await fireEvent.click(getAllByText('New datasource')[0]);
		const rule = 'Start the name with a lower case letter, and use up to 40 lower case letters, digits, dashes and underscores.';
		await rerender({
			data: { datasources: [warehouse, inventory], locked: false, gate: { state: 'ok' }, user: { roles: ['super_admin'] }, entitlements: licensed },
			form: { action: 'save', error: rule, nameError: rule },
		} as never);
		const name = container.querySelector('#ds-name') as HTMLInputElement;
		expect(name.getAttribute('aria-invalid')).toBe('true');
		expect(container.textContent).not.toContain('"ok"');
	});

	it('opens the edit drawer with the stored config and a per-header secret toggle', async () => {
		const { getByLabelText, container } = setup();
		await fireEvent.click(getByLabelText('Edit inventory'));
		const form = container.querySelector('#datasource-form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/update');
		expect((form.querySelector('[name="id"]') as HTMLInputElement).value).toBe('d2');
		expect((form.querySelector('[name="base_url"]') as HTMLInputElement).value).toBe('https://inventory.example.test');
		expect((form.querySelector('[name="chat_id"]') as HTMLInputElement).value).toBe('@releases');
		const keys = [...form.querySelectorAll('[name="header_key"]')].map((el) => (el as HTMLInputElement).value);
		// The plugin never returns a secret header, so only the plain one comes back.
		expect(keys).toEqual(['Accept']);
		const secrets = [...form.querySelectorAll('[name="header_secret"]')].map((el) => (el as HTMLInputElement).value);
		expect(secrets).toEqual(['false']);
	});

	async function chooseAuth(container: HTMLElement, label: string) {
		const value = AUTH_TYPES.find((t) => t.label === label)?.value;
		await fireEvent.click(container.querySelector(`[data-testid="auth-section"] input[name="auth_type"][value="${value}"]`) as HTMLElement);
	}

	it('shows the auth section for the http kind, with the fields and a required secret per type', async () => {
		const { getAllByText, container, getByTestId } = setup([]);
		await fireEvent.click(getAllByText('New datasource')[0]);
		await fireEvent.click(container.querySelector('#ds-kind') as HTMLElement);
		await fireEvent.click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('HTTP base')) as HTMLElement);
		const form = container.querySelector('#datasource-form') as HTMLFormElement;
		expect((form.querySelector('[name="chat_id"]') as HTMLInputElement).value).toBe('');
		const section = getByTestId('auth-section');
		expect(section.textContent).toContain('Authentication');
		expect((form.querySelector('input[name="auth_type"]:checked') as HTMLInputElement).value).toBe('none');
		expect(section.textContent).toContain('No credential beyond the headers');

		await chooseAuth(container, 'Bearer token');
		expect((form.querySelector('input[name="auth_type"]:checked') as HTMLInputElement).value).toBe('bearer');
		const token = form.querySelector('[name="auth_token"]') as HTMLInputElement;
		expect(token.type).toBe('password');
		expect(token.required).toBe(true);
		expect(section.textContent).toContain('Encrypted at rest');

		await chooseAuth(container, 'Basic');
		expect((form.querySelector('[name="auth_user"]') as HTMLInputElement).required).toBe(true);
		expect((form.querySelector('[name="auth_password"]') as HTMLInputElement).required).toBe(true);
		expect(form.querySelector('[name="auth_token"]')).toBeNull();

		await chooseAuth(container, 'OAuth2 client credentials');
		expect((form.querySelector('[name="auth_token_url"]') as HTMLInputElement).required).toBe(true);
		expect((form.querySelector('[name="auth_client_id"]') as HTMLInputElement).required).toBe(true);
		expect((form.querySelector('[name="auth_client_secret"]') as HTMLInputElement).required).toBe(true);
		expect(form.querySelector('[name="auth_scopes"]')).toBeTruthy();
		expect(form.querySelector('[name="auth_audience"]')).toBeTruthy();
	});

	it('prefills the stored scheme on edit, lets its secret stay blank, and requires one after a scheme change', async () => {
		const oauth: Datasource = {
			...inventory,
			id: 'd3',
			name: 'weather',
			has_secret: true,
			config: {
				base_url: 'https://weather.example.test',
				auth: { type: 'oauth2_client_credentials', token_url: 'https://auth.example.test/token', client_id: 'cid', scopes: ['read', 'write'], audience: 'https://api' },
			},
		};
		const { getByLabelText, container, getByTestId } = setup([oauth]);
		await fireEvent.click(getByLabelText('Edit weather'));
		const form = container.querySelector('#datasource-form') as HTMLFormElement;
		expect((form.querySelector('input[name="auth_type"]:checked') as HTMLInputElement).value).toBe('oauth2_client_credentials');
		expect((form.querySelector('[name="auth_token_url"]') as HTMLInputElement).value).toBe('https://auth.example.test/token');
		expect((form.querySelector('[name="auth_client_id"]') as HTMLInputElement).value).toBe('cid');
		expect((form.querySelector('[name="auth_scopes"]') as HTMLInputElement).value).toBe('read write');
		expect((form.querySelector('[name="auth_audience"]') as HTMLInputElement).value).toBe('https://api');
		const secret = form.querySelector('[name="auth_client_secret"]') as HTMLInputElement;
		expect(secret.value).toBe('');
		expect(secret.required).toBe(false);
		expect(getByTestId('auth-section').textContent).toContain('Leave every secret field empty to keep it');

		await chooseAuth(container, 'Bearer token');
		const token = form.querySelector('[name="auth_token"]') as HTMLInputElement;
		expect(token.required).toBe(true);
		expect(getByTestId('auth-section').textContent).toContain('Enter the secret for the new scheme');
	});

	it('requires the secret on edit when the stored datasource holds none for that scheme', async () => {
		// inventory has a secret header but no auth block, so a bearer token is a new secret.
		const { getByLabelText, container, getByTestId } = setup([inventory]);
		await fireEvent.click(getByLabelText('Edit inventory'));
		await chooseAuth(container, 'Bearer token');
		const form = container.querySelector('#datasource-form') as HTMLFormElement;
		expect((form.querySelector('[name="auth_token"]') as HTMLInputElement).required).toBe(true);
		expect(getByTestId('auth-section').textContent).not.toContain('Leave blank');
	});

	it('shows the test result beside the row it was run for', () => {
		const { container } = setup([warehouse, inventory], { testResult: { id: 'd1', ok: true, latency_ms: 8, error: '' } });
		const rows = container.querySelectorAll('tbody tr');
		expect(rows[0].textContent).toContain('connected');
		expect(rows[0].textContent).toContain('8.0 ms');
		expect(rows[1].textContent).toContain('not tested');
	});

	it('shows the error a failed test carried', () => {
		const { container } = setup([warehouse], { testResult: { id: 'd1', ok: false, latency_ms: 0, error: 'connection refused' } });
		expect(container.textContent).toContain('connection refused');
	});

	it('asks before a row posts its delete', async () => {
		const { getByLabelText } = setup();
		const form = getByLabelText('Delete warehouse').closest('form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/delete');
		expect(new FormData(form).get('id')).toBe('d1');
		const cancel = vi.fn();
		await forms.submits.get(form)?.({ cancel });
		expect(forms.confirm).toHaveBeenCalledWith('Delete datasource warehouse?', expect.any(String), { confirmLabel: 'Delete' });
		expect(cancel).toHaveBeenCalled();
	});

	it('shows a failed load as an alert and not as an empty list', () => {
		const { container, queryByText } = setup([], null, false, { state: 'error', message: 'Datasources could not be read from the engine.' });
		expect(container.textContent).toContain('Datasources could not be read from the engine.');
		expect(queryByText('No datasources yet')).toBeNull();
	});

	it('renders the not-enabled state when locked', () => {
		const { getByTestId } = setup([], null, true);
		expect(getByTestId('not-enabled')).toBeTruthy();
	});
});

describe('datasources page when the plugin says they are not enabled', () => {
	function unavailable(datasources: Datasource[] = [], form: unknown = null) {
		return render(DatasourcesPage, {
			props: { data: { datasources, available: false, locked: false, gate: { state: 'ok' }, user: { roles: ['super_admin'] }, entitlements: licensed }, form } as never,
		});
	}

	it('says so in place of the empty state and disables create', () => {
		const { getAllByTestId, getAllByText, queryByText } = unavailable();
		const notice = getAllByTestId('not-enabled');
		expect(notice).toHaveLength(1);
		expect(notice[0].textContent).toContain('Datasources');
		expect(notice[0].textContent).toContain('Not enabled on this engine.');
		expect(queryByText('No datasources yet')).toBeNull();
		const create = getAllByText('New datasource')[0].closest('button') as HTMLButtonElement;
		expect(create.disabled).toBe(true);
	});

	// The plugin refuses an edit and a test as it refuses a create, so neither
	// stays live beside a create that is disabled.
	it('disables edit and test on a stored row, and leaves delete', () => {
		const { getByLabelText } = unavailable([warehouse]);
		expect((getByLabelText('Edit warehouse') as HTMLButtonElement).disabled).toBe(true);
		expect((getByLabelText('Test warehouse') as HTMLButtonElement).disabled).toBe(true);
		expect((getByLabelText('Delete warehouse') as HTMLButtonElement).disabled).toBe(false);
	});

	it('lists the stored rows and says it once, in the header', () => {
		const { getAllByTestId, getByText } = unavailable([warehouse]);
		expect(getByText('warehouse')).toBeTruthy();
		expect(getAllByTestId('not-enabled')).toHaveLength(1);
	});

	it('renders a refused write as not enabled, naming no capability', () => {
		const { container } = unavailable([], { action: 'test', error: 'Datasources are not enabled on this engine.', refused: true });
		expect(container.textContent).toContain('Datasources are not enabled on this engine.');
		expect(container.textContent).not.toMatch(/capability|license/i);
	});

	it('keeps the ordinary empty state and an enabled create when they are enabled', () => {
		const { queryByTestId, getAllByText, getByText } = setup([]);
		expect(queryByTestId('not-enabled')).toBeNull();
		expect(getByText('No datasources yet')).toBeTruthy();
		const create = getAllByText('New datasource')[0].closest('button') as HTMLButtonElement;
		expect(create.disabled).toBe(false);
	});
});

// A chat channel is a datasource and nothing else: the webhook or the bot API
// this page already stores.
describe('datasources page chat channels', () => {
	it('points chat at the flow node and its template', () => {
		const text = (setup().container.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toContain('chat.notify');
		expect(text).toContain('chat-notify');
		expect(text).toContain('Slack, Discord or Telegram');
	});

	it('warns that EVENT_BUS never names a chat service', () => {
		const text = (setup().container.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toContain('EVENT_BUS');
		expect(text).toContain('the engine from starting');
	});
});

describe('datasources page and the role of the reader', () => {
	it('says the role cannot read datasources and offers nothing to create', () => {
		const { container, queryByText } = setup([], null, false, { state: 'forbidden' }, ['editor']);
		expect(container.textContent).toContain('Your role cannot open datasources.');
		expect(container.textContent).not.toContain('Reload');
		expect(queryByText('New datasource')).toBeNull();
	});

	// The plugin takes either grant from a super admin only.
	it('shows an admin the write and private grants fixed, with the reason', async () => {
		const { getByLabelText, getAllByText } = setup(undefined, null, false, { state: 'ok' }, ['admin']);
		await fireEvent.click(getAllByText('New datasource')[0]);
		expect((getByLabelText('Allow writes') as HTMLButtonElement).disabled).toBe(true);
		expect((getByLabelText('Allow private addresses') as HTMLButtonElement).disabled).toBe(true);
		expect(document.body.textContent).toContain('Only a super admin can change this.');
	});

	it('leaves both grants to a super admin', async () => {
		const { getByLabelText, getAllByText } = setup();
		await fireEvent.click(getAllByText('New datasource')[0]);
		expect((getByLabelText('Allow writes') as HTMLButtonElement).disabled).toBe(false);
		expect(document.body.textContent).not.toContain('Only a super admin can change this.');
	});
});

// The drawer and the row actions share one form result.
describe('where a datasource failure shows', () => {
	it('shows a failed delete on the page and not in the drawer opened after it', async () => {
		const { container, getAllByText } = setup([warehouse], { action: 'delete', error: 'Could not delete the datasource. Try again.' });
		expect(container.textContent).toContain('Could not delete the datasource. Try again.');

		await fireEvent.click(getAllByText('New datasource')[0]);
		const drawer = container.ownerDocument.querySelector('#datasource-form') as HTMLElement;
		expect(drawer.textContent).not.toContain('Could not delete the datasource. Try again.');
	});

	it('shows a failed save inside the open drawer and not on the page behind it', async () => {
		const { container, getAllByText, rerender } = setup([warehouse]);
		await fireEvent.click(getAllByText('New datasource')[0]);
		await rerender({
			data: { datasources: [warehouse], locked: false, gate: { state: 'ok' }, user: { roles: ['super_admin'] }, entitlements: licensed },
			form: { action: 'save', error: 'Enter a name.' },
		} as never);
		const drawer = container.ownerDocument.querySelector('#datasource-form') as HTMLElement;
		expect(drawer.textContent).toContain('Enter a name.');
		// Once, in the drawer, and not again on the page behind it.
		expect(document.body.textContent?.split('Enter a name.').length).toBe(2);
	});
});

// The plugin refuses an admin who moves the target of a granted row.
describe('the target of a granted datasource', () => {
	const granted: Datasource = { ...warehouse, id: 'd9', name: 'ledger', allow_private: true };

	it('is fixed for an admin, with the reason, and still posts the stored values', async () => {
		const { container, getByLabelText } = setup([granted], null, false, { state: 'ok' }, ['admin']);
		await fireEvent.click(getByLabelText('Edit ledger'));
		const form = container.querySelector('#datasource-form') as HTMLFormElement;
		expect((form.querySelector('#ds-host') as HTMLInputElement).disabled).toBe(true);
		expect((form.querySelector('#ds-port') as HTMLInputElement).disabled).toBe(true);
		expect((form.querySelector('input[type="hidden"][name="host"]') as HTMLInputElement).value).toBe('db.example.test');
		expect((form.querySelector('input[type="hidden"][name="port"]') as HTMLInputElement).value).toBe('5432');
		expect(form.textContent).toContain('Only a super admin can change this.');
		// The database and the user are not the target, so they stay open.
		expect((form.querySelector('[name="database"]') as HTMLInputElement).disabled).toBe(false);
	});

	it('stays open on a row with no grant', async () => {
		const { container, getByLabelText } = setup([warehouse], null, false, { state: 'ok' }, ['admin']);
		await fireEvent.click(getByLabelText('Edit warehouse'));
		expect((container.querySelector('#ds-host') as HTMLInputElement).disabled).toBe(false);
	});

	it('stays open for a super admin', async () => {
		const { container, getByLabelText } = setup([granted]);
		await fireEvent.click(getByLabelText('Edit ledger'));
		expect((container.querySelector('#ds-host') as HTMLInputElement).disabled).toBe(false);
	});

	it('fixes the base URL of a granted http row for an admin', async () => {
		const { container, getByLabelText } = setup([inventory], null, false, { state: 'ok' }, ['admin']);
		await fireEvent.click(getByLabelText('Edit inventory'));
		expect((container.querySelector('#ds-base-url') as HTMLInputElement).disabled).toBe(true);
		expect((container.querySelector('input[type="hidden"][name="base_url"]') as HTMLInputElement).value).toBe('https://inventory.example.test');
	});
});

describe('the header rows of an http datasource', () => {
	function posted(form: HTMLFormElement): [string, string, string][] {
		const d = new FormData(form);
		const keys = d.getAll('header_key').map(String);
		const values = d.getAll('header_value').map(String);
		const secrets = d.getAll('header_secret').map(String);
		return keys.map((k, i) => [k, values[i], secrets[i]]);
	}

	async function addHeader(container: HTMLElement, getByText: (t: string) => HTMLElement, key: string, value: string, secret: boolean) {
		await fireEvent.click(getByText('Add header'));
		const form = container.querySelector('#datasource-form') as HTMLFormElement;
		const rows = form.querySelectorAll('fieldset > div.flex.items-end');
		const row = rows[rows.length - 1] as HTMLElement;
		await fireEvent.input(row.querySelector('[name="header_key"]') as HTMLInputElement, { target: { value: key } });
		if (secret) await fireEvent.click(row.querySelector('[role="switch"], input[type="checkbox"]') as HTMLElement);
		await fireEvent.input(row.querySelector('[name="header_value"]') as HTMLInputElement, { target: { value } });
	}

	// A row's secret lived in the field and not in the row, and rows were
	// keyed by position, so removing one handed its secret to the next.
	it('keeps each secret with its own header when a row above is removed', async () => {
		const { getByLabelText, getByText, container } = setup();
		await fireEvent.click(getByLabelText('Edit inventory'));
		await addHeader(container, getByText, 'X-One', 'secret-one', true);
		await addHeader(container, getByText, 'X-Two', 'secret-two', true);
		const form = container.querySelector('#datasource-form') as HTMLFormElement;
		expect(posted(form)).toEqual([
			['Accept', 'application/json', 'false'],
			['X-One', 'secret-one', 'true'],
			['X-Two', 'secret-two', 'true'],
		]);
		await fireEvent.click(getByLabelText('Remove header X-One'));
		expect(posted(form)).toEqual([
			['Accept', 'application/json', 'false'],
			['X-Two', 'secret-two', 'true'],
		]);
	});

	it('keeps the typed value when Secret is turned on, and when it is turned off again', async () => {
		const { getByLabelText, getByText, container } = setup();
		await fireEvent.click(getByLabelText('Edit inventory'));
		await addHeader(container, getByText, 'X-Key', 'typed-first', false);
		const form = container.querySelector('#datasource-form') as HTMLFormElement;
		const rows = form.querySelectorAll('fieldset > div.flex.items-end');
		const row = rows[rows.length - 1] as HTMLElement;
		const toggle = () => row.querySelector('[role="switch"], input[type="checkbox"]') as HTMLElement;
		await fireEvent.click(toggle());
		expect(posted(form)[1]).toEqual(['X-Key', 'typed-first', 'true']);
		await fireEvent.click(toggle());
		expect(posted(form)[1]).toEqual(['X-Key', 'typed-first', 'false']);
	});
});

describe('the link that enables datasources', () => {
	const away = 'https://shop.example.com/pricing?skus=example-pro';

	it('names a link to an add-on by what it opens and opens it in a new tab, on the page and in the drawer', async () => {
		upgrade.link = { href: away, label: 'Manage the license' };
		const refusal = { action: 'save', error: 'Datasources are not enabled on this engine.', refused: true };
		const { getAllByText, container, rerender } = setup([]);
		await fireEvent.click(getAllByText('New datasource')[0]);
		await rerender({ data: { datasources: [], locked: false, gate: { state: 'ok' }, user: { roles: ['super_admin'] }, entitlements: licensed }, form: refusal } as never);
		const inDrawer = container.ownerDocument.querySelector(`#datasource-form a[href="${away}"]`) as HTMLAnchorElement;
		expect(inDrawer.textContent).toBe('View the add-on');
		expect(inDrawer.getAttribute('target')).toBe('_blank');
		expect(inDrawer.getAttribute('rel')).toBe('noopener noreferrer');
		expect(inDrawer.classList.contains('hit-area') && inDrawer.classList.contains('relative')).toBe(true);
		cleanup();
		setup([], { ...refusal, action: 'delete' });
		const onPage = document.body.querySelector(`a[href="${away}"]`) as HTMLAnchorElement;
		expect(onPage.textContent).toBe('View the add-on');
		expect(onPage.getAttribute('target')).toBe('_blank');
		expect(onPage.getAttribute('rel')).toBe('noopener noreferrer');
	});

	it('keeps a link on this console in the same tab', () => {
		upgrade.link = { href: '/admin/settings/license', label: 'Manage the license' };
		setup([], { action: 'delete', error: 'Datasources are not enabled on this engine.', refused: true });
		const a = document.body.querySelector('a[href="/admin/settings/license"]') as HTMLAnchorElement;
		expect(a.textContent).toBe('Manage the license');
		expect(a.getAttribute('target')).toBeNull();
	});
});

describe('a stored header turned secret', () => {
	// The plugin replaces the stored secrets whole, so a header carried into
	// the secret half replaces the secret headers nobody touched.
	it('carries the value and says that turning Secret on replaces the stored secrets', async () => {
		const { getByLabelText, container } = setup();
		await fireEvent.click(getByLabelText('Edit inventory'));
		const form = container.querySelector('#datasource-form') as HTMLFormElement;
		const row = form.querySelector('fieldset > div.flex.items-end') as HTMLElement;
		await fireEvent.click(row.querySelector('[role="switch"], input[type="checkbox"]') as HTMLElement);
		const d = new FormData(form);
		expect([d.getAll('header_key'), d.getAll('header_value'), d.getAll('header_secret')]).toEqual([['Accept'], ['application/json'], ['true']]);
		const rule = container.querySelector('[data-testid="secret-rule"]') as HTMLElement;
		expect(rule.textContent).toContain('If you type a secret or turn on Secret for a header, all stored secrets are replaced');
	});
});
