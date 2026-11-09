import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning, runs } from '$lib/plugins';
import { forbiddenText, gateOf, GATE_OK, isOutage, section, type Gate, type Section } from '$lib/api/gate';
import { bodyString, errorCodeOf } from '$lib/api/limits';
import type { HttpClient } from '@lyeve-labs/client';
import { getSchemas } from '@lyeve-labs/client-rest';
import { applySchemaPreset, readSchemaPresets } from '$lib/api/schema-preset-catalog';
import {
	FORMS_PRESET,
	FORMS_TYPE,
	FORMS_TYPE_TAKEN,
	FORM_SUBMISSIONS,
	SUBMISSIONS_PUBLIC,
	formSchemaOptions,
	readFlowTargets,
	submissionsState,
	type FlowTargets,
	type FormSchemaOption,
	type FormSchemaRow,
	type SubmissionsState,
} from '$lib/api/form-destinations';
import {
	LIFETIMES,
	SAID,
	WITHHELD,
	getSettings,
	saveSettings,
	showable,
	type ConnectionsGate,
	type Settings,
	type SettingsPatch,
} from '$lib/api/connected-editors';
import { OWNER_ROLES, isOwner, refusalSentence } from '../shared.server';

/** Every content type with what the form settings need of it. */
async function formSchemaRows(client: HttpClient): Promise<FormSchemaRow[]> {
	const rows = await getSchemas(client);
	return rows
		.filter((s) => !!s.name)
		.map((s) => ({
			name: s.name,
			label: s.display_name || s.name,
			publicDelivery: (s as { public_delivery?: unknown }).public_delivery === true,
		}));
}

/**
 * Whether forms may send to a type: it is not the builder's own, and the
 * delivery API does not serve it, because anyone could read a visitor's post
 * there. The builder plugin refuses a save that names any other type.
 */
function formsMaySendTo(row: FormSchemaRow): boolean {
	return !row.publicDelivery && showable([row.name]).length > 0;
}

/** What a refused settings read means. A tenant the plugin is withheld from gets the area's own notice. */
function settingsGate(err: unknown): ConnectionsGate {
	if (err instanceof ApiError && err.status === 403 && errorCodeOf(err) === WITHHELD) return { state: 'withheld' };
	return gateOf(err, 'Could not load the builder settings.');
}

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	// The settings route answers owners only, so nobody else opens the page.
	if (!isOwner(user?.roles)) error(403, forbiddenText('this page', OWNER_ROLES));

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.builder)) {
		return {
			gate: { state: 'absent' } as ConnectionsGate,
			settings: null as Section<Settings> | null,
			schemas: [] as string[],
			schemasGate: null as Gate | null,
			formSchemas: [] as FormSchemaOption[],
			schemaLabels: {} as Record<string, string>,
			submissions: 'absent' as SubmissionsState,
			formsTypeTaken: false,
			flows: null as Section<FlowTargets> | null,
			formsPreset: null as Section<boolean> | null,
		};
	}

	const client = authedClient(event);
	const schemas = section(formSchemaRows(client), 'Could not load content types. Pages keep showing the content types saved before.');
	// Without the flow plugin no flow can start, so forms send only to content types.
	const flows = runs(plugins, PLUGIN.flow) ? section(readFlowTargets(client), 'Could not load flows.') : null;
	// Without the schema plugin there is no preset to apply. A catalog that fails to load is said as a failure.
	const formsPreset = runs(plugins, PLUGIN.schema)
		? section(
				readSchemaPresets(client).then((c) => c.presets.some((p) => p.id === FORMS_PRESET)),
				'Could not load the content type presets.',
			)
		: null;
	const read = await section(getSettings(client), settingsGate);
	const schemaList = await schemas;
	// A tenant the plugin is withheld from is the page's gate, and every other
	// refusal stays on the settings.
	if (!read.ok && read.gate.state === 'withheld') {
		return {
			gate: read.gate as ConnectionsGate,
			settings: null,
			schemas: [] as string[],
			schemasGate: null,
			formSchemas: [] as FormSchemaOption[],
			schemaLabels: {} as Record<string, string>,
			submissions: 'absent' as SubmissionsState,
			formsTypeTaken: false,
			flows: null,
			formsPreset: null,
		};
	}
	const rows = schemaList.ok ? schemaList.value : [];
	return {
		gate: GATE_OK as ConnectionsGate,
		settings: read as Section<Settings>,
		schemas: showable(rows.map((r) => r.name).sort()),
		schemasGate: schemaList.ok ? null : schemaList.gate,
		formSchemas: formSchemaOptions(rows.filter(formsMaySendTo).map(({ name, label }) => ({ name, label }))),
		schemaLabels: Object.fromEntries(rows.map((r) => [r.name, r.label])),
		submissions: submissionsState(rows),
		formsTypeTaken: rows.some((r) => r.name === FORMS_TYPE),
		flows: flows ? await flows : null,
		formsPreset: formsPreset ? await formsPreset : null,
	};
};

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

