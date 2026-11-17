import { fail } from '@sveltejs/kit';
import type { FlowRefusal } from '#lib/api/flows.ts';
import type { RefusalNotice } from '#lib/flow/types.ts';
import { notEnabledText } from '#lib/flow/blocked.ts';
import { LIFTS } from '#lib/api/refusal.ts';

/**
 * What the page renders for a 402 the flow plugin answered, as the plugin
 * sent it.
 *
 * A refusal that carries a limit is the ceiling on flows, and the message
 * quotes the limit and the count the plugin sent, then the way forward: a
 * license that allows more, and only after it deleting one. One that names
 * nodes is a definition using what this instance does not enable: the ids
 * arrive as problems, drawn on the canvas like a validation error. One that
 * carries neither refuses the flow routes as a whole, and the page says flows
 * are not enabled here.
 */
export function refusalFailure(err: FlowRefusal) {
	if (err.limit !== null) {
		return fail(402, {
			error: ceilingText(err.limit, err.current),
			refusal: { nodeIds: [], limit: err.limit, current: err.current, upgradeUrl: err.upgradeUrl } satisfies RefusalNotice,
		});
	}
	const nodeIds = err.nodeIds;
	if (nodeIds.length === 0) {
		return fail(402, { error: notEnabledText(nodeIds), locked: true });
	}
	return fail(402, {
		error: notEnabledText(nodeIds),
		refusal: { nodeIds, limit: null, current: null, upgradeUrl: err.upgradeUrl } satisfies RefusalNotice,
		errors: err.errors,
	});
}

function ceilingText(limit: number, current: number | null): string {
	const held = current === null ? `This tenant is limited to ${limit} flows.` : `${current} of ${limit} flows are in use, the limit for this tenant.`;
	return `${held} ${LIFTS} You can also delete a flow to make room.`;
}
