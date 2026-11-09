import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { isOutage, section } from '$lib/api/gate';
import { getSchemas } from '@lyeve-labs/client-rest';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { refusalOf } from '$lib/api/refusal';
import {
	createEmailTrigger,
	deleteEmailTrigger,
	listEmailTemplates,
	listEmailTriggers,
	triggerWriteRefusal,
	updateEmailTrigger,
} from '$lib/api/email-triggers';
import { readTriggerForm } from '$lib/server/email-trigger-form';
import { asked } from '$lib/server/asked';

export const load: PageServerLoad = async (event) => {
	const client = authedClient(event);
	// Each read keeps its own failure. A template list that did not answer is
	// not a tenant without templates, and a schema list that did not answer is
	// not an instance without schemas.
	const [triggers, templates, schemas, writeRefusal] = await Promise.all([
		section(listEmailTriggers(client), 'Could not load email triggers.'),
		section(listEmailTemplates(client), 'Could not load email templates.'),
		section(
			getSchemas(client).then((rows: { name: string }[]) => rows.map((s) => s.name).sort()),
			'Could not load content types, so a trigger can only watch every content type for now.',
		),
		triggerWriteRefusal(client),
	]);
	return { triggers, templates, schemas, writeRefusal };
};

/**
 * The failure of a trigger write, named for the action that caused it. A 402
 * keeps its refusal so the page can say what the license lacks, an outage
 * keeps its own status, and a field the plugin rejected keeps its 422.
 */
function writeFailure(action: 'save' | 'delete', err: unknown, fallback: string) {
	if (refusalOf(err)) {
		const refused = actionFailure(err, fallback);
		return fail(refused.status, { ...refused.data, action });
	}
	const status = isOutage(err) ? 503 : err instanceof ApiError && err.status === 422 ? 422 : 400;
	return tagged(action, actionFailure(err, fallback, status));
}

export const actions: Actions = {
	save: async (event) => {
		// The plugin serves trigger writes to admins and super admins.
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const data = await event.request.formData();
		const read = readTriggerForm(data);
		if ('error' in read) return fail(400, { action: 'save', error: read.error });
		const id = String(data.get('id') ?? '').trim();
		try {
			if (id) await updateEmailTrigger(client, id, read.input);
			else await createEmailTrigger(client, read.input);
			return { saved: true };
		} catch (err) {
			return writeFailure('save', err, 'Could not save the trigger. Try again.');
		}
	},

	delete: asked(
		{
			question: 'Delete this trigger?',
			detail: 'Mail stops going out for this event.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const client = authedClient(event);
			const id = String((await event.request.formData()).get('id') ?? '').trim();
			if (!id) return fail(400, { action: 'delete', error: 'This form is missing its trigger. Reload the page and try again.' });
			try {
				await deleteEmailTrigger(client, id);
				return { deleted: id };
			} catch (err) {
				return writeFailure('delete', err, 'Could not delete the trigger. Try again.');
			}
		},
	),
};
