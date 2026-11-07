/**
 * Where builder forms may send: the content types and flows an administrator
 * allows in the builder settings, and what each is checked against here.
 *
 * The builder plugin checks only the shape of a flow slug, because nothing
 * lets a plugin list flows. The console reads the flows, so it is the one
 * place that can say an allowed slug no longer names a flow a form can start.
 */
import type { HttpClient } from '@lyeve-labs/client';
import { getFlow, listFlows, type Flow } from '$lib/api/flows';
import type { FlowDefinition, FlowStatus } from '$lib/flow/types';

/** The system event a flow subscribes to so that a form can start it. */
export const FORM_EVENT = 'builder.form.submitted';

/** The schema preset whose submissions type holds what visitors send. */
export const FORMS_PRESET = 'forms';
export const FORM_SUBMISSIONS = 'form_submissions';

/** A content type a form may be allowed to send to. */
export interface FormSchemaOption {
	name: string;
	label: string;
}

/** A flow as the settings need it: whether a form can start it and whether it runs. */
export interface FlowTarget {
	id: string;
	slug: string;
	name: string;
	status: FlowStatus;
	/** The flow's trigger is the builder form event. Null when its trigger could not be read. */
	formTrigger: boolean | null;
}

/** The engine caps a page of flows at this many rows. */
const FLOW_PAGE = 200;

/** The most trigger reads in flight at once, so a tenant with many event flows does not meet the rate limit. */
const TRIGGER_READS = 8;

/** Whether a trigger is the system event a form publishes. */
function startsFromForm(def: FlowDefinition | undefined): boolean {
	const t = def?.trigger;
	return t?.type === 'trigger.event' && t.config?.kind === 'system' && t.config?.name === FORM_EVENT;
}

/**
 * Every flow of the tenant, up to `cap`, each marked with whether a form can
 * start it. The list carries only the trigger's type, so each flow on an
 * event trigger is read once more: its published version when it has one,
 * else its draft. A read that fails leaves that flow's trigger unknown.
 */
export async function readFlowTargets(client: HttpClient, cap = 1000): Promise<FlowTarget[]> {
	const rows: Flow[] = [];
	for (let offset = 0; offset < cap; offset += FLOW_PAGE) {
		const page = await listFlows(client, { limit: FLOW_PAGE, offset });
		rows.push(...page.rows);
		if (page.rows.length < FLOW_PAGE) break;
	}
	const out: FlowTarget[] = rows.slice(0, cap).map((f) => ({
		id: f.id,
		slug: f.slug,
		name: f.name || f.slug,
		status: f.status,
		formTrigger: f.trigger_type === 'trigger.event' ? null : false,
	}));
	const pending = out.map((t, i) => ({ t, f: rows[i] })).filter(({ t }) => t.formTrigger === null);
	const worker = async () => {
		for (let next = pending.shift(); next; next = pending.shift()) {
			const { t, f } = next;
			try {
				const def =
					f.version > 0
						? (await client.get<{ definition?: FlowDefinition }>(`/api/admin/flows/${encodeURIComponent(f.id)}/versions/${f.version}`)).definition
						: (await getFlow(client, f.id)).draft;
				t.formTrigger = startsFromForm(def);
			} catch {
				// One unreadable flow leaves its trigger unknown rather than failing every other.
				t.formTrigger = null;
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(TRIGGER_READS, pending.length) }, worker));
	return out;
}

/** Why a form sending to `slug` starts nothing, or null when it starts the flow or its trigger is unknown. */
export type FlowProblem = 'missing' | 'trigger' | 'blocked' | 'inactive';

export function flowProblem(slug: string, flows: readonly FlowTarget[]): FlowProblem | null {
	const f = flows.find((x) => x.slug === slug);
	if (!f) return 'missing';
	if (f.formTrigger === false) return 'trigger';
	if (f.status === 'blocked') return 'blocked';
	if (f.status !== 'active') return 'inactive';
	return null;
}

/** What the settings say beside an allowed flow that a form cannot start. */
export const FLOW_NOTE: Record<FlowProblem, string> = {
	missing: 'No flow uses this slug any more. Clear it, then save.',
	trigger: 'This flow does not start from a builder form, so forms cannot start it.',
	blocked: 'This flow uses a step that is no longer available, so forms that send to it start nothing.',
	inactive: 'This flow is not active, so forms that send to it start nothing.',
};

/** What the settings say beside a flow whose trigger could not be read. */
export const FLOW_UNCHECKED = 'Could not check whether this flow starts from a builder form.';

/** One option of the flow list, with the reason beside it when a form cannot start it. */
export interface FlowOption {
	value: string;
	label: string;
	description?: string;
}

/**
 * The flows the settings offer: every flow a form can start, and every
 * allowed slug a form cannot start with the reason beside it, so it can be
 * cleared. A flow whose trigger could not be read is listed only when it is
 * allowed already, so a save keeps it.
 */
export function flowOptions(flows: readonly FlowTarget[], allowed: readonly string[]): FlowOption[] {
	const rows: FlowOption[] = flows
		.filter((f) => f.formTrigger === true || (f.formTrigger === null && allowed.includes(f.slug)))
		.map((f) => {
			const problem = flowProblem(f.slug, flows);
			return {
				value: f.slug,
				label: f.name,
				description: f.formTrigger === null ? FLOW_UNCHECKED : problem ? FLOW_NOTE[problem] : undefined,
			};
		});
	for (const slug of allowed) {
		const problem = flowProblem(slug, flows);
		if (problem === 'missing' || problem === 'trigger') {
			rows.push({ value: slug, label: flows.find((f) => f.slug === slug)?.name ?? slug, description: FLOW_NOTE[problem] });
		}
	}
	return rows;
}

/** The content types forms may send to, the preset's submissions type first. */
export function formSchemaOptions(rows: readonly FormSchemaOption[]): FormSchemaOption[] {
	return [...rows].sort((a, b) =>
		a.name === FORM_SUBMISSIONS ? -1 : b.name === FORM_SUBMISSIONS ? 1 : a.label.localeCompare(b.label),
	);
}
