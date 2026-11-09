import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	createTemplate,
	deleteTemplate,
	updateTemplate,
	type FieldMapping,
	type ImportSchema,
	type SaveMappingTemplate,
} from '$lib/api/bulk-import';
import { type Gate, GATE_OK, type Section } from '$lib/api/gate';
import { readSchemas, readTemplates } from '../reads.server';
import { asked } from '$lib/server/asked';

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.bulkImport)) {
		const gate: Gate = { state: 'absent' };
		return {
			gate,
			schemas: { ok: false, gate } as Section<ImportSchema[]>,
			templates: [],
			templatesRead: false,
			templatesGate: null as Gate | null,
			licensed: null as boolean | null,
		};
	}

	const client = authedClient(event);
	const [schemas, templates] = await Promise.all([readSchemas(client), readTemplates(client)]);
	return {
		gate: GATE_OK as Gate,
		schemas,
		templates: templates.rows,
		templatesRead: templates.read,
		templatesGate: templates.gate,
		licensed: templates.licensed,
	};
};

/** Reads the template drawer. A string is the message for a refused one. */
function templateBody(form: FormData): SaveMappingTemplate | string {
	const name = String(form.get('name') ?? '').trim();
	if (!name || name.length > 255) return 'Enter a template name of up to 255 characters.';
	const contentType = String(form.get('content_type') ?? '').trim();
	if (!contentType) return 'Choose the content type the template maps onto.';
	const mode = form.get('mode') === 'upsert' ? 'upsert' : 'create';
	const upsertKey = String(form.get('upsert_key') ?? '').trim();
	if (mode === 'upsert' && !upsertKey) return 'Choose a key field to create and update entries.';
	let mappings: FieldMapping[];
	try {
		mappings = JSON.parse(String(form.get('mappings') ?? '[]')) as FieldMapping[];
	} catch {
		return 'Could not read the mapping. Reload the page and try again.';
	}
	if (!Array.isArray(mappings) || mappings.length === 0) return 'Map at least one column.';
	if (mappings.length > 500) return 'A template can map up to 500 columns.';
	if (mappings.some((m) => !m || typeof m.source_field !== 'string' || !m.source_field.trim() || !m.target_field)) {
		return 'Give every mapping a column in the file and the field it fills.';
	}
	return {
		name,
		content_type: contentType,
		mode,
		...(upsertKey ? { upsert_key: upsertKey } : {}),
		field_mappings: mappings,
	};
}

async function saveTemplate(event: Parameters<Actions[string]>[0], id: string | null) {
	await requireRole(event, ['admin', 'super_admin']);
	const form = await event.request.formData();
	const body = templateBody(form);
	if (typeof body === 'string') return fail(400, { action: 'saveTemplate', error: body });
	try {
		if (id) await updateTemplate(authedClient(event), id, body);
		else await createTemplate(authedClient(event), body);
	} catch (err) {
		return tagged('saveTemplate', actionFailure(err, 'Could not save the template. Try again.'));
	}
	return { savedTemplate: body.name };
}

export const actions: Actions = {
	createTemplate: (event) => saveTemplate(event, null),

	updateTemplate: async (event) => {
		const form = await event.request.clone().formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'saveTemplate', error: 'This form is missing its template. Reload the page and try again.' });
		return saveTemplate(event, id);
	},

	// Deleting a template is always allowed.
	deleteTemplate: asked(
		{
			question: 'Delete this template?',
			detail: 'Imports that already used it keep their history.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			if (!id) return fail(400, { action: 'deleteTemplate', error: 'This form is missing its template. Reload the page and try again.' });
			try {
				await deleteTemplate(authedClient(event), id);
			} catch (err) {
				return tagged('deleteTemplate', actionFailure(err, 'Could not delete the template. Try again.'));
			}
			return { removedTemplate: id };
		},
	),
};
