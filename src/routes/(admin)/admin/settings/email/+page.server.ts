import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionError, actionFailure, tagged } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	createEmailProvider,
	deleteEmailProvider,
	listEmailProviders,
	updateEmailProvider,
	type EmailProvider,
} from '$lib/api/email';
import { parseProvider } from '$lib/email/provider-form';
import { ApiError } from '@lyeve-labs/client';
import { sessionToken } from '$lib/server/session-cookie';
import { SESSION_ENDED } from '$lib/session';
import { section, type Section } from '$lib/api/gate';
import { asked } from '$lib/server/asked';

/**
 * The engine config keys that make up the fallback transport.
 *
 * This is not a second way to configure the provider pool. These are the
 * engine-level SMTP settings, used when no provider can send: password-reset
 * and magic-link read these keys directly and dial the relay themselves.
 * Removing them answers 200 to every reset request and sends nothing.
 *
 * SMTP_PASS is not marked secret here. Whether a key is a credential is the
 * engine's judgment, and it makes it by name: the admin API withholds the
 * value of anything it treats as secret and marks the setting, so a second
 * list in the client could only disagree with it.
 */
const MAIL_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_TLS'];

export interface ConfigSetting {
	key: string;
	source: 'env' | 'file' | 'admin' | 'default' | string;
	value?: string;
	origin?: string;
	editable: boolean;
	secret?: boolean;
}

interface ConfigProvenance {
	settings: ConfigSetting[];
}

interface ConfigRefusal {
	key: string;
	reason: string;
	origin?: string;
}

/**
 * Read the fallback transport, or null when this session may not see it.
 *
 * Reading it needs a super admin, and the provider pool above it does not, so
 * the section is left out for anyone else rather than failing the page: an
 * admin who can manage providers should not be locked out of the page that
 * lists them by a section they cannot read. A super admin whose read failed is
 * told so, because a missing section would read as a transport nobody set.
 */
async function loadMail(event: Parameters<PageServerLoad>[0], superAdmin: boolean): Promise<Section<ConfigSetting[]> | null> {
	if (!superAdmin) return null;
	if (!sessionToken(event)) return null;
	return section(
		authedClient(event).get<ConfigProvenance>('/api/admin/config').then(mailSettings),
		'Could not load the fallback transport.',
	);
}

function mailSettings(provenance: ConfigProvenance): ConfigSetting[] {
	// A key no layer has ever supplied is absent from the provenance list, and
	// an absent mail setting is the ordinary case on a fresh instance. Fill the
	// gaps so every field renders, rather than showing a form that grows rows
	// as it is filled in.
	const known = new Map(provenance.settings.map((s) => [s.key, s]));
	return MAIL_KEYS.map(
		(key) => known.get(key) ?? ({ key, source: 'default', editable: true } as ConfigSetting)
	);
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
	const { plugins, user } = await event.parent();
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.email)) {
		return { mail: null, providers: { ok: false, gate: { state: 'absent' } } as Section<EmailProvider[]> };
	}
	const [mail, providers] = await Promise.all([
		loadMail(event, user.roles.includes('super_admin')),
		section(listEmailProviders(authedClient(event)), 'Could not load email providers.'),
	]);
	return { mail, providers };
};

const text = (data: FormData, key: string): string => String(data.get(key) ?? '').trim();

export const actions: Actions = {
	create: async (event) => {
		await requireUser(event);
		const parsed = parseProvider(await event.request.formData(), false);
		if ('error' in parsed) return fail(400, { action: 'provider', error: parsed.error });
		try {
			await createEmailProvider(authedClient(event), parsed.body);
		} catch (err) {
			return tagged('provider', actionFailure(err, 'Could not create the provider. Try again.'));
		}
	},

	update: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const id = text(data, 'id');
		if (!id) return fail(400, { action: 'provider', error: 'This form is missing its provider. Reload the page and try again.' });
		const parsed = parseProvider(data, true);
		if ('error' in parsed) return fail(400, { action: 'provider', error: parsed.error });
		try {
			await updateEmailProvider(authedClient(event), id, parsed.body);
		} catch (err) {
			return tagged('provider', actionFailure(err, 'Could not save the provider. Try again.'));
		}
	},

	delete: asked(
		{
			question: 'Delete this provider?',
			detail: 'Mail that would go through it goes to the next provider instead.',
			label: 'Delete',
		},
		async (event) => {
			await requireUser(event);
			const data = await event.request.formData();
			try {
				await deleteEmailProvider(authedClient(event), text(data, 'id'));
			} catch (err) {
				return tagged('delete', actionFailure(err, 'Could not delete the provider. Try again.'));
			}
		},
	),

	// One setting per submission. Sending the whole form would clear every
	// credential the operator did not retype, because a blank secret is how the
	// engine is told to unset one.
	saveSetting: async (event) => {
		await requireUser(event);
		if (!sessionToken(event)) return fail(401, { error: SESSION_ENDED });

		const data = await event.request.formData();
		const key = text(data, 'key');
		if (!key) return fail(400, { error: 'This form is missing its setting. Reload the page and try again.' });
		if (!MAIL_KEYS.includes(key)) return fail(400, { key, error: 'This setting cannot be changed here.' });

		const value = data.get('value')?.toString() ?? '';
		const secret = text(data, 'secret') === 'true';
		if (secret && value === '') {
			return fail(400, { key, error: 'Enter a value, or clear it from Configuration.' });
		}

		try {
			const result = await authedClient(event).put<{
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
			// A failure of the engine keeps neither its status nor its text,
			// because neither is written for the operator.
			const status = e instanceof ApiError && e.status < 500 ? e.status : 502;
			return fail(status, { key, error: actionError(e, 'Could not save the setting. Try again.') });
		}
	},
};
