import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	MIN_TOKEN_LENGTH,
	createProvider,
	deleteProvider,
	deprovisionAction,
	listProviders,
	rotateToken,
	type ScimProvider,
} from '$lib/api/scim';
import { type Gate, GATE_OK, gateOf, section } from '$lib/api/gate';
import { pageOf, pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { listProviders as listSamlProviders } from '$lib/api/saml';
import { asked } from '$lib/server/asked';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * The SAML providers a new connection can be linked to. Off when SAML does
 * not run or is not enabled here, so the form offers no link it cannot make,
 * and failed when the read did not answer, so an outage never reads as none.
 */
export type SamlLink =
	| { state: 'ok'; providers: { id: string; name: string }[] }
	| { state: 'off' }
	| { state: 'failed' };

const SAML_OFF_STATES = new Set(['absent', 'locked', 'full', 'forbidden']);

async function samlLink(event: Parameters<PageServerLoad>[0], plugins: Parameters<typeof notRunning>[0]): Promise<SamlLink> {
	if (notRunning(plugins, PLUGIN.saml)) return { state: 'off' };
	try {
		const page = await listSamlProviders(authedClient(event), MAX_LIMIT, 0);
		return { state: 'ok', providers: (page.data ?? []).map((p) => ({ id: p.id, name: p.name })) };
	} catch (err) {
		return SAML_OFF_STATES.has(gateOf(err, 'Could not load identity providers.').state) ? { state: 'off' } : { state: 'failed' };
	}
}

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.scim)) {
		return {
			providers: [] as ScimProvider[],
			total: null as number | null,
			limit,
			offset,
			hasMore: false,
			gate: { state: 'absent' } as Gate,
			saml: { state: 'off' } as SamlLink,
		};
	}

	const client = authedClient(event);
	const read = await section(
		listProviders(client, limit + 1, offset).then((res) => pageOf(res, limit, offset)),
		'Could not load SCIM connections.',
	);
	if (read.ok) {
		const back = pastEndOffset(read.value.rows.length, limit, offset, read.value.total);
		if (back !== null) redirect(307, withOffset(event.url, back));
	}

	const saml = read.ok ? await samlLink(event, plugins) : ({ state: 'off' } as SamlLink);
	return {
		providers: read.ok ? read.value.rows : [],
		total: read.ok ? read.value.total : null,
		limit,
		offset,
		hasMore: read.ok && read.value.hasMore,
		gate: read.ok ? GATE_OK : read.gate,
		saml,
	};
};

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const name = String(form.get('name') ?? '').trim();
		const token = String(form.get('bearer_token') ?? '');
		const action = deprovisionAction(String(form.get('deprovision_action') ?? 'disable'));

		if (!name) return fail(400, { action: 'create', error: 'Enter a name for the connection.' });
		if (token.length < MIN_TOKEN_LENGTH) {
			return fail(400, {
				action: 'create',
				error: `Enter a token of at least ${MIN_TOKEN_LENGTH} characters. It is the only thing protecting a route that creates and deletes accounts.`,
			});
		}
		if (!action) return fail(400, { action: 'create', error: 'Choose what happens to a deprovisioned account.' });
		const samlProvider = String(form.get('saml_provider_id') ?? '').trim();

		try {
			await createProvider(client, {
				name,
				bearer_token: token,
				deprovision_on_delete: form.get('deprovision_on_delete') === 'true',
				deprovision_action: action,
				...(samlProvider ? { saml_provider_id: samlProvider } : {}),
			});
		} catch (err) {
			return tagged('create', actionFailure(err, 'Could not create the connection. Try again.'));
		}
		return { saved: name };
	},

	rotate: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		const token = String(form.get('new_token') ?? '');
		if (!id) return fail(400, { action: 'rotate', error: 'This form is missing its connection. Reload the page and try again.' });
		if (token.length < MIN_TOKEN_LENGTH) {
			return fail(400, {
				action: 'rotate',
				error: `Enter a token of at least ${MIN_TOKEN_LENGTH} characters. The old token stops working as soon as the new one is saved.`,
			});
		}
		try {
			await rotateToken(client, id, token);
		} catch (err) {
			return tagged('rotate', actionFailure(err, 'Could not rotate the token. Try again.'));
		}
		return { rotated: id };
	},

	delete: asked(
		{
			question: 'Delete this SCIM connection?',
			detail: 'The identity provider stops being able to create or remove accounts here. Accounts it already created are left as they are.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			if (!id) return fail(400, { action: 'delete', error: 'This form is missing its connection. Reload the page and try again.' });
			try {
				await deleteProvider(client, id);
			} catch (err) {
				return tagged('delete', actionFailure(err, 'Could not delete the connection. Try again.'));
			}
			return { removed: id };
		},
	),
};
