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
import { RUNTIME_FORBIDDEN, parseRuntimeForm, positiveInt, putRuntimeSettings, readRuntime } from '$lib/api/runtime-settings';
import { conflictText, invalidText } from '$lib/api/runtime-words';
import { actionError, actionFailure } from '$lib/server/action-error';
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

	const client = authedClient(event);
	const superAdmin = user.roles.includes('super_admin');

	// The replica count and the database cores a reader typed refine the
	// recommendations, and as query parameters they survive a reload.
	const inputs = {
		replicas: positiveInt(event.url.searchParams.get('replicas')),
		database_cores: positiveInt(event.url.searchParams.get('database_cores')),
	};

	const [views, runtimeRead] = await Promise.all([
		readGoroutineEngine(client),
		// Both runtime reads are for a super admin alone, so no other role makes them.
		superAdmin ? readRuntime(client, inputs) : RUNTIME_FORBIDDEN,
	]);
	const goroutineEngine: GoroutineEnginePanel = {
		...views,
		byOwner: byOwnerRows(views.snapshot),
		superAdmin,
	};
	const runtime = { ...runtimeRead, inputs, superAdmin };
	return { goroutineEngine, runtime };
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

/**
 * A refused runtime write. A 409, a 422 and a 400 naming an unknown field
 * are worded from their code and params, never from the route's English.
 * Everything else goes through actionFailure: a 402 travels as the license
 * refusal, another 4xx relays the engine's own sentence only when it carries
 * an error code, and anything past a 4xx makes no claim about whether the
 * change landed.
 */
function runtimeFailure(err: unknown) {
	const form = 'runtime' as const;
	if (err instanceof ApiError && err.status === 409) {
		return fail(409, { form, error: conflictText(err.body) });
	}
	if (err instanceof ApiError) {
		const invalid = invalidText(err.status, err.body);
		if (invalid !== null) return fail(err.status, { form, error: invalid });
	}
	const failed =
		err instanceof ApiError && err.status >= 400 && err.status < 500
			? actionFailure(err, 'Could not save the runtime settings. Try again.', err.status)
			: actionFailure(err, 'Check whether your change was saved, then try again.');
	return fail(failed.status, { ...failed.data, form });
}

export const actions: Actions = {
	runtime: async (event) => {
		await requireRole(event, ['super_admin']);
		const parsed = parseRuntimeForm(await event.request.formData());
		if ('error' in parsed) {
			// A value the form refuses is shown on its own field.
			if (parsed.field) return fail(422, { form: 'runtime' as const, fields: { [parsed.field]: parsed.error } });
			return fail(422, { form: 'runtime' as const, error: parsed.error });
		}
		try {
			const view = await putRuntimeSettings(authedClient(event), parsed.body);
			// The engine's warning is a caution about the pool's share of the
			// database's connections. Only whether it came travels, so the
			// panel words it in the console's own sentence.
			return { form: 'runtime' as const, saved: true, stored: view.stored !== false, poolWarning: Boolean(view.warning) };
		} catch (err) {
			return runtimeFailure(err);
		}
	},

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
