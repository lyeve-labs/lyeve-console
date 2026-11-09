import { CONDITION_OPS, type ConditionOp, type StageCondition, type StageInput } from '$lib/api/review';
import { text } from '$lib/api/narrow';
import { couldNotLoad } from '$lib/outage';

/** The SLA ceiling the plugin accepts, in seconds: ten days. */
export const MAX_SLA_SECONDS = 864000;

/** The most approvals a quorum stage may ask for. */
export const MAX_QUORUM = 100;

/** The most values an `in` condition may list. */
export const MAX_CONDITION_VALUES = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The values of an `in` condition, one per comma or line. */
export function conditionValues(raw: string): string[] {
	return raw
		.split(/[\n,]/)
		.map((v) => v.trim())
		.filter(Boolean);
}

/**
 * A row's condition, or the sentence that refuses it. A row with no field
 * names no condition.
 */
function conditionOf(r: Record<string, unknown>, n: number): { condition?: StageCondition } | { error: string } {
	const field = text(r.condition_field);
	if (!field) return {};
	const op = text(r.condition_op) as ConditionOp;
	if (!(CONDITION_OPS as readonly string[]).includes(op)) return { error: `Stage ${n}: choose how the condition compares.` };
	if (op === 'exists') return { condition: { field, op } };
	const raw = text(r.condition_value);
	if (op === 'in') {
		const values = conditionValues(raw);
		if (values.length === 0) return { error: `Stage ${n}: list at least one value for the condition.` };
		if (values.length > MAX_CONDITION_VALUES) {
			return { error: `Stage ${n}: a condition can list up to ${MAX_CONDITION_VALUES} values.` };
		}
		return { condition: { field, op, values } };
	}
	if (!raw) return { error: `Stage ${n}: give the condition a value to compare with.` };
	return { condition: { field, op, value: raw } };
}

/**
 * The stages the drawer serialized, checked before the engine sees them so
 * the refusal names the row rather than "stage name is required for stage 2".
 * The paid settings (a quorum above one, an escalation target, a condition)
 * are sent only when a row sets them, so a definition that uses none of them
 * never asks the plugin for a license.
 */
export function parseStages(raw: string): { stages: StageInput[] } | { error: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw || '[]');
	} catch {
		return { error: couldNotLoad('the stages', { reload: true }) };
	}
	if (!Array.isArray(parsed) || parsed.length === 0) {
		return { error: 'A definition needs at least one stage.' };
	}
	const stages: StageInput[] = [];
	for (const [i, row] of parsed.entries()) {
		const n = i + 1;
		const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
		const name = text(r.name);
		if (!name) return { error: `Stage ${n} needs a name.` };
		const sla = Number(r.sla_duration_seconds ?? 0);
		if (!Number.isInteger(sla) || sla < 0 || sla > MAX_SLA_SECONDS) {
			return { error: `Stage ${n}: enter an SLA from 0 to 240 hours.` };
		}
		const stage: StageInput = { name, required_role: text(r.required_role), sla_duration_seconds: sla };

		const quorum = Number(r.quorum ?? 0);
		if (!Number.isInteger(quorum) || quorum < 0 || quorum > MAX_QUORUM) {
			return { error: `Stage ${n}: enter from 0 to ${MAX_QUORUM} approvals.` };
		}
		if (quorum > 1) stage.quorum = quorum;

		const kind = text(r.escalate_kind);
		const target = text(r.escalate_to);
		if (kind === 'user' || kind === 'role') {
			if (!target) return { error: `Stage ${n}: choose who to hand an SLA breach to.` };
			if (sla === 0) return { error: `Stage ${n}: escalation follows an SLA breach, so set an SLA.` };
			if (kind === 'user') {
				if (!UUID.test(target)) return { error: `Stage ${n}: enter the id of the user to hand it to.` };
				stage.escalate_to_user_id = target;
			} else {
				stage.escalate_to_role = target;
			}
		}

		const cond = conditionOf(r, n);
		if ('error' in cond) return cond;
		if (cond.condition) stage.condition = cond.condition;

		stages.push(stage);
	}
	return { stages };
}
