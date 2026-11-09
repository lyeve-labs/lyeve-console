import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { authedClient } from '$lib/server/authz';
import { ApiError } from '@lyeve-labs/client';
import { getPluginSchema } from '@lyeve-labs/client-rest';
import { pluginSettings } from '$lib/config-forms';
import { sessionToken } from '$lib/server/session-cookie';
import { SESSION_ENDED } from '$lib/session';
import { actionError } from '$lib/server/action-error';
import { section, type Section } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';

export interface ConfigSetting {
	key: string;
	source: 'env' | 'file' | 'admin' | 'default' | string;
	value?: string;
	origin?: string;
	editable: boolean;
	secret?: boolean;
	/** What the setting does, when the engine describes it. */
	description?: string;
	/** What applies when no layer sets it. */
	default?: string;
	/** Read when the engine starts, so a value saved here applies at the next restart. */
	read_at_start?: boolean;
}

interface ConfigProvenance {
	settings: ConfigSetting[];
	counts: Record<string, number>;
	suppressed?: string[];
}

interface ConfigRefusal {
	key: string;
	reason: string;
	origin?: string;
}

function refusalSentence(refusal: ConfigRefusal): string {
	const where = refusal.origin ? ` (${refusal.origin})` : '';
	return `${refusal.reason}${where}`;
}

function refusedIn(body: unknown): ConfigRefusal | null {
	const first = (body as { refused?: unknown } | null)?.refused;
	if (!Array.isArray(first) || first.length === 0) return null;
	const r = first[0] as Partial<ConfigRefusal>;
	return typeof r?.reason === 'string' ? { key: String(r.key ?? ''), reason: r.reason, origin: r.origin } : null;
}

export const load: PageServerLoad = async (event) => {
	const client = authedClient(event);
	const read = await section(
		client.get<ConfigProvenance>('/api/admin/config'),
		couldNotLoad('the configuration')
	);

	// Opened for one plugin, the page shows that plugin's settings: the ones
	// its schema declares, including those nothing has read yet, which the
	// engine's list cannot know about.
	const pluginName = event.url.searchParams.get('plugin')?.trim() ?? '';
	if (!pluginName || !read.ok) return { provenance: read, plugin: null };
	// The engine answers 404 for a plugin that declares no settings or is not
	// running. Any other failure is a read that did not happen, and the page
	// says so rather than reporting a plugin with nothing to set.
	let failed = false;
	const schema = await getPluginSchema(pluginName, client).catch((err: unknown) => {
		if (!(err instanceof ApiError && err.status === 404)) failed = true;
		return null;
	});
	const merged = pluginSettings(read.value.settings, schema);
	const provenance: Section<ConfigProvenance> = { ok: true, value: { ...read.value, settings: merged.settings } };
	return {
		provenance,
		plugin: { name: pluginName, keys: merged.keys, found: schema !== null, failed },
	};
};

export const actions: Actions = {
	// One setting per submission. Sending the whole table would clear every
	// credential the operator did not retype, because a blank secret is how the
	// engine is told to unset one.
	save: async (event) => {
		const { request } = event;
		if (!sessionToken(event)) return fail(401, { error: SESSION_ENDED });

		const data = await request.formData();
		const key = data.get('key')?.toString()?.trim();
		if (!key) return fail(400, { error: 'This form is missing its setting. Reload the page and try again.' });

		const value = data.get('value')?.toString() ?? '';
		const secret = data.get('secret')?.toString() === 'true';
		if (secret && value === '') {
			return fail(400, { key, error: 'Enter a value, or use Clear to remove the stored one.' });
		}

		try {
			const result = await authedClient(event).put<{
				saved?: ConfigSetting[];
				refused?: ConfigRefusal[];
			}>('/api/admin/config', { values: { [key]: value } });

			const refusal = result.refused?.[0];
			if (refusal) return fail(409, { key, error: refusalSentence(refusal) });
			return { success: true, key };
		} catch (e) {
			// A save whose only key is refused answers 409 with the refusal in
			// the body and no error field.
			const refused = e instanceof ApiError && e.status === 409 ? refusedIn(e.body) : null;
			if (refused) return fail(409, { key, error: refusalSentence(refused) });
			// A refusal keeps its status and its sentence. A failure of the engine
			// keeps neither, because its text is not written for the operator.
			const status = e instanceof ApiError && e.status < 500 ? e.status : 502;
			return fail(status, { key, error: actionError(e, 'Could not save the setting. Try again.') });
		}
	},
};
