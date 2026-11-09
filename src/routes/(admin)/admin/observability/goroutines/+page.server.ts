import type { Actions, PageServerLoad } from './$types';
import { ApiError } from '@lyeve-labs/client';
import { error, fail } from '@sveltejs/kit';
import {
	byOwnerRows,
	parseAsyncHooksForm,
	parseParallelForm,
	parsePoolForm,
	putAsyncHooks,
	putParallel,
	putPoolSize,
	readGoroutineEngine,
	type AsyncHooksView,
	type GoroutineEngineViews,
	type ParallelView,
	type PoolView,
} from '$lib/api/goroutine-engine';
import { forbiddenText } from '$lib/api/gate';
import { refusalOf } from '$lib/api/refusal';
import { actionError } from '$lib/server/action-error';
import { authedClient, requireRole } from '$lib/server/authz';

const READERS = ['admin', 'super_admin'];

/** Which of the three tunable forms an action answered for. */
export type TunableForm = 'pool' | 'parallel' | 'asyncHooks';

/**
 * The goroutine engine's panel: the views every admin may read, and whether
 * this session may write them. The writes need super_admin and a license
 * that lets tuning through, which the plugin reports as `licensed`. A form
 * that could only ever answer 403 or 402 is shown disabled with the reason,
 * rather than as a form that fails.
 */
export interface GoroutineEnginePanel extends GoroutineEngineViews {
	byOwner: ReturnType<typeof byOwnerRows>;
	superAdmin: boolean;
}

export const load: PageServerLoad = async (event) => {
	const { user } = await event.parent();
	if (!user.roles.some((r) => READERS.includes(r))) {
		error(403, forbiddenText('this page', READERS));
	}

	const views = await readGoroutineEngine(authedClient(event));
	const goroutineEngine: GoroutineEnginePanel = {
		...views,
		byOwner: byOwnerRows(views.snapshot),
		superAdmin: user.roles.includes('super_admin'),
	};
	return { goroutineEngine };
};

/**
 * A refused write, as the form beside the tiles reports it. A 402 is the
 * license saying no, so it travels as the refusal every page renders the
 * same way. A 422 carries the plugin's own bounds message, which names the
 * field and the limit, so it is relayed as written. Anything else is the
 * fallback sentence.
 */
function tunableFailure(form: TunableForm, err: unknown, fallback: string) {
	const refused = refusalOf(err);
	if (refused) return fail(402, { form, refused });
	if (err instanceof ApiError && err.status === 422) {
		return fail(422, { form, error: actionError(err, fallback) });
	}
	return fail(400, { form, error: actionError(err, fallback) });
}

async function saveTunable<T>(
	form: TunableForm,
	fallback: string,
	write: () => Promise<T>,
): Promise<{ form: TunableForm; saved: true; view: T } | ReturnType<typeof tunableFailure>> {
	try {
		return { form, saved: true, view: await write() };
	} catch (err) {
		return tunableFailure(form, err, fallback);
	}
}

export const actions: Actions = {
	pool: async (event) => {
		await requireRole(event, ['super_admin']);
		const parsed = parsePoolForm(await event.request.formData());
		if ('error' in parsed) return fail(422, { form: 'pool' as const, error: parsed.error });
		return saveTunable<PoolView>('pool', 'Could not resize the pool. Try again.', () => putPoolSize(authedClient(event), parsed.body));
	},

	parallel: async (event) => {
		await requireRole(event, ['super_admin']);
		const parsed = parseParallelForm(await event.request.formData());
		if ('error' in parsed) return fail(422, { form: 'parallel' as const, error: parsed.error });
		return saveTunable<ParallelView>('parallel', 'Could not save the parallel engine settings. Try again.', () => putParallel(authedClient(event), parsed.body));
	},

	asyncHooks: async (event) => {
		await requireRole(event, ['super_admin']);
		const parsed = parseAsyncHooksForm(await event.request.formData());
		if ('error' in parsed) return fail(422, { form: 'asyncHooks' as const, error: parsed.error });
		return saveTunable<AsyncHooksView>('asyncHooks', 'Could not save the async hook settings. Try again.', () => putAsyncHooks(authedClient(event), parsed.body));
	},
};
