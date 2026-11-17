/**
 * Reads the export form the start and schedule drawers share.
 *
 * Kept out of `+page.server.ts` because a named export there that is not an
 * action or a load passes the type check and the unit tests and then fails
 * the page at runtime.
 */
import { FORMATS, type ExportConfig, type ExportFormat } from '#lib/api/data-export.ts';

const STATUSES = ['draft', 'published', 'archived'] as const;

function formatOf(value: string): ExportFormat | null {
	return FORMATS.includes(value as ExportFormat) ? (value as ExportFormat) : null;
}

/** The export configuration the form describes, or why it cannot run. */
export function exportConfigFrom(form: FormData): { config: ExportConfig } | { error: string } {
	const format = formatOf(String(form.get('format') ?? ''));
	if (!format) return { error: 'Choose a format.' };

	const schemas = form
		.getAll('schemas')
		.map((s) => String(s).trim())
		.filter(Boolean);
	const statuses = form
		.getAll('statuses')
		.map((s) => String(s).trim())
		.filter((s): s is (typeof STATUSES)[number] => (STATUSES as readonly string[]).includes(s));
	const template = String(form.get('template') ?? '');
	if (format === 'template' && !template.trim()) {
		return { error: 'Enter the template for a custom template export.' };
	}

	return {
		config: {
			format,
			// An empty list means every schema, which is what the plugin does
			// with an absent filter. Sending [] would mean none.
			filter: {
				...(schemas.length > 0 ? { schemas } : {}),
				...(statuses.length > 0 ? { statuses } : {}),
			},
			...(format === 'template' ? { template } : {}),
			include_schemas: form.get('include_schemas') === 'true',
			include_media: form.get('include_media') === 'true',
		},
	};
}
