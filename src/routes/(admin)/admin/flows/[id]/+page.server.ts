import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect, type ActionFailure } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { getSchemas } from '@lyeve-labs/client-rest';
import { authedClient, authedHeaders, requireUser } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { readImportForm } from '$lib/server/flow-import';
import { flowClient } from '$lib/server/flow-client';
import { forbiddenFailure } from '$lib/server/flow-forbidden';
import { refusalFailure } from '$lib/server/flow-refusal';
import { assistRefusal, catalogFor, refusalStatus } from '$lib/server/flow-assist';
import { CatalogError, assistFlow, explainFlow, getLLMCatalog, type AssistProblem } from '$lib/api/assist';
import { clearSessionCookie } from '$lib/server/session-cookie';
import { readError } from '$lib/server/read-error';
import {
	ImportError,
	FlowRefusal,
	deleteFlow,
	disableFlow,
	getCatalog,
	getEventTypes,
	getFlow,
	getRun,
	getTemplates,
	importFlow,
	listDatasources,
	listPublishedFlows,
	listRuns,
	listVariables,
	listVersions,
	publishFlow,
	rollbackFlow,
	saveDraft,
	validationErrors,
	type ValidationError,
	type Flow,
	type FlowRun,
	type FlowVersion,
	deleteTemplate,
	saveTemplate,
} from '$lib/api/flows';
import { unfillableFields } from '$lib/flow/fill';
import { emptyDefinition, type FlowDefinition, type SchemaOption } from '$lib/flow/types';
import { normalizeDefinition } from '$lib/flow/graph';
import type { HttpClient } from '@lyeve-labs/client';
import { pageWindow, pastEndOffset, rowsOf, withOffset, type PagedList } from '$lib/api/list';
import { GATE_OK, gateOf, section, type Gate, type Section } from '$lib/api/gate';
import type { NodeSpec } from '$lib/flow/types';

/**
 * The page renders in the browser only. Its flow editor then never
 * enters the server build, and the server answers with the page's data alone.
 */
export const ssr = false;

/** The runs tab pages through a flow's runs this many at a time. */
const RUNS_PER_PAGE = 20;

const LOCKED = {
	locked: true as const,
	flow: null,
	catalog: [],
	catalogGate: GATE_OK,
	datasources: [],
	datasourcesGate: GATE_OK,
	variables: [],
	variablesGate: GATE_OK,
	schemas: [],
	flows: [],
	eventTypes: null,
	runs: { ok: true, value: { rows: [], limit: RUNS_PER_PAGE, offset: 0, total: 0, hasMore: false } } as Section<PagedList<FlowRun>>,
	versions: { ok: true, value: [] } as Section<FlowVersion[]>,
	templates: [],
	assistant: 'hidden' as const,
};

