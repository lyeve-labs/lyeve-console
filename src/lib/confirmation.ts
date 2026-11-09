/**
 * The field a write that asks first carries once the reader agrees.
 *
 * `confirmed()` adds it after the kit's question, and an action wrapped in
 * `asked()` runs only with it. A form posted before the page hydrates, or
 * with scripts off, never showed the question, so it arrives without the
 * field and the page asks instead.
 */
export const CONFIRM_FIELD = 'confirmed';
export const CONFIRMED = 'yes';

/** What a guarded action answers for a post the reader has not confirmed. */
export type Unconfirmed = {
	unconfirmed: {
		/** Worded without the row's name, which the post does not carry. */
		question: string;
		detail?: string;
		/** The verb on the button that confirms. */
		label: string;
		/** The path and action the confirming form posts to. */
		action: string;
		/** The fields of the first post, sent again with the confirmation. */
		fields: [string, string][];
	};
};

/** The question a page's `form` holds, or null when it holds none. */
export function unconfirmedOf(form: unknown): Unconfirmed['unconfirmed'] | null {
	if (!form || typeof form !== 'object' || !('unconfirmed' in form)) return null;
	return (form as Unconfirmed).unconfirmed ?? null;
}
