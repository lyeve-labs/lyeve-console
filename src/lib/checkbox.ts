/**
 * Whether a form's checkbox was ticked. A ticked box posts its value, which
 * is "on" unless the box sets one, and an unticked box posts nothing. Some
 * forms post "true" for the same choice, so both read as ticked.
 */
export function checked(form: FormData, name: string): boolean {
	const value = form.get(name);
	return value === 'on' || value === 'true';
}
