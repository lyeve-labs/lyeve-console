/**
 * The option labels an assistant reads in place of the ones a person sees.
 *
 * The kit describes a choice control to the assistant with the labels it
 * draws. A relation picker draws each entry by its name, and when the related
 * content type marks a field No AI or private, that name can be the marked
 * value. The picker registers the labels the assistant may read, under the
 * name the control posts, and the request takes those instead.
 */

const byField = new Map<string, ReadonlyMap<string, string>>();

/** Registers a control's labels for the assistant, and returns the call that removes them. */
export function registerOptionLabels(name: string, labels: ReadonlyMap<string, string>): () => void {
	byField.set(name, labels);
	return () => {
		if (byField.get(name) === labels) byField.delete(name);
	};
}

/**
 * The label the assistant reads for one option of a control. An option the
 * registered labels do not cover reads as its value, never as the label the
 * person sees.
 */
export function optionLabel(name: string, option: { value: string; label: string }): string {
	const labels = byField.get(name);
	if (!labels) return option.label;
	return labels.get(option.value) ?? option.value;
}
