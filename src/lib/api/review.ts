import type { HttpClient } from '@lyeve-labs/client';
import { query } from './list';
import { num, record, str } from './narrow';

/**
 * The review plugin's API: definitions with ordered stages, the assignment
 * that carries a content entry through them, and the transitions a reviewer
 * applies. Every shape here is what the plugin answers with, normalized so a
 * field a row leaves out reads as empty rather than undefined.
 */

/** Where an assignment is in its life. */
export type ReviewStatus =
	| 'draft'
	| 'pending_review'
	| 'in_review'
	| 'changes_requested'
	| 'approved'
	| 'rejected'
	| 'published';

/** What the transition route accepts. */
export type TransitionAction = 'approve' | 'reject' | 'request_changes' | 'publish' | 'unpublish';

export const TRANSITION_ACTIONS: readonly TransitionAction[] = [
	'approve',
	'reject',
	'request_changes',
	'publish',
	'unpublish',
];

export const REVIEW_STATUSES: readonly ReviewStatus[] = [
	'pending_review',
	'in_review',
	'changes_requested',
	'approved',
	'rejected',
	'published',
];

export interface ReviewDefinition {
	id: string;
	name: string;
	slug: string;
	content_schema: string;
	publish_on_approve: boolean;
	created_at: string;
	updated_at: string;
}

/** The operators a stage condition compares a field with. */
export const CONDITION_OPS = ['equals', 'not_equals', 'in', 'exists'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

/**
 * A stage's condition on one field of the entry. A stage whose condition is
 * false when the assignment would enter it is skipped. `value` serves equals
 * and not_equals, `values` serves in, and exists takes neither.
 */
export interface StageCondition {
	field: string;
	op: ConditionOp;
	value?: string;
	values?: string[];
}

export interface ReviewStage {
	id: string;
	definition_id: string;
	name: string;
	position: number;
	required_role: string;
	sla_duration_seconds: number;
	/** Approvals the stage needs. 0 or 1 is a single approval. */
	quorum: number;
	/** Who an SLA breach hands the assignment to, at most one of the two. */
	escalate_to_user_id: string;
	escalate_to_role: string;
	condition: StageCondition | null;
}

/**
 * What the definitions read says this instance allows: `licensed` for the
 * paid stage settings, and the workflow ceiling with how many the tenant
 * holds. A null limit is no ceiling.
 */
export interface ReviewLimits {
	licensed: boolean;
	workflows: { limit: number | null; current: number };
}

export interface ReviewAssignment {
	id: string;
	entry_id: string;
	definition_id: string;
	current_stage_id: string;
	assignee_id: string;
	assigned_by: string;
	assigned_at: string;
	status: ReviewStatus;
	due_at: string | null;
	overdue_at: string | null;
	overdue: boolean;
	/** The role an SLA breach handed the current stage to, empty when none did. */
	escalated_role: string;
	escalated_at: string | null;
	/** Every assignee, the primary first, when there are several. Empty for one. */
	assignee_ids: string[];
	/** Who has approved the current stage so far. */
	approvals: string[];
	/**
	 * How many approvals move the assignment off its current stage: the
	 * stage's quorum capped by the assignees, 1 on a single-approval stage.
	 * Every assignment read carries it, the list included.
	 */
	required_approvals: number;
	created_at: string;
	updated_at: string;
}

/** One stage's timing, as the SLA route reports it for every stage of the definition. */
export interface StageSLA {
	stage_id: string;
	stage_name: string;
	sla_duration_seconds: number;
	entry_time: string;
	exit_time: string | null;
	exceeded: boolean;
	over_seconds: number;
}

export interface StageInput {
	name: string;
	required_role: string;
	sla_duration_seconds: number;
	quorum?: number;
	escalate_to_user_id?: string;
	escalate_to_role?: string;
	condition?: StageCondition;
}

export interface DefinitionInput {
	name: string;
	slug?: string;
	content_schema: string;
	publish_on_approve: boolean;
	stages: StageInput[];
}

export interface Paginated<T> {
	items: T[];
	total: number;
}

/** The definitions page, with what the read says this instance allows. */
export interface DefinitionPage extends Paginated<ReviewDefinition> {
	/** Null when the plugin's read carries no such fields. */
	limits: ReviewLimits | null;
}

function nullableStr(v: unknown): string | null {
	return typeof v === 'string' && v ? v : null;
}

function strings(v: unknown): string[] {
	return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s) : [];
}

