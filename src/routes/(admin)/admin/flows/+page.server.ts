import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient, authedHeaders, requireUser } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { readImportForm } from '$lib/server/flow-import';
import { flowClient } from '$lib/server/flow-client';
import { forbiddenFailure } from '$lib/server/flow-forbidden';
import { refusalFailure } from '$lib/server/flow-refusal';
import { flowLoadOutcome } from '$lib/server/flow-load';
import { couldNotLoad } from '$lib/outage';
import { GATE_OK, gateOf, type Gate } from '$lib/api/gate';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import {
	ImportError,
	FlowRefusal,
	createFlow,
	deleteFlow,
	importFlow,
	listFlows,
	validationErrors,
	type Flow,
	type ImportResult,
} from '$lib/api/flows';
import { asked } from '$lib/server/asked';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 199;

/** The outcome of an import that met a 5xx or a dropped connection, which claims nothing about the flow. */
const UNCERTAIN_IMPORT = 'Could not import the flow. Check whether it appears in the list, then try again.';

/** The statuses the list filters by. Anything else in the address is no filter. */
const STATUSES: readonly string[] = ['draft', 'active', 'disabled', 'blocked'];

function isLocked(err: unknown): boolean {
	return err instanceof ApiError && err.status === 402;
}

export const load: PageServerLoad = async (event) => {
	const { cookies, url } = event;
	const client = authedClient(event);
	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);
	// A status the list does not know would select no chip and still filter
	// the list, so it reads as no filter.
	const raw = url.searchParams.get('status') ?? '';
	const status = STATUSES.includes(raw) ? raw : '';
	const q = url.searchParams.get('q') ?? '';

	// One row past the page answers "is there another page" when the endpoint
	// states no total. It is never rendered.
	let locked = false;
	// Why the list could not be read: a role the plugin refuses, an outage or
	// a failure. Each says so in its own words and offers nothing to create.
	let gate: Gate = GATE_OK;
	let flows: Flow[] = [];
	let total: number | null = null;
	let hasMore = false;
	// Whether the caller may create rides beside the list. A failed read
	// leaves it allowed: the engine decides, and its refusal renders.
	let canCreate = true;
	try {
		const page = await listFlows(client, { limit: limit + 1, offset, status, q });
		canCreate = page.canCreate;
		flows = page.rows.slice(0, limit);
		total = page.total;
		hasMore = total === null ? page.rows.length > limit : offset + flows.length < total;
	} catch (err) {
		({ locked } = flowLoadOutcome(err, { cookies, url }, 'flows'));
		if (!locked) gate = gateOf(err, couldNotLoad('flows'));
	}

	const back = pastEndOffset(flows.length, limit, offset, total);
	if (back !== null) redirect(307, withOffset(url, back));

	return {
		flows,
		limit,
		offset,
		total,
		hasMore,
		status,
		q,
		locked,
		gate,
		canCreate,
	};
};

/** The 422 shape, surfaced as a form failure the page can list. */
function validationFailure(err: unknown, fallback: string) {
	if (err instanceof ApiError && err.status === 422) {
		return fail(422, { error: 'Fix the problems in the definition.', errors: validationErrors(err.message) });
	}
	if (err instanceof ImportError && err.status === 422) {
		return fail(422, { error: 'Fix the problems in the definition.', errors: validationErrors(err.body) });
	}
	if (err instanceof FlowRefusal) return refusalFailure(err);
	if (isLocked(err)) return fail(402, { error: 'Flows are not enabled on this engine.', locked: true });
	if (err instanceof ApiError && err.status === 403) return forbiddenFailure(err);
	const failed = actionFailure(err, fallback);
	return fail(failed.status, failed.data);
}

export const actions: Actions = {
	create: async (event) => {
		await requireUser(event);
		const client = flowClient(event);
		const data = await event.request.formData();
		const name = String(data.get('name') ?? '').trim();
		const slug = String(data.get('slug') ?? '').trim();
		if (!name || !slug) return fail(400, { action: 'create', error: 'Enter a name and a slug.' });

		// A name and a slug, nothing else: the flow starts empty and the editor
		// offers the palette, the templates and an import once it is open.
		let created: Flow;
		try {
			created = await createFlow(client, { name, slug });
		} catch (err) {
			// The plugin answers a slug another flow holds with 409 and a
			// static sentence that does not say so.
			if (err instanceof ApiError && err.status === 409) {
				return fail(409, { action: 'create', error: 'Another flow already uses this slug. Choose another.', field: 'slug' });
			}
			return tagged('create', validationFailure(err, 'Could not create the flow. Try again.'));
		}
		redirect(303, `/admin/flows/${encodeURIComponent(created.id)}`);
	},

	delete: asked(
		{
			question: 'Delete this flow?',
			detail: 'Its versions and run history go with it.',
			label: 'Delete',
		},
		async (event) => {
			await requireUser(event);
			const client = authedClient(event);
			const data = await event.request.formData();
			const id = String(data.get('id') ?? '');
			try {
				await deleteFlow(client, id);
			} catch (err) {
				if (err instanceof ApiError && err.status === 403) return tagged('delete', forbiddenFailure(err));
				return tagged('delete', actionFailure(err, 'Could not delete the flow. Try again.'));
			}
		},
	),

	import: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const mode = data.get('mode') === 'replace' ? 'replace' : 'create';
		const slug = String(data.get('slug') ?? '').trim() || undefined;

		const body = await readImportForm(data);
		if (!body) return fail(400, { action: 'import', error: 'Paste a definition or choose a file.' });
		if (mode === 'replace' && !slug) return fail(400, { action: 'import', error: 'Enter the slug of the flow to replace.' });

		let result: ImportResult;
		try {
			result = await importFlow(event.fetch, { ...body, mode, slug }, authedHeaders(event));
		} catch (err) {
			if (err instanceof FlowRefusal) return tagged('import', refusalFailure(err));
			if (err instanceof ImportError && err.status === 402) {
				return fail(402, { action: 'import', error: 'Flows are not enabled on this engine.', locked: true });
			}
			if (err instanceof ImportError && err.status < 500) {
				if (err.status === 422) return tagged('import', validationFailure(err, 'Could not import the flow. Try again.'));
				return fail(400, { action: 'import', error: err.code && err.message ? err.message : 'Could not import the flow. Try again.' });
			}
			// A 5xx or a dropped connection may follow a create that landed.
			return fail(502, { action: 'import', error: UNCERTAIN_IMPORT });
		}
		const unresolved = result.unresolved_datasources ?? [];
		if (unresolved.length > 0) {
			return { imported: { id: result.id, name: result.name, unresolved } };
		}
		redirect(303, `/admin/flows/${encodeURIComponent(result.id)}`);
	},
};
