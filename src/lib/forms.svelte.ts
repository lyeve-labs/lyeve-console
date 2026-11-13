import type { SubmitFunction } from '@sveltejs/kit';
import { confirm, toast, type ConfirmOptions } from '@lyeve-labs/ui-kit';
import { invalidateAll } from '$app/navigation';
import { CONFIRM_FIELD, CONFIRMED } from './confirmation';

/**
 * The submit handler for a panel that closes itself, and whether it is running.
 *
 * A bare `use:enhance` applies the action result and resets the form, but never
 * touches the component state holding the panel open. The operator submits, the
 * fields clear, the panel stays put, and the new row is behind it: it reads as
 * "nothing happened", so they submit again. That is how a create panel produces
 * duplicate rows.
 *
 * The pending flag is the other half of the same problem. The panel stays
 * open for the whole round trip, so without it the primary sits live and
 * unchanged while the write is in flight, which reads as the same "nothing
 * happened". It lives here rather than in each page because a copy of
 * `let submitting = $state(false)` per page is a chance per page to forget one.
 *
 * Returned as an object rather than as a tuple so the two halves are named at
 * the call site:
 *
 *     const create = submitter(() => (open = false));
 *     <form use:enhance={create.enhance}>
 *     <Button loading={create.pending} type="submit">Create</Button>
 *
 * On failure the panel stays open so the error is visible against the values
 * that caused it.
 *
 * A form whose answer is computed from what it sent, such as a URL built from
 * a size and a format, passes `{ reset: false }`. Cleared, its fields no
 * longer say what the answer was built from.
 *
 * A form whose write may have landed before a 5xx passes
 * `{ reloadAfterOutage: true }`. SvelteKit reloads the page data only on a
 * success, so without it the list behind the panel cannot show what landed.
 */
export function submitter(close?: () => void, { reset = true, reloadAfterOutage = false }: { reset?: boolean; reloadAfterOutage?: boolean } = {}) {
	return tracked(() => async ({ result, update }) => {
		if (result.type !== 'failure' && result.type !== 'error') close?.();
		await update({ reset });
		if (reloadAfterOutage && result.type === 'failure' && result.status >= 500) await invalidateAll();
	});
}

/**
 * The per-field messages an action returned, if it returned any.
 *
 * Actions answer a rejected write with `fail(400, { error, fields })`, and
 * `fields` is optional because most actions relay one sentence from the engine
 * and have nothing to attach to a particular control. Reading it through here
 * keeps every page's narrowing identical and keeps `ActionData` unions out of
 * the markup.
 */
export function fieldErrors(form: unknown): Record<string, string> {
	if (!form || typeof form !== 'object') return {};
	const fields = (form as { fields?: unknown }).fields;
	if (!fields || typeof fields !== 'object') return {};
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
		if (typeof value === 'string' && value) out[key] = value;
	}
	return out;
}

/**
 * Which of a page's action failures its drawer shows and which show above
 * the list. Each failure names the action behind it. The drawer shows only
 * its own writes' failures, and only one that came back after it opened, so
 * a failed delete never reads as a failure of the form opened next. The
 * page calls `opened()` as it opens the drawer.
 *
 * `form` is read through a function because a page's props are reactive
 * only when read where they are used.
 */
export function drawerFailure<F>(form: () => F, actions: readonly string[]) {
	let openedOver = $state.raw<unknown>(null);
	const ownAction = (f: F) => {
		const action = f && typeof f === 'object' ? (f as { action?: unknown }).action : undefined;
		return typeof action === 'string' && actions.includes(action);
	};
	return {
		/** The failure the drawer shows, or null. */
		get drawer(): F | null {
			const f = form();
			return ownAction(f) && f !== openedOver ? f : null;
		},
		/** The failure the page shows above the list, or null. */
		get page(): F | null {
			const f = form();
			return ownAction(f) ? null : f;
		},
		/** Marks the failure on screen as older than the drawer opening now. */
		opened() {
			openedOver = form();
		},
	};
}

/**
 * Whether a page's own submit handler is running, without changing what it
 * does.
 *
 * Most panels close themselves and nothing else, and `submitter` is theirs.
 * Some panels have a handler of their own: they raise a toast, invalidate the
 * load, or keep the panel open on one branch. This wraps such a handler and
 * leaves what it does unchanged.
 *
 *     const save = tracked(saveAccount);
 *     <form use:enhance={save.enhance}>
 *     <Button loading={save.pending} type="submit">Save</Button>
 *
 * A handler that returns nothing gets SvelteKit's own default, which is to
 * apply the result. Returning a callback unconditionally would otherwise
 * swallow it and leave the page showing the values it submitted.
 */
export function tracked(fn: SubmitFunction) {
	let pending = $state(false);
	const enhance: SubmitFunction = async (input) => {
		pending = true;
		let canceled = false;
		let after;
		try {
			// A confirm-then-submit handler cancels when the question is
			// declined, and enhance then never calls the callback below. Without
			// this the primary spins until the reader navigates away, and that is
			// the commonest handler shape in this application. enhance reads the
			// cancel once the handler settles, so the wrapped handler is awaited
			// here: returning before its question is answered sends the request.
			after = await fn({
				...input,
				cancel: () => {
					canceled = true;
					pending = false;
					input.cancel();
				},
			});
		} catch (err) {
			pending = false;
			throw err;
		}
		if (canceled) return;
		return async (opts) => {
			try {
				if (after) await after(opts);
				else await opts.update();
			} finally {
				pending = false;
			}
		};
	};
	return {
		get pending() {
			return pending;
		},
		enhance,
	};
}

/** What a confirmed write says once it goes through, from the action's answer. */
type Success = string | ((data: Record<string, unknown> | undefined) => string);

/**
 * The submit handler for a write that asks first.
 *
 * enhance awaits the handler before it sends anything, so a declined question
 * cancels the request rather than undoing it. An agreed one adds the
 * confirmation the action's `asked()` wrapper requires, so a post that
 * skipped the question, made before the page hydrated, runs nothing and the
 * page asks instead. Once the write goes through,
 * the result is applied and, when the caller names one, a toast says what
 * happened. A row's delete leaves nothing on screen to say it worked, so the
 * toast is that word. A failure raises no toast: the action's answer lands in
 * `form` and the page shows it where its own failure belongs.
 *
 *     <form use:enhance={confirmed(`Delete ${name}?`, 'Its history goes with it.', {
 *         confirmLabel: 'Delete',
 *         success: `${name} deleted.`,
 *     })}>
 *
 * Every other option goes to the kit's confirm unchanged.
 */
export function confirmed(
	question: string,
	detail: string,
	{ success, ...options }: ConfirmOptions & { success?: Success } = {},
): SubmitFunction {
	return async ({ cancel, formData }) => {
		if (!(await confirm(question, detail, options))) {
			cancel();
			return;
		}
		formData.set(CONFIRM_FIELD, CONFIRMED);
		return async ({ result, update }) => {
			await update();
			if (success && result.type === 'success') {
				toast.success(typeof success === 'string' ? success : success(result.data));
			}
		};
	};
}
