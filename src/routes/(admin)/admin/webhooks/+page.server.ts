import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole, requireUser } from '$lib/server/authz';
import type { DeadLetter, HttpClient, Webhook, WebhookDelivery } from '@lyeve-labs/client';
import { getSchemas } from '@lyeve-labs/client-rest';
import { deleteWebhook, testWebhook, listDeliveries, rotateSecret, retryDelivery, replayDeadLetter, dismissDeadLetter, deleteDeadLetter } from '@lyeve-labs/client-rest';
import { actionFailure, tagged } from '$lib/server/action-error';
import { createWebhookRecord, updateWebhookRecord, webhookBodyFrom } from '$lib/api/webhook-options';
import { section, type Section } from '$lib/api/gate';
import { pageOf, pageWindow, pastEndOffset, rowsOf, statedTotal, withOffset, type ListEnvelope } from '$lib/api/list';
import { asked } from '$lib/server/asked';

/** The page size when a request names none. */
const DEFAULT_LIMIT = 50;

/**
 * One below the engine's list ceiling, because the request below asks for a row
 * past the page to learn whether another page exists. At the ceiling that extra
 * row would be clamped away and the last page would always look like the last
 * page.
 */
const MAX_LIMIT = 199;

/** What the page says for a list read that failed for no reason it can name. */
const LIST_FAILED = 'Could not load webhooks.';

/** What the drawer says when the schema names could not be read. */
const SCHEMAS_FAILED = 'Could not load content types.';

/** One page of the dead letter queue. */
const DEAD_LETTER_PAGE = 50;

/** How many attempts the delivery history asks for. The plugin offers no offset. */
const DELIVERY_LIMIT = 50;

/** A webhook's delivery history, read when the address names the webhook. */
interface DeliveriesRead {
	id: string;
	limit: number;
	read: Section<WebhookDelivery[]>;
}

/** A page of the dead letter queue, read when the address opens it. */
interface DeadLettersRead {
	offset: number;
	limit: number;
	read: Section<{ rows: DeadLetter[]; total: number | null }>;
}

/**
 * The delivery history of the webhook `?deliveries=<id>` names. The plugin
 * answers the newest attempts up to the limit and offers no offset.
 */
async function readDeliveries(client: HttpClient, url: URL): Promise<DeliveriesRead | null> {
	const id = url.searchParams.get('deliveries');
	if (!id) return null;
	return { id, limit: DELIVERY_LIMIT, read: await section(listDeliveries(id, client, DELIVERY_LIMIT), 'Could not load deliveries.') };
}

/*
 * The page of the queue `?dead` opens, at `dead_offset`. Read straight from
 * the endpoint rather than through listDeadLetters(). The engine answers with
 * its standard envelope, data and total_count. The helper's declared type
 * names items and total, so a page reading through it sees an empty queue
 * while deliveries wait in it.
 */
async function readDeadLetters(client: HttpClient, url: URL): Promise<DeadLettersRead | null> {
	if (!url.searchParams.has('dead')) return null;
	const asked = Number(url.searchParams.get('dead_offset') ?? 0);
	const offset = Number.isInteger(asked) && asked > 0 ? asked : 0;
	const qs = new URLSearchParams({ limit: String(DEAD_LETTER_PAGE), offset: String(offset) });
	const read = await section(
		client
			.get<ListEnvelope<DeadLetter> | DeadLetter[]>(`/api/admin/webhook-dead-letters?${qs}`)
			.then((res) => ({ rows: rowsOf(res), total: statedTotal(res) })),
		'Could not load dead letters.'
	);
	return { offset, limit: DEAD_LETTER_PAGE, read };
}

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const client = authedClient(event);
	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);

	/*
	 * Read straight from the client rather than through listWebhooks, which
	 * unwraps the rows and drops the envelope the row count sits in. The page
	 * states a total only when the endpoint sends one and falls back to a probe
	 * row otherwise, so neither branch reports a number nobody measured.
	 */
	const [read, schemas, deliveries, deadLetters] = await Promise.all([
		section(
			client.get<ListEnvelope<Webhook> | Webhook[]>(
				`/api/admin/webhooks?limit=${limit + 1}&offset=${offset}`
			),
			LIST_FAILED
		),
		section(getSchemas(client), SCHEMAS_FAILED),
		readDeliveries(client, url),
		readDeadLetters(client, url)
	]);

	// The page draws the gate in place of the list, so nothing is paged.
	if (!read.ok) return { webhooks: read, schemas, limit, offset, total: null, hasMore: false, deliveries, deadLetters };

	const page = pageOf<Webhook>(read.value, limit, offset);
	const back = pastEndOffset(page.rows.length, limit, offset, page.total);
	if (back !== null) redirect(307, withOffset(url, back));
	// Typed, because a bare literal widens `ok` to boolean and the page could
	// no longer tell the two cases apart.
	const webhooks: Section<Webhook[]> = { ok: true, value: page.rows };
	return {
		webhooks,
		schemas,
		limit,
		offset,
		total: page.total,
		hasMore: page.hasMore,
		deliveries,
		deadLetters
	};
};

