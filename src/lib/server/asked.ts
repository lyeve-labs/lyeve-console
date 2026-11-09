import { error, type RequestEvent } from '@sveltejs/kit';
import { CONFIRM_FIELD, CONFIRMED, type Unconfirmed } from '$lib/confirmation';

/** The question the page asks when a post arrives without the reader's answer. */
export type Question = {
	/** Without the row's name, which the post does not carry: "Delete this webhook?" */
	question: string;
	detail?: string;
	/** The verb on the confirming button: "Delete". */
	label: string;
};

/**
 * Runs a write that asks first only on a post the reader confirmed.
 *
 * The form's `confirmed()` handler asks in the kit's dialog and adds the
 * confirmation once the reader agrees. A click before the page hydrates, or
 * with scripts off, posts the form natively with no dialog, so the post
 * arrives without it. The action then runs nothing and answers the question,
 * which the admin layout draws with a button that posts the same fields
 * again with the confirmation.
 *
 *     delete: asked({ question: 'Delete this webhook?', detail: 'This cannot be undone.', label: 'Delete' },
 *         async (event) => { ... }),
 *
 * A form whose handler asks only for some posts, such as a stop among an
 * experiment's moves, passes `when`, which picks those posts from the body.
 * Every other post runs without the confirmation.
 */
export function asked<E extends RequestEvent, R>(
	question: Question,
	action: (event: E) => R | Promise<R>,
	when: (form: FormData) => boolean = () => true,
) {
	return async (event: E): Promise<R | Unconfirmed> => {
		// The action reads the body itself, so the check reads a copy.
		const form = await event.request.clone().formData();
		if (form.get(CONFIRM_FIELD) === CONFIRMED || !when(form)) return action(event);
		const fields: [string, string][] = [];
		for (const [name, value] of form) {
			// The banner posts the fields again as hidden inputs, which cannot hold a file.
			if (typeof value !== 'string') error(400, 'Could not send this form without scripts. Reload the page and try again.');
			if (name !== CONFIRM_FIELD) fields.push([name, value]);
		}
		return { unconfirmed: { ...question, action: `${event.url.pathname}${event.url.search}`, fields } };
	};
}