/** A condition value as text: the plugin answers a string, a number or a boolean. */
function valueText(v: unknown): string {
	return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
}

export function toCondition(raw: unknown): StageCondition | null {
	const r = record(raw);
	const field = str(r.field);
	const op = str(r.op);
	if (!field || !(CONDITION_OPS as readonly string[]).includes(op)) return null;
	const out: StageCondition = { field, op: op as ConditionOp };
	if (op === 'in') out.values = Array.isArray(r.values) ? r.values.map(valueText).filter(Boolean) : [];
	else if (op !== 'exists') out.value = valueText(r.value);
	return out;
}

/** A condition in a few words, for a stage list. */
export function conditionText(c: StageCondition): string {
	switch (c.op) {
		case 'exists':
			return `${c.field} is set`;
		case 'in':
			return `${c.field} is one of ${(c.values ?? []).join(', ')}`;
		case 'not_equals':
			return `${c.field} is not ${c.value ?? ''}`;
		default:
			return `${c.field} is ${c.value ?? ''}`;
	}
}

export function toLimits(raw: unknown): ReviewLimits | null {
	const r = record(raw);
	if (typeof r.licensed !== 'boolean' && !r.limits) return null;
	const w = record(record(r.limits).workflows);
	return {
		licensed: r.licensed === true,
		workflows: { limit: typeof w.limit === 'number' ? w.limit : null, current: num(w.current) },
	};
}

function isStatus(v: unknown): v is ReviewStatus {
	return typeof v === 'string' && (REVIEW_STATUSES as readonly string[]).includes(v);
}

export function isTransitionAction(v: unknown): v is TransitionAction {
	return typeof v === 'string' && (TRANSITION_ACTIONS as readonly string[]).includes(v);
}

export function toDefinition(raw: Record<string, unknown>): ReviewDefinition {
	return {
		id: str(raw.id),
		name: str(raw.name),
		slug: str(raw.slug),
		content_schema: str(raw.content_schema),
		// The plugin defaults the flag to true. A row without it reads as the
		// default too.
		publish_on_approve: raw.publish_on_approve !== false,
		created_at: str(raw.created_at),
		updated_at: str(raw.updated_at),
	};
}

export function toStage(raw: Record<string, unknown>): ReviewStage {
	return {
		id: str(raw.id),
		definition_id: str(raw.definition_id),
		name: str(raw.name),
		position: num(raw.position),
		required_role: str(raw.required_role),
		sla_duration_seconds: num(raw.sla_duration_seconds),
		quorum: num(raw.quorum),
		escalate_to_user_id: str(raw.escalate_to_user_id),
		escalate_to_role: str(raw.escalate_to_role),
		condition: toCondition(raw.condition),
	};
}

/** Approvals a stage needs before it moves: its quorum, or one. */
export function approvalsNeeded(stage: Pick<ReviewStage, 'quorum'> | null | undefined): number {
	return stage && stage.quorum > 1 ? stage.quorum : 1;
}

export function toAssignment(raw: Record<string, unknown>): ReviewAssignment {
	return {
		id: str(raw.id),
		entry_id: str(raw.entry_id),
		definition_id: str(raw.definition_id),
		current_stage_id: str(raw.current_stage_id),
		assignee_id: str(raw.assignee_id),
		assigned_by: str(raw.assigned_by),
		assigned_at: str(raw.assigned_at),
		status: isStatus(raw.status) ? raw.status : 'pending_review',
		due_at: nullableStr(raw.due_at),
		overdue_at: nullableStr(raw.overdue_at),
		overdue: raw.overdue === true,
		escalated_role: str(raw.escalated_role),
		escalated_at: nullableStr(raw.escalated_at),
		assignee_ids: strings(raw.assignee_ids),
		approvals: strings(raw.approvals),
		required_approvals: Math.max(1, num(raw.required_approvals)),
		created_at: str(raw.created_at),
		updated_at: str(raw.updated_at),
	};
}

export function toStageSLA(raw: Record<string, unknown>): StageSLA {
	return {
		stage_id: str(raw.stage_id),
		stage_name: str(raw.stage_name),
		sla_duration_seconds: num(raw.sla_duration_seconds),
		entry_time: str(raw.entry_time),
		exit_time: nullableStr(raw.exit_time),
		exceeded: raw.exceeded === true,
		over_seconds: num(raw.over_seconds),
	};
}

