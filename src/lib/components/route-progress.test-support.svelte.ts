/**
 * A stand-in for `$app/state`'s `navigating` that a test can change under a
 * mounted component, as a real navigation does.
 */
let to = $state<unknown>(null);

export const navigating = {
	get to() {
		return to;
	},
	set to(next: unknown) {
		to = next;
	},
};
