import type { Actions, PageServerLoad } from './$types';
import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { authedClient, loadUser, requireRole } from '$lib/server/authz';
import { actionError, actionFailure } from '$lib/server/action-error';
import { refusalOf, refusalText } from '$lib/api/refusal';
import {
	MIN_PASSPHRASE,
	applyConfig,
	applyResultOf,
	diffConfig,
	exportConfig,
	parseBundle,
	type SyncRequest,
} from '$lib/api/config-sync';
import { forbiddenText } from '$lib/api/gate';

/**
 * Config sync has no read of its own: every route is a POST, and an export
 * hands over every secret on the instance sealed with the caller's
 * passphrase. So the load reads only the role. Whether the instance may
 * export or apply is the engine's answer to the request, and each action
 * renders a refusal the way every other page does.
 */
export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	if (!user.roles.includes('super_admin')) {
		error(403, forbiddenText('this page', ['super_admin']));
	}
	return {};
};

type Mode = 'diff' | 'dry-run' | 'apply';

/** A refused or failed sync request, with the license refusal when it was one. */
function syncFailure(err: unknown, mode: Mode, fallback: string) {
	const refused = refusalOf(err);
	if (refused) return fail(402, { scope: 'sync' as const, mode, error: refusalText(refused), refused });
	const status = err && typeof err === 'object' && 'status' in err && typeof err.status === 'number' ? err.status : 502;
	return fail(status, { scope: 'sync' as const, mode, error: actionError(err, fallback) });
}

/** Reads the bundle form, or answers the failure the page shows for it. */
async function readSync(event: RequestEvent, mode: Mode) {
	await requireRole(event, ['super_admin']);
	const form = await event.request.formData();
	const text = String(form.get('bundle') ?? '').trim();
	const passphrase = String(form.get('passphrase') ?? '');
	const prune = form.get('prune') === 'true';
	const fields: Record<string, string> = {};
	if (!text) fields.bundle = 'Choose a bundle file';
	if (!passphrase) fields.passphrase = 'Enter the passphrase the bundle was exported with';
	if (Object.keys(fields).length > 0) {
		return { failure: fail(400, { scope: 'sync' as const, mode, error: 'Check the highlighted fields.', fields }) };
	}
	const parsed = parseBundle(text);
	if ('error' in parsed) {
		return { failure: fail(400, { scope: 'sync' as const, mode, error: parsed.error, fields: { bundle: parsed.error } }) };
	}
	const req: SyncRequest = { passphrase, bundle: parsed.bundle, prune };
	return { req };
}

export const actions: Actions = {
	/** Writes this instance's configuration as a bundle the page then offers as a download. */
	export: async (event) => {
		await requireRole(event, ['super_admin']);
		const form = await event.request.formData();
		const passphrase = String(form.get('passphrase') ?? '');
		if (passphrase.length < MIN_PASSPHRASE) {
			return fail(400, {
				scope: 'export' as const,
				error: 'Check the highlighted fields.',
				fields: { passphrase: `Use at least ${MIN_PASSPHRASE} characters` },
			});
		}
		try {
			const bundle = await exportConfig(authedClient(event), passphrase);
			const day = (bundle.exported_at ?? new Date().toISOString()).slice(0, 10);
			return {
				scope: 'export' as const,
				bundle: JSON.stringify(bundle, null, 2),
				filename: `lyeve-config-${day}.json`,
				sections: Object.keys(bundle.sections ?? {}),
			};
		} catch (err) {
			const failed = actionFailure(err, 'Could not export the configuration. Try again.');
			return fail(failed.status, { ...failed.data, scope: 'export' as const });
		}
	},

	/** Plans the bundle against this instance. Writes nothing. */
	diff: async (event) => {
		const read = await readSync(event, 'diff');
		if ('failure' in read) return read.failure;
		try {
			const plan = await diffConfig(authedClient(event), read.req);
			return { scope: 'sync' as const, mode: 'diff' as const, plan };
		} catch (err) {
			return syncFailure(err, 'diff', 'Could not compare the bundle with this engine. Try again.');
		}
	},

	/** Runs the apply's own checks and answers its plan. Writes nothing. */
	dryRun: async (event) => {
		const read = await readSync(event, 'dry-run');
		if ('failure' in read) return read.failure;
		try {
			const result = await applyConfig(authedClient(event), read.req, true);
			return { scope: 'sync' as const, mode: 'dry-run' as const, plan: result.plan };
		} catch (err) {
			// A plan with problems answers 422 with the plan, which is the
			// answer a dry run exists to give.
			const result = applyResultOf(err);
			if (result) return { scope: 'sync' as const, mode: 'dry-run' as const, plan: result.plan };
			return syncFailure(err, 'dry-run', 'Could not complete the dry run. Try again.');
		}
	},

	/** Makes this instance match the bundle. */
	apply: async (event) => {
		const read = await readSync(event, 'apply');
		if ('failure' in read) return read.failure;
		try {
			const result = await applyConfig(authedClient(event), read.req, false);
			return { scope: 'sync' as const, mode: 'apply' as const, plan: result.plan, result };
		} catch (err) {
			const result = applyResultOf(err);
			if (result) {
				const status = err && typeof err === 'object' && 'status' in err && typeof err.status === 'number' ? err.status : 409;
				const message = result.failed
					? 'The apply stopped partway. The details below show what was written and what was not.'
					: 'Fix the problems in the bundle, then apply it again. Nothing was written.';
				return fail(status, { scope: 'sync' as const, mode: 'apply' as const, error: message, plan: result.plan, result });
			}
			return syncFailure(err, 'apply', 'Could not apply the bundle. Nothing was written. Try again.');
		}
	},
};
