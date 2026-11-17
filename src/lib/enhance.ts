import { enhance as kitEnhance, type SubmitFunction } from '$app/forms';

/**
 * SvelteKit's `enhance`, with a form post that stays on the page it was sent
 * from. Every form in the console takes it from here.
 *
 * SvelteKit 3's `update()` moves the reader to the action's own address after
 * a success or a failure, and an action address replaces the page's query. A
 * page that keeps state in its query, such as an open drawer, a filter or an
 * offset, would lose it on every post. Each `update()` here defaults to
 * `navigate: false`, so the result applies to the page as it stands. A
 * redirect the action answers with is still followed, and a call that names
 * `navigate` itself keeps its choice.
 */
export function enhance(form: HTMLFormElement, submit: SubmitFunction = () => {}) {
	return kitEnhance(form, async (input) => {
		let canceled = false;
		const after = await submit({
			...input,
			cancel: () => {
				canceled = true;
				input.cancel();
			},
		});
		// A canceled post sends nothing, so it gets no callback either.
		if (canceled) return;
		return async (opts) => {
			const update: typeof opts.update = (options) => opts.update({ navigate: false, ...options });
			if (after) await after({ ...opts, update });
			else await update();
		};
	});
}