export const actions: Actions = {
	create: async (event) => {
		// The plugin serves this write to a super admin only.
		await requireRole(event, ['super_admin']);
		const parsed = webhookBodyFrom(await event.request.formData());
		if ('error' in parsed) {
			return fail(400, { action: 'create', error: 'Check the highlighted fields.', fields: { [parsed.field ?? 'name']: parsed.error } });
		}
		try {
			await createWebhookRecord(authedClient(event), parsed.body);
		} catch (err) {
			return tagged('create', actionFailure(err, 'Could not create the webhook. Try again.'));
		}
	},

	update: async (event) => {
		// The plugin serves this write to a super admin only.
		await requireRole(event, ['super_admin']);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		const parsed = webhookBodyFrom(data);
		if ('error' in parsed) {
			return fail(400, { action: 'update', error: 'Check the highlighted fields.', fields: { [parsed.field ?? 'name']: parsed.error } });
		}
		try {
			await updateWebhookRecord(authedClient(event), id, parsed.body);
		} catch (err) {
			return tagged('update', actionFailure(err, 'Could not save the webhook. Try again.'));
		}
	},

	delete: asked(
		{
			question: 'Delete this webhook?',
			detail: 'This cannot be undone.',
			label: 'Delete',
		},
		async (event) => {
			// The plugin serves this write to a super admin only.
			await requireRole(event, ['super_admin']);
			const { request } = event;
			const client = authedClient(event);
			const data = await request.formData();
			const id = String(data.get('id') ?? '');

			try {
				await deleteWebhook(id, client);
			} catch (err) {
				return tagged('delete', actionFailure(err, 'Could not delete the webhook. Try again.'));
			}
		},
	),

	test: async (event) => {
		await requireUser(event);
		const { request, fetch, cookies } = event;
		const client = authedClient(event);
		const data = await request.formData();
		const id = String(data.get('id') ?? '');

		try {
			const result = await testWebhook(id, client);
			return { testResult: { id, ...result } };
		} catch (err) {
			return tagged('test', actionFailure(err, 'Could not test the webhook. Try again.'));
		}
	},

		'rotate-secret': async (event) => {
			// The plugin serves this write to a super admin only.
			await requireRole(event, ['super_admin']);
			const { request } = event;
			const client = authedClient(event);
			const data = await request.formData();
			const id = String(data.get('id') ?? '');
			const newSecret = data.get('new_secret');

			try {
				// The plugin answers the webhook and the new secret beside it, and
				// shows the secret this once, so both are handed to the page.
				const result = (await rotateSecret(id, client, newSecret ? String(newSecret) : undefined)) as unknown as {
					webhook?: { name?: string };
					new_secret?: string;
				};
				return { rotated: { id, name: result.webhook?.name ?? '', secret: result.new_secret ?? '' } };
			} catch (err) {
				return tagged('rotate-secret', actionFailure(err, 'Could not rotate the signing secret. Try again.'));
			}
		},

		'retry-delivery': async (event) => {
			await requireUser(event);
			const { request, fetch, cookies } = event;
			const client = authedClient(event);
			const data = await request.formData();
			const id = String(data.get('id') ?? '');
			const deliveryId = String(data.get('delivery_id') ?? '');

			try {
				const result = await retryDelivery(id, deliveryId, client);
				return { retryResult: result };
			} catch (err) {
				return tagged('retry-delivery', actionFailure(err, 'Could not retry the delivery. Try again.'));
			}
		},

		'dead-letter-replay': async (event) => {
			await requireUser(event);
			const { request, fetch, cookies } = event;
			const client = authedClient(event);
			const data = await request.formData();
			const id = String(data.get('id') ?? '');

			try {
				const result = await replayDeadLetter(id, client);
				return { deadLetterReplay: result };
			} catch (err) {
				return tagged('dead-letter-replay', actionFailure(err, 'Could not replay the dead letter. Try again.'), id);
			}
		},

		'dead-letter-dismiss': async (event) => {
			await requireUser(event);
			const { request, fetch, cookies } = event;
			const client = authedClient(event);
			const data = await request.formData();
			const id = String(data.get('id') ?? '');

			try {
				const result = await dismissDeadLetter(id, client);
				return { deadLetterDismiss: result };
			} catch (err) {
				return tagged('dead-letter-dismiss', actionFailure(err, 'Could not dismiss the dead letter. Try again.'), id);
			}
		},

	'dead-letter-delete': asked(
		{
			question: 'Delete this dead letter?',
			detail: 'The delivery is deleted permanently. It cannot be replayed.',
			label: 'Delete',
		},
		async (event) => {
			await requireUser(event);
			const { request, fetch, cookies } = event;
			const client = authedClient(event);
			const data = await request.formData();
			const id = String(data.get('id') ?? '');

			try {
				await deleteDeadLetter(id, client);
			} catch (err) {
				return tagged('dead-letter-delete', actionFailure(err, 'Could not delete the dead letter. Try again.'), id);
			}
		},
	),
};