/**
 * The actions an assignment's status takes, in the order the bar shows
 * them. The permission rules and the stage's role are the engine's to apply:
 * the bar offers every action the status allows and relays the 403 it gets,
 * so a reviewer sees why a button refused rather than a bar with no buttons.
 */
export function actionsFor(status: ReviewStatus): TransitionAction[] {
	switch (status) {
		case 'approved':
			return ['publish'];
		case 'published':
			return ['unpublish'];
		default:
			return ['approve', 'request_changes', 'reject'];
	}
}

function rows(res: unknown): Record<string, unknown>[] {
	const list = Array.isArray(res) ? res : (record(res).data ?? []);
	return (Array.isArray(list) ? list : []).map(record);
}

function total(res: unknown, fallback: number): number {
	const t = record(res).total_count;
	return typeof t === 'number' ? t : fallback;
}

export async function listDefinitions(
	client: HttpClient,
	limit = 50,
	offset = 0,
): Promise<DefinitionPage> {
	const res = await client.get<unknown>(`/api/admin/review/definitions?limit=${limit}&offset=${offset}`);
	const items = rows(res).map(toDefinition);
	return { items, total: total(res, items.length), limits: toLimits(res) };
}

export async function getDefinition(
	client: HttpClient,
	id: string,
): Promise<{ definition: ReviewDefinition; stages: ReviewStage[] }> {
	const res = await client.get<Record<string, unknown>>(
		`/api/admin/review/definitions/${encodeURIComponent(id)}`,
	);
	const stages = Array.isArray(res.stages) ? res.stages.map((s) => toStage(record(s))) : [];
	stages.sort((a, b) => a.position - b.position);
	return { definition: toDefinition(record(res.definition)), stages };
}

export function createDefinition(client: HttpClient, input: DefinitionInput): Promise<ReviewDefinition> {
	return client
		.post<Record<string, unknown>>('/api/admin/review/definitions', {
			name: input.name,
			...(input.slug ? { slug: input.slug } : {}),
			content_schema: input.content_schema,
			publish_on_approve: input.publish_on_approve,
			stages: input.stages,
		})
		.then(toDefinition);
}

export function deleteDefinition(client: HttpClient, id: string): Promise<void> {
	return client.delete<void>(`/api/admin/review/definitions/${encodeURIComponent(id)}`);
}

export async function listAssignments(
	client: HttpClient,
	filters: { status?: string; assignee_id?: string; limit?: number; offset?: number } = {},
): Promise<Paginated<ReviewAssignment>> {
	const q = query({
		limit: filters.limit ?? 50,
		offset: filters.offset ?? 0,
		status: filters.status,
		assignee_id: filters.assignee_id,
	});
	const res = await client.get<unknown>(`/api/admin/review/assignments${q}`);
	const items = rows(res).map(toAssignment);
	return { items, total: total(res, items.length) };
}

/** The entry's latest assignment. The route answers 404 for an entry under no review. */
export function getAssignmentByEntry(client: HttpClient, entryId: string): Promise<ReviewAssignment> {
	return client
		.get<Record<string, unknown>>(`/api/admin/review/entries/${encodeURIComponent(entryId)}/assignment`)
		.then(toAssignment);
}

/**
 * Start an entry through a definition. `assignee_ids` names every assignee,
 * the primary first, and is sent only when there is more than one.
 */
export function createAssignment(
	client: HttpClient,
	input: { entry_id: string; definition_id: string; assignee_id: string; assignee_ids?: string[] },
): Promise<ReviewAssignment> {
	const { assignee_ids, ...rest } = input;
	const body = assignee_ids && assignee_ids.length > 1 ? { ...rest, assignee_ids } : rest;
	return client.post<Record<string, unknown>>('/api/admin/review/assignments', body).then(toAssignment);
}

export function transitionAssignment(
	client: HttpClient,
	id: string,
	action: TransitionAction,
	comment: string,
): Promise<ReviewAssignment> {
	return client
		.post<Record<string, unknown>>(`/api/admin/review/assignments/${encodeURIComponent(id)}/transition`, {
			action,
			...(comment ? { comment } : {}),
		})
		.then(toAssignment);
}

/** Every stage of the assignment's definition with its timing, current stage included. */
export async function getStageSLA(client: HttpClient, id: string): Promise<StageSLA[]> {
	const res = await client.get<unknown>(`/api/admin/review/assignments/${encodeURIComponent(id)}/sla`);
	return (Array.isArray(res) ? res : []).map((r) => toStageSLA(record(r)));
}
