import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning, runs } from '$lib/plugins';
import { describeRefusal } from '$lib/api/admin-tokens';
import { isOutage, section, type Section } from '$lib/api/gate';
import { getSchemas } from '@lyeve-labs/client-rest';
import { listSchemaNames } from '$lib/api/search-settings';
import { applySchemaPreset, readSchemaPresets } from '$lib/api/schema-preset-catalog';
import {
	FORMS_PRESET,
	FORM_SUBMISSIONS,
	formSchemaOptions,
	readFlowTargets,
	type FlowTarget,
	type FormSchemaOption,
} from '$lib/api/form-destinations';
import { pageOf, pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { normalizeUserCode } from '$lib/device-login';
import {
	LIFETIMES,
	SAID,
	WITHHELD,
	approveRequest,
	connectionsGate,
	declineRequest,
	getRequest,
	getSettings,
	listConnections,
	refusalCode,
	refusedField,
	revokeAllConnections,
	revokeConnection,
	saveSettings,
	showable,
	type ApproveStepUp,
	type Connection,
	type ConnectionRequest,
	type ConnectionsGate,
	type Settings,
	type SettingsPatch,
} from '$lib/api/connected-editors';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** The roles that manage every connection of the tenant and its settings. */
const OWNER_ROLES = ['admin', 'super_admin'];

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);
	const owner = (user?.roles ?? []).some((r) => OWNER_ROLES.includes(r));
	const base = {
		limit,
		offset,
		owner,
		email: user?.email ?? '',
		roles: user?.roles ?? [],
		// A super admin acts in one tenant at a time, and an approval binds that one.
		tenant: runs(plugins, PLUGIN.multitenant) ? (user?.tenant_id ?? '') : '',
		// The builder links here to open the drawer. The code never travels in the URL.
		openApprove: event.url.searchParams.has('approve'),
	};

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.builder)) {
		return {
			...base,
			connections: [] as Connection[],
			total: null as number | null,
			hasMore: false,
			gate: { state: 'absent' } as ConnectionsGate,
			mfaEnrolled: false,
			settings: null as Section<Settings> | null,
			schemas: [] as string[],
			schemasFailed: false,
			formSchemas: [] as FormSchemaOption[],
			flows: null as Section<FlowTarget[]> | null,
			formsPreset: false,
		};
	}

	const client = authedClient(event);
	// Which confirmation the approval will ask for. An unreadable status asks
	// for the password, and an account that has MFA is told so by the refusal.
	const mfa = client
		.get<{ enabled: boolean }>('/api/admin/mfa/status')
		.then((s) => s.enabled === true)
		.catch(() => false);
	// The settings route answers owners only, so nobody else asks and no 403
	// from it reaches the page.
	const settings = owner ? section(getSettings(client), 'Could not load the builder settings.') : null;
	// A failed schema read is said as a failure, never offered as no schemas.
	// Forms are offered only the types the delivery API does not serve, which
	// the plugin refuses because anyone could read a visitor's post there.
	const schemas = owner
		? getSchemas(client).then(
				(rows) => ({
					names: rows.map((s) => s.name).filter(Boolean).sort(),
					forms: rows
						.filter((s) => (s as { public_delivery?: unknown }).public_delivery !== true)
						.map((s) => ({ name: s.name, label: s.display_name || s.name })),
					failed: false,
				}),
				() => ({ names: [] as string[], forms: [] as FormSchemaOption[], failed: true }),
			)
		: Promise.resolve({ names: [] as string[], forms: [] as FormSchemaOption[], failed: false });
	// Without the flow plugin no flow can start, so forms send only to content types.
	const flows = owner && runs(plugins, PLUGIN.flow) ? section(readFlowTargets(client), 'Could not load flows.') : null;
	// A catalog that cannot be read offers no preset, and the card links the schema builder instead.
	const formsPreset =
		owner && runs(plugins, PLUGIN.schema)
			? readSchemaPresets(client).then(
					(c) => c.presets.some((p) => p.id === FORMS_PRESET),
					() => false,
				)
			: Promise.resolve(false);

	let connections: Connection[] = [];
	let total: number | null = null;
	let hasMore = false;
	let gate: ConnectionsGate = { state: 'ok' };
	try {
		const page = pageOf(await listConnections(client, limit, offset), limit, offset);
		connections = page.rows;
		total = page.total;
		hasMore = page.hasMore;
	} catch (err) {
		gate = connectionsGate(err);
	}
	if (gate.state === 'ok') {
		const back = pastEndOffset(connections.length, limit, offset, total);
		if (back !== null) redirect(307, withOffset(event.url, back));
	}

	const schemaList = await schemas;
	return {
		...base,
		connections,
		total,
		hasMore,
		gate,
		mfaEnrolled: await mfa,
		settings: settings ? await settings : null,
		schemas: showable(schemaList.names),
		schemasFailed: schemaList.failed,
		formSchemas: formSchemaOptions(schemaList.forms.filter((s) => showable([s.name]).length > 0)),
		flows: flows ? await flows : null,
		formsPreset: await formsPreset,
	};
};

