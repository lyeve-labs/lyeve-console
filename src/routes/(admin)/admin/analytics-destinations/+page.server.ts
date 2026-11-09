import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { GATE_OK, gateOf, inSentence, type Gate } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import {
	CONFIG_FIELDS,
	DELIVERY_LIMIT,
	DELIVERY_STATUSES,
	MAX_ATTEMPTS,
	MAX_BACKOFF_SECONDS,
	createProvider,
	deleteProvider,
	isProviderType,
	listDeliveries,
	listProviders,
	replayDelivery,
	updateProvider,
	type Delivery,
	type DeliveryStatus,
	type Listed,
	type Provider,
	type ProviderInput,
	type ProviderType,
} from '$lib/api/analytics-destinations';
import { asked } from '$lib/server/asked';

function statusOf(url: URL): DeliveryStatus | '' {
	const s = url.searchParams.get('status') ?? '';
	return (DELIVERY_STATUSES as readonly string[]).includes(s) ? (s as DeliveryStatus) : '';
}

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const status = statusOf(event.url);
	let gate: Gate = notRunning(plugins, PLUGIN.productAnalytics) ? { state: 'absent' } : GATE_OK;
	let providers: Listed<Provider> = { data: [], licensed: false };
	// A failed delivery read is said as one, never drawn as an empty queue.
	let deliveries: Listed<Delivery> | null = null;
	let deliveriesGate: Gate | null = null;
	// The plugin takes no offset and sends no count, so one row past the list
	// is asked for. It says more are owed than the list shows, and is dropped.
	let moreDeliveries = false;
	if (gate.state === 'ok') {
		const client = authedClient(event);
		try {
			providers = await listProviders(client);
		} catch (err) {
			gate = gateOf(err, couldNotLoad('destinations'));
		}
		if (gate.state === 'ok') {
			try {
				const read = await listDeliveries(client, status, DELIVERY_LIMIT + 1);
				moreDeliveries = read.data.length > DELIVERY_LIMIT;
				deliveries = { ...read, data: read.data.slice(0, DELIVERY_LIMIT) };
			} catch (err) {
				deliveriesGate = gateOf(err, couldNotLoad('deliveries'));
			}
		}
	}
	return {
		gate,
		providers: providers.data,
		licensed: providers.licensed,
		deliveries,
		deliveriesGate,
		moreDeliveries,
		deliveryLimit: DELIVERY_LIMIT,
		status,
	};
};

/** The settings the form named for a type, or null when it named none. */
function configFrom(type: ProviderType, form: FormData): Record<string, string> | null {
	const out: Record<string, string> = {};
	for (const f of CONFIG_FIELDS[type]) {
		const v = String(form.get(`config_${f.key}`) ?? '').trim();
		if (v) out[f.key] = v;
	}
	return Object.keys(out).length ? out : null;
}

/** The retry policy the form posted, or the sentence that refuses it. */
function retryFrom(form: FormData): { attempts: number; backoff: number } | { error: string } {
	const attempts = Number(form.get('max_attempts') ?? 1);
	const backoff = Number(form.get('backoff_seconds') ?? 0);
	if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS) {
		return { error: `Enter 1 to ${MAX_ATTEMPTS} attempts.` };
	}
	if (attempts > 1 && (!Number.isInteger(backoff) || backoff < 1 || backoff > MAX_BACKOFF_SECONDS)) {
		return { error: `Enter 1 to ${MAX_BACKOFF_SECONDS} seconds for the first retry.` };
	}
	return { attempts, backoff: attempts > 1 ? backoff : 0 };
}

export const actions: Actions = {
	save: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '').trim();
		const name = String(form.get('name') ?? '').trim();
		const type = String(form.get('type') ?? '');
		if (!name) return fail(400, { error: 'Enter a name.', drawer: true });
		if (!isProviderType(type)) return fail(400, { error: 'Choose a destination type.', drawer: true });
		const retry = retryFrom(form);
		if ('error' in retry) return fail(400, { error: retry.error, drawer: true });
		const config = configFrom(type, form);
		const missing = CONFIG_FIELDS[type].find((f) => f.required && !config?.[f.key]);
		// A new destination needs every required setting. An edit that names
		// none keeps the stored ones, and one that names any replaces all.
		if (missing && (!id || config)) {
			return fail(400, { error: `Enter the ${inSentence(missing.label)}.`, drawer: true });
		}

		const body: ProviderInput = { name, enabled: form.get('enabled') === 'true' };
		if (config) body.config = config;
		// A new destination sends a policy only when it retries, so one that
		// does not is never asked about a license. An edit resends the policy
		// as it stands, which the plugin takes without one.
		if (id || retry.attempts > 1) {
			body.retry_policy = { max_attempts: retry.attempts, backoff_seconds: retry.backoff };
		}
		if (id && form.get('rotate_secret') === 'true') body.rotate_secret = true;

		let saved: Provider;
		try {
			saved = id ? await updateProvider(authedClient(event), id, body) : await createProvider(authedClient(event), { ...body, type });
		} catch (err) {
			const failed = actionFailure(err, 'Could not save the destination. Try again.');
			return fail(failed.status, { ...failed.data, drawer: true });
		}
		return { saved: saved.name || name, signingSecret: saved.signing_secret ?? '' };
	},

	delete: asked(
		{
			question: 'Delete this destination?',
			detail: 'Events stop going to this destination, and its queued deliveries are deleted. This cannot be undone.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const id = String((await event.request.formData()).get('id') ?? '');
			if (!id) return fail(400, { error: 'This form is missing its destination. Reload the page and try again.' });
			try {
				await deleteProvider(authedClient(event), id);
			} catch (err) {
				const failed = actionFailure(err, 'Could not delete the destination. Try again.');
				return fail(failed.status, failed.data);
			}
			return { deleted: id };
		},
	),

	replay: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const id = String((await event.request.formData()).get('id') ?? '');
		if (!id) return fail(400, { error: 'This form is missing its delivery. Reload the page and try again.' });
		try {
			const out = await replayDelivery(authedClient(event), id);
			return { replayed: id, delivered: out.delivered, lastError: out.delivery?.last_error ?? '' };
		} catch (err) {
			return actionFailure(err, 'Could not send the delivery again. Try again.');
		}
	},
};
