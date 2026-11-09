import { fail, type RequestEvent } from '@sveltejs/kit';
import { resetProfiler } from '$lib/api/profiler';
import { actionFailure } from '$lib/server/action-error';
import { authedClient, requireRole } from '$lib/server/authz';
import type { Question } from '$lib/server/asked';

/** What a reset that skipped the question asks, on either tab. */
export const RESET_QUESTION: Question = {
	question: 'Reset the profiler?',
	detail: 'Sampled requests and memory snapshots are deleted, and a new snapshot is taken. This cannot be undone.',
	label: 'Reset',
};

/**
 * The Reset both the timings and the memory tab carry. One reset clears the
 * sampled requests and the memory snapshots alike, so each tab posts to its
 * own action and both run this.
 */
export async function reset(event: RequestEvent) {
	await requireRole(event, ['super_admin']);
	try {
		await resetProfiler(authedClient(event));
		return { form: 'reset' as const, reset: true };
	} catch (err) {
		const failed = actionFailure(err, 'Could not reset the profiler. Try again.');
		return fail(failed.status, { ...failed.data, form: 'reset' as const });
	}
}