// No requireRole here. The engine answers the settings route for owners only.
export const actions: Actions = {
	// Applies the schema plugin's forms preset, unless its submissions type
	// exists already, and lets forms send to that type. The save keeps only
	// the allowed types forms may still send to, because the builder plugin
	// refuses the whole save over one that was deleted or opened to delivery.
	formsPreset: async (event) => {
		const client = authedClient(event);
		let created = false;
		try {
			const [rows, current] = await Promise.all([formSchemaRows(client), getSettings(client)]);
			const state = submissionsState(rows);
			if (state === 'public') return fail(409, { presetError: SUBMISSIONS_PUBLIC });
			if (state === 'absent') {
				if (rows.some((r) => r.name === FORMS_TYPE)) return fail(409, { presetError: FORMS_TYPE_TAKEN });
				try {
					await applySchemaPreset(client, FORMS_PRESET);
					created = true;
				} catch (e) {
					if (e instanceof ApiError && e.status === 404) return fail(404, { presetMissing: true });
					if (e instanceof ApiError && e.status === 409) return fail(409, { presetError: FORMS_TYPE_TAKEN });
					throw e;
				}
			}
			const allowed = current.form_schemas ?? [];
			if (allowed.includes(FORM_SUBMISSIONS)) return { presetApplied: { created, settings: current } };
			const still = allowed.filter((n) => rows.some((r) => r.name === n && formsMaySendTo(r)));
			const settings = await saveSettings(client, { form_schemas: [...still, FORM_SUBMISSIONS] });
			return { presetApplied: { created, settings } };
		} catch (e) {
			const status = e instanceof ApiError ? e.status : 503;
			// The types exist now, so the page reloads its data and offers to allow them.
			if (created) {
				const presetError = isOutage(e)
					? 'The Forms and Form submissions content types were created. Check whether Form submissions is ticked below, then try again.'
					: `The Forms and Form submissions content types were created, but forms cannot send to Form submissions yet. ${refusalSentence(e, 'Try again.')}`;
				return fail(isOutage(e) ? 503 : status, { presetCreated: true, presetError });
			}
			if (isOutage(e)) return fail(503, { presetError: SAID.settingOutage });
			const why = refusalSentence(e, 'Could not set up form submissions. Try again.');
			return fail(status, { presetError: why });
		}
	},

	setting: async (event) => {
		const form = await event.request.formData();
		const { field, patch, error } = setting(form);
		if (!patch) return fail(400, { settingError: { field, message: error ?? '' } });
		try {
			return { saved: { field, settings: await saveSettings(authedClient(event), patch) } };
		} catch (e) {
			if (errorCodeOf(e) === 'settings_invalid') {
				return fail(422, { settingError: { field: bodyString(e, 'field') || field, message: (e as ApiError).message } });
			}
			if (isOutage(e)) return fail(503, { settingError: { field, message: SAID.settingOutage } });
			return fail(e instanceof ApiError ? e.status : 400, {
				settingError: { field, message: refusalSentence(e, 'Could not save the setting. Try again.') },
			});
		}
	},
};