export const load: PageServerLoad = async (event) => {
	const { fetch, cookies, params, url } = event;
	const client = authedClient(event);

	let flow: Flow;
	try {
		flow = await getFlow(client, params.id);
	} catch (err) {
		if (err instanceof ApiError && err.status === 402) return LOCKED;
		// An expired session goes where the shell sends one, not to an error page.
		if (err instanceof ApiError && err.status === 401) {
			clearSessionCookie({ cookies, url });
			redirect(302, '/login');
		}
		readError(err, 'Flow not found');
	}
	if (!flow?.id) error(404, 'Flow not found');

	// The runs tab pages by the address, so a page of runs is a link.
	const { offset: runsOffset } = pageWindow(url, RUNS_PER_PAGE, RUNS_PER_PAGE);

	// The catalog is the one read the editor cannot do without: the palette
	// and every inspector form come from it, so a failed read keeps its gate
	// and the editor says the node types could not be read. The rest degrade
	// to empty.
	let loaded;
	try {
		loaded = await Promise.all([
			getCatalog(client).then(
				(catalog): { catalog: NodeSpec[]; gate: Gate } => ({ catalog, gate: GATE_OK }),
				(err: unknown) => ({
					catalog: [] as NodeSpec[],
					gate: gateOf(err, 'Could not load node types.'),
				}),
			),
			// A failed read of the names is kept, so the node form and the
			// inspector never say a tenant has none when they were not read.
			section(listDatasources(client).then((list) => list.rows), 'Could not load datasources.'),
			section(listVariables(client, 500, 0), 'Could not load variables.'),
			// The pickers read the content schemas, the published flows and the
			// event types. A failed read leaves each picker as free text, which
			// is the escape it carries anyway. An engine without the event-types
			// route lands here too. A 402 locks the page the way one on the flow
			// itself does.
			getSchemas(client).catch(() => []),
			listPublishedFlows(client).catch(() => []),
			getEventTypes(client).catch((err: unknown) => {
				if (err instanceof ApiError && err.status === 402) throw err;
				return null;
			}),
			// One row past the page says whether another page follows when the
			// plugin states no total.
			section(
				listRuns(client, flow.id, { limit: RUNS_PER_PAGE + 1, offset: runsOffset }).then(
					(p): PagedList<FlowRun> => {
						const rows = p.rows.slice(0, RUNS_PER_PAGE);
						const hasMore = p.total === null ? p.rows.length > RUNS_PER_PAGE : runsOffset + rows.length < p.total;
						return { rows, limit: RUNS_PER_PAGE, offset: runsOffset, total: p.total, hasMore };
					},
				),
				'Could not load runs.',
			),
			section(listVersions(client, flow.id), 'Could not load versions.'),
			getTemplates(client).catch(() => []),
			// The assistant's catalog decides whether the tab exists at all: a
			// 402 there means the assistant is not enabled, and a tab that could
			// only say so is better left out. Any other refusal is reported when
			// the reader asks, not on every load.
			getLLMCatalog(fetch, authedHeaders(event))
				.then(() => 'ready' as const)
				.catch((err: unknown) => (err instanceof CatalogError && err.status === 402 ? ('hidden' as const) : ('ready' as const))),
		]);
	} catch {
		return LOCKED;
	}
	const [read, datasources, variables, schemas, flows, eventTypes, runs, versions, templates, assistant] = loaded;

	if (runs.ok) {
		const back = pastEndOffset(runs.value.rows.length, RUNS_PER_PAGE, runsOffset, runs.value.total);
		if (back !== null) redirect(307, withOffset(url, back));
	}

	const schemaOptions: SchemaOption[] = schemas.map((s) => ({
		name: s.name,
		display_name: s.display_name || s.name,
		fields: (s.fields ?? []).map((f) => f.name),
		unfillable: unfillableFields(s.fields ?? []),
	}));

	return {
		locked: false as const,
		flow: { ...flow, draft: normalizeDefinition(flow.draft ?? emptyDefinition(flow.name, flow.slug)) },
		catalog: read.catalog,
		catalogGate: read.gate,
		datasources: datasources.ok ? datasources.value.map((d) => ({ id: d.id, name: d.name, kind: d.kind })) : [],
		datasourcesGate: datasources.ok ? GATE_OK : datasources.gate,
		variables: variables.ok ? rowsOf(variables.value).map((v) => v.key) : [],
		variablesGate: variables.ok ? GATE_OK : variables.gate,
		schemas: schemaOptions,
		flows,
		eventTypes,
		runs,
		versions,
		templates,
		assistant,
	};
};

/** The definition a form carries, or null when it is not JSON. */
function definitionField(data: FormData): FlowDefinition | null {
	try {
		return JSON.parse(String(data.get('definition') ?? '')) as FlowDefinition;
	} catch {
		return null;
	}
}

/**
 * An import's failure, tagged so the import drawer shows it and the notice
 * above the canvas does not draw it a second time behind the open drawer.
 */
function importFailed<F extends ActionFailure<Record<string, unknown>>>(failure: F) {
	return fail(failure.status, { ...(failure.data as F['data']), action: 'import' });
}

/**
 * The sentence for a 409 the plugin answered in the validation shape: a slug
 * another flow holds, or an HTTP path another flow answers.
 */
function conflictText(errors: ValidationError[]): string {
	if (errors.some((e) => e.path === '/slug')) return 'Another flow already uses this slug. Choose another.';
	if (errors.some((e) => e.path === '/config/path')) return 'Another flow already uses this HTTP path. Choose another path for the trigger.';
	return 'This conflicts with another flow.';
}

function refused(err: unknown, fallback: string) {
	if (err instanceof ApiError && err.status === 422) {
		return fail(422, { error: 'Fix the problems in the definition.', errors: validationErrors(err.message) });
	}
	// A conflict comes in the validation shape with no error key, so the list
	// is read the same way and marks what it names on the canvas.
	if (err instanceof ApiError && err.status === 409) {
		const errors = validationErrors(err.message);
		return fail(409, { error: conflictText(errors), errors });
	}
	if (err instanceof FlowRefusal) return refusalFailure(err);
	if (err instanceof ApiError && err.status === 402) {
		return fail(402, { error: 'Flows are not enabled on this instance.', locked: true });
	}
	if (err instanceof ApiError && err.status === 403) return forbiddenFailure(err);
	return fail(400, { error: actionError(err, fallback) });
}

/** What the page reseeds the canvas from once the server's draft has moved under it. */
interface Reloaded {
	draft: FlowDefinition;
	status: Flow['status'];
	version: number;
	updated_at: string;
	name: string;
	slug: string;
}

/**
 * The flow with its draft, for an action that changed the draft on the
 * server. A rollback or an import answers with the flow, and some answers
 * leave the draft out. One more read fills it, so the page never reseeds
 * from a draft it does not have.
 */
