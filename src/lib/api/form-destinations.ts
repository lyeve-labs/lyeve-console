/**
 * Where builder forms may send: the content types and flows an administrator
 * allows in the builder settings, and what each is checked against here.
 *
 * The builder plugin checks only the shape of a flow slug, because nothing
 * lets a plugin list flows. The console reads the flows, so it is the one
 * place that can say an allowed slug no longer names a flow a form can start.
 */
import type { HttpClient } from '@lyeve-labs/client';
import { listFlows, type Flow } from '$lib/api/flows';
import type { FlowStatus } from '$lib/flow/types';

/** The system event a flow subscribes to so that a form can start it. */
export const FORM_EVENT = 'builder.form.submitted';

/** The schema preset whose submissions type holds what visitors send, and the type it adds beside it. */
export const FORMS_PRESET = 'forms';
export const FORM_SUBMISSIONS = 'form_submissions';
export const FORMS_TYPE = 'forms';

/** A content type a form may be allowed to send to. */
export interface FormSchemaOption {
	name: string;
	label: string;
}

/** A flow as the settings need it: whether a form can start it and whether it runs. */
export interface FlowTarget {
	slug: string;
	name: string;
	status: FlowStatus;
	formTrigger: boolean;
}

/**
 * The tenant's flows as one read of the list. `complete` is false when the
 * tenant has more flows than were read, so a slug missing from `flows` may
 * still exist. `eventKnown` is false when the flow plugin is too old to name
 * each flow's trigger event, so no flow can be offered.
 */
export interface FlowTargets {
	flows: FlowTarget[];
	complete: boolean;
	eventKnown: boolean;
}

/** The engine caps a page of flows at this many rows. */
const FLOW_PAGE = 200;

function startsFromForm(f: Flow): boolean {
	return f.trigger_event?.kind === 'system' && f.trigger_event.name === FORM_EVENT;
}

/** Every flow of the tenant up to `cap`, read from the list alone. */
export async function readFlowTargets(client: HttpClient, cap = 1000): Promise<FlowTargets> {
	const rows: Flow[] = [];
	let complete = false;
	for (let offset = 0; offset < cap; offset += FLOW_PAGE) {
		const page = await listFlows(client, { limit: FLOW_PAGE, offset });
		rows.push(...page.rows);
		if (page.rows.length < FLOW_PAGE || (page.total !== null && rows.length >= page.total)) {
			complete = true;
			break;
		}
	}
	return {
		flows: rows.slice(0, cap).map((f) => ({ slug: f.slug, name: f.name || f.slug, status: f.status, formTrigger: startsFromForm(f) })),
		complete: complete && rows.length <= cap,
		eventKnown: rows.every((f) => 'trigger_event' in f),
	};
}

/** Why a form sending to `slug` starts nothing, or null when it starts the flow or the slug could not be checked. */
export type FlowProblem = 'missing' | 'trigger' | 'blocked' | 'inactive';

export function flowProblem(slug: string, targets: FlowTargets): FlowProblem | null {
	const f = targets.flows.find((x) => x.slug === slug);
	if (!f) return targets.complete ? 'missing' : null;
	if (!f.formTrigger) return 'trigger';
	if (f.status === 'blocked') return 'blocked';
	if (f.status !== 'active') return 'inactive';
	return null;
}

/** What the settings say beside an allowed flow that a form cannot start. */
export const FLOW_NOTE: Record<FlowProblem, string> = {
	missing: 'This flow no longer exists. Untick it, then save.',
	trigger: 'This flow does not start from a builder form. Untick it, then save.',
	blocked: 'This flow uses a step that is no longer available, so forms that send to it start nothing.',
	inactive: 'This flow is not active, so forms that send to it start nothing.',
};

/** One option of the flow list. */
export interface FlowOption {
	value: string;
	label: string;
}

/**
 * The flows the settings offer: every flow a form can start, then every
 * allowed slug that is not among them, so a save keeps or clears it on the
 * reader's choice.
 */
export function flowOptions(targets: FlowTargets, allowed: readonly string[]): FlowOption[] {
	const rows: FlowOption[] = targets.flows.filter((f) => f.formTrigger).map((f) => ({ value: f.slug, label: f.name }));
	for (const slug of allowed) {
		if (rows.some((r) => r.value === slug)) continue;
		rows.push({ value: slug, label: targets.flows.find((f) => f.slug === slug)?.name ?? slug });
	}
	return rows;
}

/** A warning beside one allowed flow. */
export interface FlowNote {
	slug: string;
	label: string;
	note: string;
}

/** The warnings beside the allowed flows a form cannot start. Flows that are not allowed get none. */
export function flowNotes(targets: FlowTargets, allowed: readonly string[]): FlowNote[] {
	const out: FlowNote[] = [];
	for (const slug of allowed) {
		const problem = flowProblem(slug, targets);
		if (!problem) continue;
		out.push({ slug, label: targets.flows.find((f) => f.slug === slug)?.name ?? slug, note: FLOW_NOTE[problem] });
	}
	return out;
}

/** The content types forms may send to, the preset's submissions type first. */
export function formSchemaOptions(rows: readonly FormSchemaOption[]): FormSchemaOption[] {
	return [...rows].sort((a, b) =>
		a.name === FORM_SUBMISSIONS ? -1 : b.name === FORM_SUBMISSIONS ? 1 : a.label.localeCompare(b.label),
	);
}

/**
 * Where the preset's submissions type stands: absent, present and open to
 * forms, or present but served by the delivery API, which forms are refused.
 */
export type SubmissionsState = 'absent' | 'private' | 'public';

/** A content type as the form settings read it. */
export interface FormSchemaRow {
	name: string;
	label: string;
	publicDelivery: boolean;
}

export function submissionsState(rows: readonly FormSchemaRow[]): SubmissionsState {
	const row = rows.find((r) => r.name === FORM_SUBMISSIONS);
	return !row ? 'absent' : row.publicDelivery ? 'public' : 'private';
}

/** What the card says when the submissions type is served by the delivery API. The card links "schema builder". */
export const SUBMISSIONS_PUBLIC =
	'Forms cannot send to Form submissions while anyone can read it through the delivery API. Turn off public delivery on it in the schema builder, then come back.';

/** What the card says when a forms type of the tenant's own keeps setup from adding its types. The card links "schema builder". */
export const FORMS_TYPE_TAKEN =
	'You already have a content type named forms, so Set up form submissions cannot add its content types. Create a content type for form posts in the schema builder, then choose it here.';
