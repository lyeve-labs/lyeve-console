import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { refusalOf, refusalText } from '$lib/api/refusal';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { GATE_OK, gateOf, type Gate } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import { createSink, deleteSink, isSinkKind, listSinks, testSink, updateSink, type AuditSink } from '$lib/api/audit-sinks';
import { asked } from '$lib/server/asked';

const ADMINS = ['admin', 'super_admin'];

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	let sinks: AuditSink[] = [];
	let gate: Gate = notRunning(plugins, PLUGIN.audit) ? { state: 'absent' } : GATE_OK;
	if (gate.state === 'ok') {
		try {
			sinks = await listSinks(authedClient(event));
		} catch (err) {
			gate = gateOf(err, couldNotLoad('the streaming destinations'));
		}
	}
	return { sinks, gate };
};

function text(form: FormData, key: string): string {
	return String(form.get(key) ?? '').trim();
}

/** The fields both writes share, read the same way. */
function common(form: FormData) {
	return {
		name: text(form, 'name'),
		url: text(form, 'url'),
		splunk_index: text(form, 'splunk_index'),
		datadog_service: text(form, 'datadog_service'),
		datadog_tags: text(form, 'datadog_tags'),
		enabled: form.get('enabled') === 'true',
	};
}

/**
 * A failed write, tagged with the action that made it. Every form on the page
 * reports through one result, and the tag is how the drawer tells its own
 * failure from a delete or a test made from a row.
 */
function failure(action: string, err: unknown, fallback: string) {
	const refused = refusalOf(err);
	if (refused) return fail(402, { action, error: refusalText(refused), refused });
	return tagged(action, actionFailure(err, fallback));
}

function missing(action: string, body: { name: string; url: string }) {
	const fields: Record<string, string> = {};
	if (!body.name) fields.name = 'Enter a name.';
	if (!body.url) fields.url = 'Enter the URL.';
	return Object.keys(fields).length ? fail(400, { action, error: 'Check the highlighted fields.', fields }) : null;
}

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ADMINS);
		const form = await event.request.formData();
		const kind = text(form, 'kind');
		if (!isSinkKind(kind)) return fail(400, { action: 'create', error: 'Choose a destination.' });
		const body = common(form);
		const refused = missing('create', body);
		if (refused) return refused;
		const secret = text(form, 'secret');
		if (kind !== 'https' && !secret) {
			return fail(400, {
				action: 'create',
				error: 'Check the highlighted fields.',
				fields: { secret: kind === 'splunk' ? 'Enter the HEC token.' : 'Enter the API key.' },
			});
		}
		try {
			const created = await createSink(authedClient(event), {
				...body,
				kind,
				...(secret ? { secret } : {}),
				backfill: form.get('backfill') === 'true',
			});
			// A secret the plugin generated is in this answer and nowhere else.
			return { created: created.name, secret: created.secret ?? '' };
		} catch (err) {
			return failure('create', err, 'Could not create the destination. Try again.');
		}
	},

	update: async (event) => {
		await requireRole(event, ADMINS);
		const form = await event.request.formData();
		const id = text(form, 'id');
		if (!id) return fail(400, { action: 'update', error: 'This form is missing its destination. Reload the page and try again.' });
		const body = common(form);
		const refused = missing('update', body);
		if (refused) return refused;
		const secret = text(form, 'secret');
		try {
			await updateSink(authedClient(event), id, { ...body, ...(secret ? { secret } : {}) });
		} catch (err) {
			return failure('update', err, 'Could not save the destination. Try again.');
		}
		return { saved: body.name };
	},

	delete: asked(
		{
			question: 'Delete this destination?',
			detail: 'The destination stops receiving the audit log. Entries already sent stay where they are.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ADMINS);
			const form = await event.request.formData();
			const id = text(form, 'id');
			if (!id) return fail(400, { action: 'delete', error: 'This form is missing its destination. Reload the page and try again.' });
			try {
				await deleteSink(authedClient(event), id);
			} catch (err) {
				return failure('delete', err, 'Could not delete the destination. Try again.');
			}
			return { deleted: true };
		},
	),

	test: async (event) => {
		await requireRole(event, ADMINS);
		const form = await event.request.formData();
		const id = text(form, 'id');
		if (!id) return fail(400, { action: 'test', error: 'This form is missing its destination. Reload the page and try again.' });
		try {
			const res = await testSink(authedClient(event), id);
			return { tested: id, delivered: res.delivered, testError: res.error ?? '' };
		} catch (err) {
			return failure('test', err, 'Could not send the test. Try again.');
		}
	},
};