/**
 * The sentence for a refusal outside the cases a page names. A 4xx that
 * carries the engine's code shows the engine's sentence. Anything else gets
 * the page's own, so no transport text reaches it.
 */
function refusalSentence(err: unknown, fallback: string): string {
	if (err instanceof ApiError && err.status >= 400 && err.status < 500 && refusalCode(err) && err.message.trim()) {
		return err.message;
	}
	return fallback;
}

/** Whether a request whose code ran out at `expiresAt` has run out by now. */
function ranOut(expiresAt: string): boolean {
	const at = Date.parse(expiresAt);
	return !Number.isNaN(at) && at <= Date.now();
}

/** The drawer's answer for a code the engine does not hold: unknown, or one that ran out while it was open. */
function missing(code: string, expiresAt: string) {
	return ranOut(expiresAt)
		? fail(404, { drawer: { code, expired: true } })
		: fail(404, { drawer: { code, codeError: SAID.unknown } });
}

/** Reads the request again after a refusal that changed it, so the drawer shows what the engine holds now. */
async function relook(client: ReturnType<typeof authedClient>, code: string): Promise<ConnectionRequest | null> {
	try {
		return await getRequest(client, code);
	} catch {
		return null;
	}
}

/** The confirmation the approve form carries, or the field to fill in. */
function stepUpOf(form: FormData): { step: 'password' | 'mfa_code'; stepUp?: ApproveStepUp } {
	if (form.get('step') === 'mfa_code') {
		const code = String(form.get('mfa_code') ?? '').trim();
		return code ? { step: 'mfa_code', stepUp: { mfa_code: code } } : { step: 'mfa_code' };
	}
	const password = String(form.get('password') ?? '');
	return password ? { step: 'password', stepUp: { password } } : { step: 'password' };
}

/**
 * Where a refused confirmation lands: the field, in the admin's words when it
 * has them and in the engine's otherwise, and which factor to ask for next.
 * The engine names the factor an account must use when the wrong one came.
 */
function stepUpRefusal(e: ApiError, step: 'password' | 'mfa_code') {
	const r = describeRefusal(e.status, e.message, step);
	const field = r.fields.password ?? r.fields.mfa_code ?? (e.message.trim() || SAID.stepUpMissing);
	let needsMfa = step === 'mfa_code';
	if (/MFA enrolled/i.test(e.message)) needsMfa = true;
	if (/no authenticator/i.test(e.message)) needsMfa = false;
	return { field, needsMfa };
}

