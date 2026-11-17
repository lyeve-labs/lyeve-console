import type { EmailTriggerInput } from '#lib/api/email-triggers.ts';

/** Reads the trigger form. The recipients arrive as one comma-separated line. */
export function readTriggerForm(data: FormData): { input: EmailTriggerInput } | { error: string } {
	const str = (k: string) => String(data.get(k) ?? '').trim();
	const input: EmailTriggerInput = {
		name: str('name'),
		event: str('event'),
		schema: str('schema') || '*',
		template_key: str('template_key'),
		to_static: str('to_static')
			.split(/[,\n]/)
			.map((a) => a.trim())
			.filter(Boolean),
		to_field: str('to_field'),
		locale: str('locale'),
		enabled: str('enabled') !== 'false',
	};
	if (!input.name) return { error: 'Name the trigger.' };
	if (!input.event) return { error: 'Choose the event it sends on.' };
	if (!input.template_key) return { error: 'Choose the template it sends.' };
	if (input.to_static.length === 0 && !input.to_field) return { error: 'Add at least one recipient: a fixed address or a field of the record.' };
	return { input };
}