async function reloaded(client: HttpClient, id: string, answer: Flow): Promise<Reloaded> {
	const flow = answer.draft ? answer : await getFlow(client, id);
	return {
		draft: normalizeDefinition(flow.draft ?? emptyDefinition(flow.name, flow.slug)),
		status: flow.status,
		version: flow.version,
		updated_at: flow.updated_at,
		name: flow.name,
		slug: flow.slug,
	};
}

export const actions: Actions = {
	save: async (event) => {
		await requireUser(event);
		const client = flowClient(event);
		const data = await event.request.formData();
		let definition: FlowDefinition;
		try {
			definition = JSON.parse(String(data.get('definition') ?? '')) as FlowDefinition;
		} catch {
			return fail(400, { error: 'The definition is not valid JSON.' });
		}
		const name = String(data.get('name') ?? definition.name ?? '').trim();
		if (!name) return fail(400, { error: 'Enter a name for the flow.' });
		const slug = String(data.get('slug') ?? definition.slug ?? '').trim();
		definition = { ...definition, name, ...(slug ? { slug } : {}) };
		try {
			const flow = await saveDraft(client, event.params.id, {
				name,
				...(slug ? { slug } : {}),
				description: definition.description ?? '',
				definition,
			});
			return { saved: { updated_at: flow.updated_at, status: flow.status, version: flow.version, slug: flow.slug } };
		} catch (err) {
			return refused(err, 'Could not save the draft. Try again.');
		}
	},

	/**
	 * Publishes the draft. The form may carry the definition on the canvas, in
	 * which case it is saved first: publishing what the reader sees, not what
	 * the last save left behind, is the only reading of the button that does
	 * not surprise anyone.
	 */
	publish: async (event) => {
		await requireUser(event);
		const client = flowClient(event);
		const data = await event.request.formData();
		const raw = String(data.get('definition') ?? '').trim();
		try {
			if (raw) {
				const definition = JSON.parse(raw) as FlowDefinition;
				await saveDraft(client, event.params.id, {
					name: definition.name,
					...(definition.slug ? { slug: definition.slug } : {}),
					description: definition.description ?? '',
					definition,
				});
			}
			const flow = await publishFlow(client, event.params.id);
			return { published: { version: flow.version, status: flow.status, slug: flow.slug } };
		} catch (err) {
			return refused(err, 'Could not publish the flow. Try again.');
		}
	},

	disable: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		try {
			const flow = await disableFlow(client, event.params.id);
			return { disabled: { status: flow.status } };
		} catch (err) {
			return refused(err, 'Could not disable the flow. Try again.');
		}
	},

	rollback: async (event) => {
		await requireUser(event);
		const client = flowClient(event);
		const data = await event.request.formData();
		const version = Number(data.get('version'));
		if (!Number.isInteger(version) || version < 1) return fail(400, { error: 'Choose a version to roll back to.' });
		// The draft on the canvas is now the rolled-back version. It comes back
		// in the answer rather than through a redirect: a redirect to the route
		// the reader is on reuses the component, whose canvas keeps the old
		// draft and saves it back over the rollback.
		try {
			const flow = await rollbackFlow(client, event.params.id, version);
			return { reloaded: await reloaded(client, event.params.id, flow) };
		} catch (err) {
			return refused(err, 'Could not roll back the flow. Try again.');
		}
	},

	/**
	 * Replaces this flow's draft with a pasted or uploaded definition. The
	 * list page has the general import. This one is pinned to the flow on the
	 * canvas and answers with the new draft for the same reason rollback does.
	 */
	import: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const body = await readImportForm(data);
		if (!body) return fail(400, { action: 'import', error: 'Paste a definition or choose a file.' });
		let slug = String(data.get('slug') ?? '').trim();
		try {
			if (!slug) slug = (await getFlow(client, event.params.id)).slug;
			const result = await importFlow(event.fetch, { ...body, mode: 'replace', slug }, authedHeaders(event));
			return {
				reloaded: await reloaded(client, event.params.id, result),
				unresolved: result.unresolved_datasources ?? [],
			};
		} catch (err) {
			if (err instanceof ImportError && err.status === 422) {
				return fail(422, { action: 'import', error: 'Fix the problems in the definition.', errors: validationErrors(err.body) });
			}
			if (err instanceof FlowRefusal) return importFailed(refusalFailure(err));
			if (err instanceof ImportError && err.status === 402) {
				return fail(402, { action: 'import', error: 'Flows are not enabled on this instance.', locked: true });
			}
			if (err instanceof ImportError) {
				return fail(400, { action: 'import', error: err.status < 500 && err.message ? err.message : 'Could not import the flow. Try again.' });
			}
			return importFailed(refused(err, 'Could not import the flow. Try again.'));
		}
	},

	saveTemplate: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const url = String(data.get('url') ?? '').trim();
		const file = data.get('file');
		let document = String(data.get('document') ?? '').trim();
		if (!document && file instanceof File && file.size > 0) document = (await file.text()).trim();
		if (!url && !document) return fail(400, { templateError: 'Enter a URL, choose a file or paste a definition.' });
		if (url && document) return fail(400, { templateError: 'Enter a URL or a definition, not both.' });
		try {
			const saved = await saveTemplate(client, url ? { url } : { document });
			return { savedTemplate: saved.id };
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) {
				return fail(409, { templateError: 'A built-in template already uses that slug. Choose another slug.' });
			}
			if (err instanceof ApiError && err.status === 502) {
				return fail(502, { templateError: 'The URL did not return a flow definition.' });
			}
			if (err instanceof ApiError && err.status === 403) return fail(403, { templateError: 'Your role cannot create flows.' });
			return fail(400, { templateError: actionError(err, 'Could not save the template. Try again.') });
		}
	},

	deleteTemplate: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const id = String((await event.request.formData()).get('id') ?? '').trim();
		if (!id) return fail(400, { templateError: 'Choose a template.' });
		try {
			await deleteTemplate(client, id);
			return { deletedTemplate: id };
		} catch (err) {
			return fail(400, { templateError: actionError(err, 'Could not delete the template. Try again.') });
		}
	},

	delete: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		try {
			await deleteFlow(client, event.params.id);
		} catch (err) {
			return refused(err, 'Could not delete the flow. Try again.');
		}
		redirect(303, '/admin/flows');
	},

	/**
	 * Asks the assistant for a draft. The catalog is read here rather than
	 * carried by the form: it is the engine's to write and the browser has no
	 * reason to hold it. The draft comes back validated with what the
	 * validator still refuses, and nothing is written until the reader
	 * accepts it on the canvas and saves.
	 */
	assist: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const prompt = String(data.get('prompt') ?? '').trim();
		if (!prompt) return fail(400, { assistRefused: { state: 'error' as const, message: 'Describe what the flow should do.' } });
		const current = definitionField(data);
		if (!current) return fail(400, { assistRefused: { state: 'error' as const, message: 'The definition is not valid JSON.' } });
		const conversation = String(data.get('conversation_id') ?? '').trim();
		try {
			const catalog = await catalogFor(event);
			const draft = await assistFlow(client, {
				prompt,
				catalog,
				current,
				...(conversation ? { conversation_id: conversation } : {}),
			});
			return { assist: { prompt, draft } };
		} catch (err) {
			const refusal = assistRefusal(err);
			return fail(refusalStatus(refusal), { assistRefused: refusal });
		}
	},

	/**
	 * Asks the assistant about the flow on the canvas: a node, one of the
	 * validator's problems, or a question. Answers with Markdown the tab
	 * renders as elements, never as HTML.
	 */
	explain: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const definition = definitionField(data);
		if (!definition) return fail(400, { assistRefused: { state: 'error' as const, message: 'The definition is not valid JSON.' } });
		const nodeId = String(data.get('node_id') ?? '').trim();
		const question = String(data.get('question') ?? '').trim();
		const conversation = String(data.get('conversation_id') ?? '').trim();
		let problem: AssistProblem | undefined;
		const rawProblem = String(data.get('problem') ?? '').trim();
		if (rawProblem) {
			try {
				problem = JSON.parse(rawProblem) as AssistProblem;
			} catch {
				return fail(400, { assistRefused: { state: 'error' as const, message: 'The problem is not valid JSON.' } });
			}
		}
		if (!nodeId && !problem && !question) {
			return fail(400, { assistRefused: { state: 'error' as const, message: 'Choose a node or a problem to ask about.' } });
		}
		try {
			const catalog = await catalogFor(event);
			const answer = await explainFlow(client, {
				catalog,
				definition,
				...(nodeId ? { node_id: nodeId } : {}),
				...(problem ? { problem } : {}),
				...(question ? { question } : {}),
				...(conversation ? { conversation_id: conversation } : {}),
			});
			return { explain: { subject: nodeId || problem?.message || question, answer } };
		} catch (err) {
			const refusal = assistRefusal(err);
			return fail(refusalStatus(refusal), { assistRefused: refusal });
		}
	},

	/**
	 * One run with its steps. The list the page loads omits them, and opening
	 * a past run is a click, not a navigation, so it goes through an action
	 * the way the webhook page loads a delivery history.
	 */
	run: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const runId = String(data.get('run_id') ?? '');
		try {
			const run = await getRun(client, runId);
			return { run };
		} catch (err) {
			return fail(400, { error: actionError(err, 'Could not load the run. Try again.') });
		}
	},
};
