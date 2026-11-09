import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { section, type Section } from '$lib/api/gate';
import {
	SAMPLE_VARS,
	TEMPLATE_KEY,
	createTemplate,
	deleteTemplate,
	listTemplates,
	previewTemplate,
	templateLimits,
	templateStarters,
	updateTemplate,
	type EmailTemplate,
	type TemplateLimits,
	type TemplateStarter,
	type TemplateStatus,
} from '$lib/api/email-templates';
import { asked } from '$lib/server/asked';

const STATUSES: TemplateStatus[] = ['draft', 'active', 'archived'];

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.email)) {
		return {
			templates: { ok: false, gate: { state: 'absent' } } as Section<EmailTemplate[]>,
			starters: { ok: true, value: [] } as Section<TemplateStarter[]>,
			limits: null as TemplateLimits | null,
		};
	}
	const client = authedClient(event);
	// The list first: it creates the required templates a new tenant does
	// not hold yet, and the count after it includes them.
	const templates = await section(listTemplates(client), 'Could not load email templates.');
	// A failed limits read states nothing, and the create still answers the
	// ceiling, so it is left out rather than shown.
	const [starters, limits] = await Promise.all([
		section(templateStarters(client), 'Could not load the ready-made templates, so only a blank one is available.'),
		templateLimits(client).catch((): TemplateLimits | null => null),
	]);
	return { templates, starters, limits };
};

const text = (data: FormData, key: string): string => String(data.get(key) ?? '').trim();

function status(data: FormData): TemplateStatus {
	const s = text(data, 'status') as TemplateStatus;
	return STATUSES.includes(s) ? s : 'active';
}

export const actions: Actions = {
	save: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const id = text(data, 'id');
		const subject = text(data, 'subject');
		// The body is the author's to the byte, so it is not trimmed.
		const body = String(data.get('mjml_source') ?? '');
		if (!subject) return fail(400, { action: 'save', error: 'Enter a subject.' });
		const client = authedClient(event);
		try {
			if (id) {
				await updateTemplate(client, id, { subject, mjml_source: body, status: status(data) });
				return { saved: id };
			}
			const key = text(data, 'key');
			if (!TEMPLATE_KEY.test(key)) {
				return fail(400, { action: 'save', error: 'Enter a name that starts with a letter and uses only lowercase letters, digits and dashes.' });
			}
			const created = await createTemplate(client, { key, subject, mjml_source: body, status: status(data) });
			return { saved: created.id };
		} catch (err) {
			// 409 on a create is a name the tenant already holds. The plugin's
			// sentence for a refused body (422) is written for the author.
			if (err instanceof ApiError && err.status === 409) return fail(409, { action: 'save', error: 'A template with that name already exists.' });
			return tagged('save', actionFailure(err, 'Could not save the template. Try again.', err instanceof ApiError && err.status === 422 ? 422 : 400));
		}
	},

	delete: asked(
		{
			question: 'Delete this template?',
			detail: 'A trigger or a flow that sends it stops sending.',
			label: 'Delete',
		},
		async (event) => {
			await requireUser(event);
			const id = text(await event.request.formData(), 'id');
			if (!id) return fail(400, { action: 'delete', error: 'This form is missing its template. Reload the page and try again.' });
			try {
				await deleteTemplate(authedClient(event), id);
				return { deleted: id };
			} catch (err) {
				return tagged('delete', actionFailure(err, 'Could not delete the template. Try again.', err instanceof ApiError && err.status === 409 ? 409 : 400));
			}
		},
	),

	preview: async (event) => {
		await requireUser(event);
		const key = text(await event.request.formData(), 'key');
		if (!key) return fail(400, { action: 'preview', error: 'This form is missing its template. Reload the page and try again.' });
		try {
			const out = await previewTemplate(authedClient(event), key, SAMPLE_VARS);
			return { preview: { key, subject: out.subject, html: out.html } };
		} catch (err) {
			return tagged('preview', actionFailure(err, 'Could not render the template. Check the body for an unclosed tag or a misspelled variable.'));
		}
	},
};
