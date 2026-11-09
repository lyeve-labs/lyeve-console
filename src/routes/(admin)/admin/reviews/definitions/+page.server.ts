import type { PageServerLoad, Actions } from './$types';
import { error, fail } from '@sveltejs/kit';
import { getSchemas } from '@lyeve-labs/client-rest';
import { authedClient, requireRole } from '$lib/server/authz';
import { parseStages } from '$lib/review/definition-form';
import { actionFailure, tagged } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { forbiddenText, section, type Section } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import { createDefinition, deleteDefinition, type ReviewLimits } from '$lib/api/review';
import { DEFINITIONS_FAILED, OPERATORS, loadDefinitions, loadPeople, type DefinitionRow } from '../reads.server';
import { asked } from '$lib/server/asked';

/** What the page renders. */
export type DefinitionsPage = {
	/** The definitions with their stages. */
	definitions: Section<DefinitionRow[]>;
	/**
	 * What the definitions read says this install allows: the paid stage
	 * settings and the workflow ceiling. Null when the read carried neither.
	 */
	limits: ReviewLimits | null;
	/** The schemas a definition can review. */
	schemas: Section<string[]>;
	/** Each account's email by its id, for the escalation picker. */
	people: Record<string, string>;
};

const SCHEMAS_FAILED = couldNotLoad('content types');

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	// The definitions are an administrator's setup, and the plugin takes
	// their reads and writes from an administrator only.
	if (!user.roles.some((role) => OPERATORS.includes(role))) {
		error(403, forbiddenText('this page', OPERATORS));
	}
	const none: Section<never[]> = { ok: true, value: [] };
	const page: DefinitionsPage = { definitions: none, limits: null, schemas: none, people: {} };
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.review)) return page;

	const client = authedClient(event);
	const [definitions, schemas, people] = await Promise.all([
		section(loadDefinitions(client), DEFINITIONS_FAILED),
		section(
			getSchemas(client).then((rows) => rows.map((s) => s.name)),
			SCHEMAS_FAILED,
		),
		loadPeople(client, user, true),
	]);

	if (definitions.ok) {
		page.definitions = { ok: true, value: definitions.value.rows };
		page.limits = definitions.value.limits;
	} else {
		page.definitions = definitions;
	}
	page.schemas = schemas;
	page.people = people;
	return page;
};

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, OPERATORS);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		const slug = String(form.get('slug') ?? '').trim();
		const contentSchema = String(form.get('content_schema') ?? '').trim();
		const publishOnApprove = form.get('publish_on_approve') !== 'false';
		if (!name) return fail(400, { action: 'create', error: 'Check the highlighted fields.', fields: { name: 'Enter a name.' } });
		const parsed = parseStages(String(form.get('stages') ?? '[]'));
		if ('error' in parsed) return fail(400, { action: 'create', error: parsed.error });
		try {
			await createDefinition(authedClient(event), {
				name,
				slug: slug || undefined,
				content_schema: contentSchema,
				publish_on_approve: publishOnApprove,
				stages: parsed.stages,
			});
		} catch (err) {
			// A 402 is the workflow ceiling or a paid stage setting, and the
			// drawer renders the plugin's own numbers or capability.
			return tagged('create', actionFailure(err, 'Could not create the definition. Try again.'));
		}
		return { created: true };
	},

	delete: asked(
		{
			question: 'Delete this definition?',
			detail: 'Its assignments, their history and their comments go with it.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, OPERATORS);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '').trim();
			if (!id) return fail(400, { action: 'delete', error: 'This form is missing its definition. Reload the page and try again.' });
			try {
				await deleteDefinition(authedClient(event), id);
			} catch (err) {
				return tagged('delete', actionFailure(err, 'Could not delete the definition. Try again.'));
			}
			return { deleted: true };
		},
	),
};
