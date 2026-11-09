import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { flowLoadOutcome } from '$lib/server/flow-load';
import { couldNotLoad } from '$lib/outage';
import { GATE_OK, gateOf, type Gate } from '$lib/api/gate';
import { flowClient } from '$lib/server/flow-client';
import { checked } from '$lib/checkbox';
import {
	createDatasource,
	deleteDatasource,
	listDatasources,
	testDatasource,
	updateDatasource,
	validationErrors,
	type Datasource,
	type DatasourceBody,
	type DatasourceKind,
} from '$lib/api/flows';
import { SSL_MODES, authFromForm } from '$lib/flow/datasources';
import { asked } from '$lib/server/asked';

const KINDS: DatasourceKind[] = ['postgres', 'mysql', 'mssql', 'http', 'google_sheets'];

export const load: PageServerLoad = async (event) => {
	const { cookies, url } = event;
	const client = authedClient(event);
	let datasources: Datasource[] = [];
	// The list says whether this instance may use datasources. Without that
	// it is empty by design and a create is refused, and the page has to say
	// which of the two empties this is. A failed read leaves it enabled, so
	// the banner is what the page draws, not a locked state.
	let available = true;
	let locked = false;
	// Why the list could not be read. The plugin answers it to an admin only,
	// so a reader below admin sees the role refusal and nothing to create.
	let gate: Gate = GATE_OK;
	try {
		({ rows: datasources, enabled: available } = await listDatasources(client));
	} catch (err) {
		({ locked } = flowLoadOutcome(err, { cookies, url }, 'datasources'));
		if (!locked) gate = gateOf(err, couldNotLoad('datasources'));
	}
	return { datasources, available, locked, gate };
};

/**
 * A write the plugin refused because this instance does not enable
 * datasources. A stored one can still be read and deleted, so the refusal
 * names the feature and leaves the rest of the page as it was.
 */
function isRefused(err: unknown): boolean {
	return err instanceof ApiError && err.status === 402;
}

const REFUSED = { error: 'Datasources are not enabled on this engine.', refused: true };

/** The plugin's name rule, in words a reader can act on. */
const NAME_RULE = 'Start the name with a lower case letter, and use up to 40 lower case letters, digits, dashes and underscores.';

/**
 * A save the plugin refused as invalid. The 422 body is a list of problems
 * with no error key, so the client hands over the JSON text. Each problem is
 * read out of it: the name's at the name field, the rest above the form in
 * the plugin's own words, which it writes for this form. Null for any other
 * failure.
 */
function invalidFailure(err: unknown) {
	if (!(err instanceof ApiError) || err.status !== 422) return null;
	const errors = validationErrors(err.message);
	const nameError = errors.some((e) => e.path === '/name') ? NAME_RULE : '';
	const rest = errors.filter((e) => e.path !== '/name').map((e) => e.message);
	const error = [nameError, ...rest].filter(Boolean).join(' ') || 'Check the datasource settings and try again.';
	return fail(422, { action: 'save', error, nameError });
}

const text = (data: FormData, key: string): string => String(data.get(key) ?? '').trim();

/**
 * The body for one kind, split into what the engine stores in the clear and
 * what it encrypts. The plugin replaces the stored secret whole whenever a
 * body carries one, so the secret is sent only when some part of it was
 * typed. Every blank secret field on an update keeps every stored secret.
 */
function bodyFrom(data: FormData): DatasourceBody | string {
	const name = text(data, 'name');
	const kind = text(data, 'kind') as DatasourceKind;
	if (!name) return 'Enter a name.';
	if (!KINDS.includes(kind)) return 'Choose a kind.';

	const config: Record<string, unknown> = {};
	const secret: Record<string, unknown> = {};

	if (kind === 'postgres' || kind === 'mysql' || kind === 'mssql') {
		config.host = text(data, 'host');
		config.port = Number(text(data, 'port')) || undefined;
		config.database = text(data, 'database');
		config.user = text(data, 'user');
		const modes = SSL_MODES[kind].map((m) => m.value);
		const ssl = text(data, 'ssl') || modes[0];
		if (!modes.includes(ssl)) return `Choose one of ${modes.join(', ')} for TLS on ${kind}.`;
		config.ssl = ssl;
		const password = text(data, 'password');
		if (password) secret.password = password;
		if (!config.host || !config.database) return 'Enter a host and a database.';
	} else if (kind === 'http') {
		config.base_url = text(data, 'base_url');
		if (!config.base_url) return 'Enter a base URL.';
		const chatId = text(data, 'chat_id');
		if (chatId) config.chat_id = chatId;
		const keys = data.getAll('header_key').map(String);
		const values = data.getAll('header_value').map(String);
		const secrets = data.getAll('header_secret').map(String);
		const plain: Record<string, string> = {};
		const hidden: Record<string, string> = {};
		keys.forEach((k, i) => {
			const key = k.trim();
			if (!key) return;
			const value = values[i] ?? '';
			if (secrets[i] === 'true') {
				if (value) hidden[key] = value;
			} else {
				plain[key] = value;
			}
		});
		config.headers = plain;
		if (Object.keys(hidden).length > 0) secret.headers = hidden;
		const auth = authFromForm(data);
		if (typeof auth === 'string') return auth;
		if (auth.auth) config.auth = auth.auth;
		Object.assign(secret, auth.secret ?? {});
	} else {
		const apiBase = text(data, 'api_base');
		if (apiBase) config.api_base = apiBase;
		const json = text(data, 'service_account_json');
		if (json) secret.service_account_json = json;
	}

	return {
		name,
		kind,
		config,
		secret: Object.keys(secret).length > 0 ? secret : undefined,
		allow_writes: checked(data, 'allow_writes'),
		allow_private: checked(data, 'allow_private'),
	};
}

// Each failure names its action. The drawer shows a save's, and the page
// shows a delete's or a test's.
export const actions: Actions = {
	create: async (event) => {
		await requireUser(event);
		const client = flowClient(event);
		const body = bodyFrom(await event.request.formData());
		if (typeof body === 'string') return fail(400, { action: 'save', error: body });
		try {
			await createDatasource(client, body);
		} catch (err) {
			if (isRefused(err)) return fail(402, { ...REFUSED, action: 'save' });
			return invalidFailure(err) ?? tagged('save', actionFailure(err, 'Could not create the datasource. Try again.'));
		}
	},

	update: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const id = text(data, 'id');
		const body = bodyFrom(data);
		if (typeof body === 'string') return fail(400, { action: 'save', error: body });
		try {
			await updateDatasource(client, id, body);
		} catch (err) {
			if (isRefused(err)) return fail(402, { ...REFUSED, action: 'save' });
			return invalidFailure(err) ?? tagged('save', actionFailure(err, 'Could not save the datasource. Try again.'));
		}
	},

	delete: asked(
		{
			question: 'Delete this datasource?',
			detail: 'Flows that use it fail at that node until you create it again.',
			label: 'Delete',
		},
		async (event) => {
			await requireUser(event);
			const client = authedClient(event);
			const data = await event.request.formData();
			try {
				await deleteDatasource(client, text(data, 'id'));
			} catch (err) {
				return tagged('delete', actionFailure(err, 'Could not delete the datasource. Try again.'));
			}
		},
	),

	test: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const id = text(data, 'id');
		try {
			const result = await testDatasource(client, id);
			return { testResult: { id, ...result } };
		} catch (err) {
			if (isRefused(err)) return fail(402, { ...REFUSED, action: 'test' });
			return tagged('test', actionFailure(err, 'Could not test the datasource. Try again.'));
		}
	},
};
