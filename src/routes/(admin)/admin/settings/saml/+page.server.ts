import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	createProvider,
	deleteProvider,
	getTemplate,
	listProviders,
	listTemplates,
	prepareCert,
	rolloverCert,
	updateProvider,
	type SamlProvider,
	type SamlTemplate,
} from '$lib/api/saml';
import { type Gate, GATE_OK, section } from '$lib/api/gate';
import { pageOf, pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { asked } from '$lib/server/asked';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * The attribute map arrives as one textarea, a line per pair, because the
 * number of claims an IdP sends is not known in advance and a fixed set of
 * inputs would be a guess. A line without a separator is dropped rather than
 * stored under an empty key, which would mask every claim that followed it.
 */
function attributeMap(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of raw.split('\n')) {
		const at = line.indexOf('=');
		if (at <= 0) continue;
		const key = line.slice(0, at).trim();
		const value = line.slice(at + 1).trim();
		if (key && value) out[key] = value;
	}
	return out;
}

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.saml)) {
		return {
			providers: [] as SamlProvider[],
			templates: [] as SamlTemplate[],
			total: null as number | null,
			limit,
			offset,
			hasMore: false,
			gate: { state: 'absent' } as Gate,
		};
	}

	const client = authedClient(event);
	const read = await section(
		listProviders(client, limit + 1, offset).then((res) => pageOf(res, limit, offset)),
		'Could not load identity providers.',
	);
	if (read.ok) {
		const back = pastEndOffset(read.value.rows.length, limit, offset, read.value.total);
		if (back !== null) redirect(307, withOffset(event.url, back));
	}
	const gate = read.ok ? GATE_OK : read.gate;

	// Templates fill a new provider's protocol settings. The list names them
	// and each one's own read carries the settings. Losing them costs the
	// shortcut, never the list, which is what an operator came to read.
	const templates =
		gate.state === 'ok'
			? await listTemplates(client)
					.then((list) => Promise.all(list.map((t) => getTemplate(client, t.key))))
					.catch((): SamlTemplate[] => [])
			: [];

	return {
		providers: read.ok ? read.value.rows : [],
		templates,
		total: read.ok ? read.value.total : null,
		limit,
		offset,
		hasMore: read.ok && read.value.hasMore,
		gate,
	};
};

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const name = String(form.get('name') ?? '').trim();
		const entityId = String(form.get('entity_id') ?? '').trim();
		const ssoUrl = String(form.get('sso_url') ?? '').trim();
		const idpCert = String(form.get('idp_cert') ?? '').trim();

		if (!name) return fail(400, { action: 'create', error: 'Enter a name for the provider.' });
		if (!entityId) return fail(400, { action: 'create', error: 'Enter the entity ID.' });
		if (!ssoUrl) return fail(400, { action: 'create', error: 'Enter the sign-on URL.' });
		if (!idpCert) return fail(400, { action: 'create', error: "Paste the identity provider's signing certificate." });

		try {
			await createProvider(client, {
				name,
				entity_id: entityId,
				sso_url: ssoUrl,
				slo_url: String(form.get('slo_url') ?? '').trim() || undefined,
				idp_cert: idpCert,
				name_id_format: String(form.get('name_id_format') ?? '').trim() || undefined,
				want_assertions_signed: form.get('want_assertions_signed') === 'true',
				want_response_signed: form.get('want_response_signed') === 'true',
				sign_authn_requests: form.get('sign_authn_requests') === 'true',
				encrypt_assertions: form.get('encrypt_assertions') === 'true',
				attributes_mapping: attributeMap(String(form.get('attributes_mapping') ?? '')),
				enabled: form.get('enabled') === 'true',
			});
		} catch (err) {
			return tagged('create', actionFailure(err, 'Could not create the provider. Try again.'));
		}
		return { saved: name };
	},

	update: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'update', error: 'This form is missing its provider. Reload the page and try again.' });

		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { action: 'update', error: 'Enter a name for the provider.' });
		// The plugin's update has no required rule, so a cleared field would be
		// stored and break sign-in through this provider.
		const entityId = String(form.get('entity_id') ?? '').trim();
		const ssoUrl = String(form.get('sso_url') ?? '').trim();
		if (!entityId) return fail(400, { action: 'update', error: 'Enter the entity ID.' });
		if (!ssoUrl) return fail(400, { action: 'update', error: 'Enter the sign-on URL.' });

		// An empty certificate field means "leave the stored one alone". Sending
		// the empty string would wipe the only thing that verifies an assertion.
		const idpCert = String(form.get('idp_cert') ?? '').trim();

		try {
			await updateProvider(client, id, {
				name,
				entity_id: entityId,
				sso_url: ssoUrl,
				// Sent even when empty: the plugin changes the logout URL only
				// when the key is present, so leaving it out would keep the old one.
				slo_url: String(form.get('slo_url') ?? '').trim(),
				...(idpCert ? { idp_cert: idpCert } : {}),
				name_id_format: String(form.get('name_id_format') ?? '').trim() || undefined,
				want_assertions_signed: form.get('want_assertions_signed') === 'true',
				want_response_signed: form.get('want_response_signed') === 'true',
				sign_authn_requests: form.get('sign_authn_requests') === 'true',
				encrypt_assertions: form.get('encrypt_assertions') === 'true',
				attributes_mapping: attributeMap(String(form.get('attributes_mapping') ?? '')),
				enabled: form.get('enabled') === 'true',
			});
		} catch (err) {
			return tagged('update', actionFailure(err, 'Could not save the provider. Try again.'));
		}
		return { saved: name };
	},

	delete: asked(
		{
			question: 'Delete this SAML provider?',
			detail: 'People who sign in through this provider lose access, and its private key is deleted. This cannot be undone.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			if (!id) return fail(400, { action: 'delete', error: 'This form is missing its provider. Reload the page and try again.' });
			try {
				await deleteProvider(client, id);
			} catch (err) {
				return tagged('delete', actionFailure(err, 'Could not delete the provider. Try again.'));
			}
			return { removed: id };
		},
	),

	prepare: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'prepare', error: 'This form is missing its provider. Reload the page and try again.' });
		try {
			await prepareCert(client, id);
		} catch (err) {
			return tagged('prepare', actionFailure(err, 'Could not prepare a new certificate. Try again.'));
		}
		return { prepared: id };
	},

	rollover: asked(
		{
			question: 'Promote the new certificate for this provider?',
			detail: 'Every request is signed with it from now on. Promote it only after the identity provider trusts the new certificate from the metadata document.',
			label: 'Promote',
		},
		async (event) => {
			await requireRole(event, ['super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			if (!id) return fail(400, { action: 'rollover', error: 'This form is missing its provider. Reload the page and try again.' });
			try {
				await rolloverCert(client, id);
			} catch (err) {
				return tagged('rollover', actionFailure(err, 'Could not promote the certificate. Try again.'));
			}
			return { rolled: id };
		},
	),
};
