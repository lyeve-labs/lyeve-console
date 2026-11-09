import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient, loadUser, requireRole, requireUser } from '$lib/server/authz';
import { aiActionError } from '$lib/server/ai-load';
import { putAiSettings } from '$lib/api/ai';

/** The retention window and the instance switch, as the config route states them. */
export interface InstanceSetting {
	key: string;
	value: string;
	source: string;
	editable: boolean;
}

interface ConfigProvenance {
	settings: { key: string; source: string; value?: string; editable: boolean }[];
}

interface ConfigRefusal {
	refused?: { key: string; reason: string; origin?: string }[];
}

/** The first refusal a config save answered, as a sentence, or null when it refused nothing. */
function refusalOf(body: unknown): string | null {
	const r = (body as ConfigRefusal | null | undefined)?.refused?.[0];
	if (!r || typeof r.reason !== 'string') return null;
	return r.origin ? `${r.reason} (${r.origin})` : r.reason;
}

const INSTANCE_KEYS = ['ai_transcript_retention', 'ai_transcripts_enabled'];
const DEFAULTS: Record<string, string> = { ai_transcript_retention: '720h', ai_transcripts_enabled: 'true' };

/**
 * The switch itself comes from the layout. What this load adds is the
 * instance side of retention: the config route is super_admin only and its
 * absence is not a failure of the page. Without a read the values stay
 * unknown, and the page shows none of them as this instance's.
 */
export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	let instance: InstanceSetting[] = INSTANCE_KEYS.map((key) => ({ key, value: DEFAULTS[key], source: 'default', editable: false }));
	let instanceReadable = false;
	if (user.roles.includes('super_admin')) {
		const provenance = await authedClient(event)
			.get<ConfigProvenance>('/api/admin/config')
			.catch(() => null);
		if (provenance) {
			instanceReadable = true;
			instance = INSTANCE_KEYS.map((key) => {
				// The engine lists a setting under its environment name, in upper case.
				const s = provenance.settings.find((x) => x.key.toUpperCase() === key.toUpperCase());
				return { key, value: s?.value ?? DEFAULTS[key], source: s?.source ?? 'default', editable: s?.editable ?? false };
			});
		}
	}
	return { instance, instanceReadable };
};

export const actions: Actions = {
	// One switch per submission. The plugin keeps whatever the body omits, so a
	// form that names one switch cannot flip another.
	save: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const body: { enabled?: boolean; transcripts_enabled?: boolean; assistant_enabled?: boolean } = {};
		for (const key of ['enabled', 'transcripts_enabled', 'assistant_enabled'] as const) {
			if (data.has(key)) body[key] = String(data.get(key)) === 'true';
		}
		if (Object.keys(body).length === 0) {
			return fail(400, { scope: 'switch', error: 'Nothing to change.' });
		}
		try {
			const settings = await putAiSettings(authedClient(event), body);
			return { scope: 'switch', settings };
		} catch (err) {
			const status = err instanceof ApiError && err.status === 403 ? 403 : 400;
			return fail(status, { scope: 'switch', error: aiActionError(err, 'Could not save the setting. Try again.') });
		}
	},

	config: async (event) => {
		await requireRole(event, ['super_admin']);
		const data = await event.request.formData();
		const key = String(data.get('key') ?? '').trim();
		if (!INSTANCE_KEYS.includes(key)) return fail(400, { scope: 'config', key, error: 'This form is missing its setting. Reload the page and try again.' });
		const value = String(data.get('value') ?? '').trim();
		if (key === 'ai_transcript_retention' && !/^\d+(?:\.\d+)?(?:h|m|s)$/.test(value)) {
			return fail(400, { scope: 'config', key, error: 'Enter a duration in hours, minutes or seconds, such as 720h. The minimum is 1h.' });
		}
		try {
			const result = await authedClient(event).put<ConfigRefusal>('/api/admin/config', {
				values: { [key]: value },
			});
			const refusal = refusalOf(result);
			if (refusal) return fail(409, { scope: 'config', key, error: refusal });
			return { scope: 'config', key, success: true };
		} catch (err) {
			// The engine answers a save it refuses whole with 409 and the same
			// refused list, with no error field to relay.
			const whole = err instanceof ApiError && err.status === 409 ? refusalOf(err.body) : null;
			if (whole) return fail(409, { scope: 'config', key, error: whole });
			if (err instanceof ApiError) return fail(err.status, { scope: 'config', key, error: aiActionError(err, 'Could not save the setting. Try again.', 'super_admin') });
			return fail(500, { scope: 'config', key, error: 'Could not save the setting. Try again.' });
		}
	},
};