function setting(form: FormData): { field: string; patch?: SettingsPatch; error?: string } {
	const field = String(form.get('field') ?? '');
	switch (field) {
		case 'allowed': {
			const v = String(form.get('allowed') ?? '');
			if (v !== 'on' && v !== 'off') return { field, error: 'Choose On or Off.' };
			return { field, patch: { allowed: v === 'on' } };
		}
		// Everything but the switch saves together. A refusal names the field it lands on.
		case 'limits': {
			const lifetime = Number(form.get('lifetime_days'));
			if (!(LIFETIMES as readonly number[]).includes(lifetime)) {
				return { field: 'lifetime_days', error: 'Choose 30, 90 or 180 days.' };
			}
			const raw = String(form.get('writes_per_minute') ?? '').trim();
			const writes = Number(raw);
			if (!raw || !Number.isInteger(writes)) {
				return { field: 'writes_per_minute', error: 'Enter a whole number of writes a minute.' };
			}
			const patch: SettingsPatch = { lifetime_days: lifetime, writes_per_minute: writes };
			// A form whose schema list failed to load offered none, and must not clear them.
			if (form.get('schemas_offered')) patch.show_schemas = form.getAll('show_schemas').map(String).filter(Boolean);
			return { field, patch };
		}
		// Where forms may send. Only a list that loaded is saved, so a list that failed to load clears nothing.
		case 'forms': {
			const patch: SettingsPatch = {};
			if (form.get('form_schemas_offered')) patch.form_schemas = form.getAll('form_schemas').map(String).filter(Boolean);
			if (form.get('form_flows_offered')) patch.form_flows = form.getAll('form_flows').map(String).filter(Boolean);
			if (Object.keys(patch).length === 0) {
				return { field, error: 'This form is missing its setting. Reload the page and try again.' };
			}
			return { field, patch };
		}
		default:
			return { field: '', error: 'This form is missing its setting. Reload the page and try again.' };
	}
}

