import type { PageServerLoad, Actions } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Schema } from '@lyeve-labs/client';
import { getSchema } from '@lyeve-labs/client-rest';
import { authedClient, requireUser, stripProtectedFields } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { readError } from '$lib/server/read-error';
import { setEntryRelations } from '$lib/server/content-relations';
import { fieldRefusalOf } from '$lib/server/content-validation';
import { entryIdentity } from '$lib/utils/new-entry';
import { listMediaChoices, type MediaChoice } from '$lib/api/media';
import { getLocales } from '$lib/api/localization';
import { section, type Section } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import { rolesInWords } from '$lib/roles';
import { PLUGIN } from '$lib/plugin-names';
import { runs } from '$lib/plugins';
import { readRelationChoices } from '$lib/server/relation-choices';

/** One locale the new entry can be written in. */
type LocaleChoice = { code: string; name: string; is_default: boolean };

const LOCALES_FAILED = couldNotLoad('the locales');

/** The roles the create route admits. */
const CREATORS = ['admin', 'super_admin'];

export const load: PageServerLoad = async (event) => {
	const { params, parent } = event;
	const client = authedClient(event);
	const { plugins, user } = await parent();
	// The create route admits an admin and a super admin only. The schema read
	// admits any signed-in reader, so without this an editor would get a whole
	// form whose Create the engine then refuses.
	if (!user.roles.some((role) => CREATORS.includes(role))) {
		error(403, `Only ${rolesInWords(CREATORS)} can open this page.`);
	}

	let schemaDef: Schema;
	try {
		schemaDef = await getSchema(params.schema, client);
	} catch (err) {
		readError(err, `Content type "${params.schema}" not found`);
	}

	// The locale routes belong to the localization plugin. Without it there is
	// no locale to pick, and a read of them would only be refused. A read that
	// fails while the plugin runs is said so beside the form.
	const locales: Section<LocaleChoice[]> | null =
		schemaDef.with_localization && runs(plugins, PLUGIN.localization)
			? await section(
					getLocales(client).then((prefs) =>
						prefs.enabled_locales.map((code) => ({
							code,
							name: code,
							is_default: code === prefs.default_locale,
						})),
					),
					LOCALES_FAILED,
				)
			: null;

	// The pickers read the admin store, the one this form writes to. The
	// public content routes read a different store, so an entry made here
	// would not be in a picker fed from them.
	const relations = await readRelationChoices(client, schemaDef.fields ?? []);

	// Published library files, for a media field's picker. Read only when
	// the schema has one. A read that fails is null, so the picker says the
	// library could not be read instead of claiming nothing is published.
	const mediaChoices: MediaChoice[] | null = schemaDef.fields.some((f) => f.field_type === 'media')
		? await listMediaChoices(client).catch(() => null)
		: [];

	return { schemaDef, relations, locales, mediaChoices };
};

/**
 * Create the entry in the store the rest of the section reads.
 *
 * Content has two stores. The admin store (sys_content_entries) is what every
 * other page in this section talks to: the listing, the editor, publish,
 * rollback, revisions, translations, relationships and delete. The v1 routes
 * read the schema engine's per-schema tables, which nothing in the admin
 * writes to or reads from.
 *
 * So this action writes to the admin store. An entry created through the v1
 * route lands in a store the admin never looks at: the listing would say "No
 * entries yet" over it, and it could not be opened, edited, published or
 * deleted from the admin at all. The relations write below carries the new
 * id, so it has to name the same store.
 */
export const actions: Actions = {
	default: async (event) => {
		await requireUser(event);
		const { request, params, fetch, cookies } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const raw = form.get('data') as string;
		const m2mRaw = form.get('m2m_relations') as string | null;
		let schemaDef: Schema | null = null;
		let created = '';
		let links: Record<string, string[]> | null = null;
		try {
			const data = stripProtectedFields(JSON.parse(raw) as Record<string, unknown>);
			links = m2mRaw ? (JSON.parse(m2mRaw) as Record<string, string[]>) : null;
			schemaDef = await getSchema(params.schema, client).catch(() => null);
			const { title, slug } = entryIdentity(data, schemaDef?.fields ?? []);

			// title and slug are columns on the entry and stay in the body as
			// well. The engine validates the body against the schema, so a title
			// held only as a column fails the schema's own required check, and
			// the listing overlays the column on the body, so one held only in
			// the body never reads back. The editor writes it twice for the same
			// reason. Status is left unset: the store opens an entry as a draft,
			// and publishing is its own action with its own role check.
			const item = await client.post<{ id: string }>('/api/admin/content', {
				schema: params.schema,
				title,
				slug,
				body: data,
			});
			created = item?.id ?? '';
		} catch (err) {
			const shown = (schemaDef?.fields ?? []).filter((f) => !f.system).map((f) => f.name);
			const refused = fieldRefusalOf(err, shown);
			if (refused) return fail(422, refused);
			return actionFailure(err, 'Could not create the entry. Try again.');
		}

		// The entry exists once the create answered, so a refused link is
		// reported beside its id. Sending the form again would create a second
		// entry, and a redirect to the list would read as a full success.
		if (links && created) {
			const failed = await setEntryRelations(event, created, links);
			if (failed) {
				return fail(400, { error: `Entry created. ${failed}`, created });
			}
		}
		redirect(303, `/admin/content/${params.schema}`);
	},
};
