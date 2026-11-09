import type { PageServerLoad } from './$types';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { authedClient } from '$lib/server/authz';
import { introspect, type SchemaRoots } from '$lib/api/graphql';
import { type Gate, GATE_OK, section, type Section } from '$lib/api/gate';

type Schema = { roots: SchemaRoots | null; refused: string | null };

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.graphql)) {
		const absent: Gate = { state: 'absent' };
		return { gate: absent, schema: { ok: false, gate: absent } as Section<Schema> };
	}
	// A failed schema read is the section's, so the endpoints still show.
	const schema = await section(introspect(authedClient(event)), 'Could not load the GraphQL schema.');
	return { gate: GATE_OK, schema };
};