// No requireRole here. Every route reads the person from the session and
// answers for itself: anyone at editor or above approves and sees their own
// connections, owners see all of them and the settings.
export const actions: Actions = {
	lookup: async (event) => {
		const form = await event.request.formData();
		const raw = String(form.get('code') ?? '');
		const code = normalizeUserCode(raw);
		if (!code) return fail(400, { drawer: { code: raw, codeError: SAID.malformed } });
		try {
			return { drawer: { code, request: await getRequest(authedClient(event), code) } };
		} catch (e) {
			if (refusalCode(e) === 'request_unknown') return fail(404, { drawer: { code, codeError: SAID.unknown } });
			if (refusalCode(e) === WITHHELD) return fail(403, { drawer: { code, withheld: true } });
			if (isOutage(e)) return fail(503, { drawer: { code, codeError: SAID.lookupOutage } });
			return fail(e instanceof ApiError ? e.status : 400, {
				drawer: { code, codeError: refusalSentence(e, 'Could not load this request. Try again.') },
			});
		}
	},

	approve: async (event) => {
		const form = await event.request.formData();
		const code = normalizeUserCode(String(form.get('code') ?? ''));
		if (!code) return fail(400, { drawer: { code: String(form.get('code') ?? ''), codeError: SAID.malformed } });
		const expiresAt = String(form.get('code_expires_at') ?? '');
		const fingerprint = String(form.get('fingerprint') ?? '');
		const lifetime = Number(form.get('lifetime_days'));
		const step = stepUpOf(form);
		if (!step.stepUp) {
			return fail(400, { drawer: { code, stepUp: { field: SAID.stepUpMissing, needsMfa: step.step === 'mfa_code' } } });
		}
		const client = authedClient(event);
		try {
			const out = await approveRequest(client, code, { fingerprint, lifetime_days: lifetime, ...step.stepUp });
			return { approved: { expires_at: out.expires_at } };
		} catch (e) {
			const reason = refusalCode(e);
			if (e instanceof ApiError) {
				switch (reason) {
					case 'step_up_required':
						return fail(403, { drawer: { code, stepUp: { field: SAID.stepUpMissing, needsMfa: step.step === 'mfa_code' } } });
					case 'step_up_refused':
						return fail(e.status, { drawer: { code, stepUp: stepUpRefusal(e, step.step) } });
					case 'approval_unavailable':
						return fail(503, { drawer: { code, approvalUnavailable: true } });
					case 'check_unavailable':
						return fail(503, { drawer: { code, checkUnavailable: true } });
					case 'request_unknown':
						return missing(code, expiresAt);
					case 'request_decided':
						return fail(409, { drawer: { code, decided: true } });
					case 'key_changed':
						return fail(409, { drawer: { code, keyChanged: true, request: await relook(client, code) } });
					case 'lifetime_invalid':
						return fail(422, { drawer: { code, lifetimeChanged: true, request: await relook(client, code) } });
					case WITHHELD:
						return fail(403, { drawer: { code, withheld: true } });
				}
			}
			if (isOutage(e)) return fail(503, { drawer: { code, error: SAID.approveOutage } });
			return fail(e instanceof ApiError ? e.status : 400, {
				drawer: { code, error: refusalSentence(e, 'Could not approve the connection. Try again.') },
			});
		}
	},

	decline: async (event) => {
		const form = await event.request.formData();
		const code = normalizeUserCode(String(form.get('code') ?? ''));
		if (!code) return fail(400, { drawer: { code: String(form.get('code') ?? ''), codeError: SAID.malformed } });
		try {
			await declineRequest(authedClient(event), code);
			return { declined: true };
		} catch (e) {
			const reason = refusalCode(e);
			if (reason === 'request_unknown') return missing(code, String(form.get('code_expires_at') ?? ''));
			if (reason === 'request_decided') return fail(409, { drawer: { code, decided: true } });
			if (reason === WITHHELD) return fail(403, { drawer: { code, withheld: true } });
			if (isOutage(e)) return fail(503, { drawer: { code, error: SAID.declineOutage } });
			return fail(e instanceof ApiError ? e.status : 400, {
				drawer: { code, error: refusalSentence(e, 'Could not decline the request. Try again.') },
			});
		}
	},

	revoke: async (event) => {
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		const person = String(form.get('person') ?? '');
		if (!id) return fail(400, { revokeError: 'This form is missing its connection. Reload the page and try again.' });
		try {
			await revokeConnection(authedClient(event), id);
		} catch (e) {
			if (refusalCode(e) === WITHHELD) return fail(403, { revokeError: SAID.withheld });
			if (isOutage(e)) return fail(503, { revokeError: SAID.revokeOutage });
			return fail(e instanceof ApiError ? e.status : 400, {
				revokeError: refusalSentence(e, 'Could not revoke the connection. Try again.'),
			});
		}
		return { revoked: person };
	},

	revokeAll: async (event) => {
		try {
			const out = await revokeAllConnections(authedClient(event));
			return { revokedAll: out.revoked };
		} catch (e) {
			return fail(e instanceof ApiError ? e.status : 503, { revokeAllFailed: true });
		}
	},

	// Applies the schema plugin's forms preset, unless its submissions type
	// exists already, and lets forms send to that type.
	formsPreset: async (event) => {
		const client = authedClient(event);
		try {
			const [names, current] = await Promise.all([listSchemaNames(client), getSettings(client)]);
			let created = false;
			if (!names.includes(FORM_SUBMISSIONS)) {
				try {
					await applySchemaPreset(client, FORMS_PRESET);
					created = true;
				} catch (e) {
					if (e instanceof ApiError && e.status === 404) return fail(404, { presetMissing: true });
					throw e;
				}
			}
			const allowed = current.form_schemas ?? [];
			const settings = allowed.includes(FORM_SUBMISSIONS)
				? current
				: await saveSettings(client, { form_schemas: [...allowed, FORM_SUBMISSIONS] });
			return { presetApplied: { created, settings } };
		} catch (e) {
			if (isOutage(e)) return fail(503, { presetError: SAID.settingOutage });
			return fail(e instanceof ApiError ? e.status : 400, {
				presetError: refusalSentence(e, 'Could not set up form submissions. Try again.'),
			});
		}
	},

	setting: async (event) => {
		const form = await event.request.formData();
		const { field, patch, error } = setting(form);
		if (!patch) return fail(400, { settingError: { field, message: error ?? '' } });
		try {
			return { saved: { field, settings: await saveSettings(authedClient(event), patch) } };
		} catch (e) {
			if (refusalCode(e) === 'settings_invalid') {
				return fail(422, { settingError: { field: refusedField(e) || field, message: (e as ApiError).message } });
			}
			if (isOutage(e)) return fail(503, { settingError: { field, message: SAID.settingOutage } });
			return fail(e instanceof ApiError ? e.status : 400, {
				settingError: { field, message: refusalSentence(e, 'Could not save the setting. Try again.') },
			});
		}
	},
};
