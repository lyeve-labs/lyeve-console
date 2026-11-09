<script lang="ts">
	/*
	 * What to export and how, shared by the start and schedule drawers so the
	 * two can never offer different choices. The schema picker and the
	 * switches submit nothing on their own, so each value rides in a hidden
	 * input the action reads. The format and status groups are native inputs
	 * and submit under their names.
	 */
	import { CheckboxGroup, MultiSelect, RadioGroup, Textarea, Toggle } from '@lyeve-labs/ui-kit';
	import { EXPORT_ROW_CEILING, FORMATS, FORMAT_LABELS } from '$lib/api/data-export';
	import { formatCount } from '$lib/format';

	let {
		idPrefix,
		schemaNames,
		format = $bindable('json'),
		schemas = $bindable([]),
		statuses = $bindable([]),
		includeSchemas = $bindable(false),
		includeMedia = $bindable(false),
		template = $bindable(''),
	}: {
		idPrefix: string;
		/** The tenant's schemas, or null when the list could not be read. */
		schemaNames: string[] | null;
		format?: string;
		schemas?: string[];
		statuses?: string[];
		includeSchemas?: boolean;
		includeMedia?: boolean;
		template?: string;
	} = $props();

	// Each format carries a sentence the reader compares across formats before
	// picking, so every one shows, not only the chosen one's.
	const formatOptions = FORMATS.map((f) => ({
		value: f,
		label: FORMAT_LABELS[f].label,
		description: FORMAT_LABELS[f].hint,
	}));
	const schemaOptions = $derived((schemaNames ?? []).map((s) => ({ value: s, label: s })));
	const statusOptions = [
		{ value: 'published', label: 'Published' },
		{ value: 'draft', label: 'Draft' },
		{ value: 'archived', label: 'Archived' },
	];
	// The plugin stops an export at its row ceiling when the request names no
	// limit, and lifting it risks the memory the ceiling protects.
	const ceilingHint = `An export includes at most ${formatCount(EXPORT_ROW_CEILING)} entries. To export more, split it by content type or status.`;
	// An unread list offers nothing to pick, and the hint says why rather than
	// leaving an empty choice that reads as a tenant with no schemas.
	const schemasHint = $derived.by(() => {
		if (schemaNames === null) {
			return 'Could not load the content type list. Leave this empty to export every content type.';
		}
		if (schemas.length === 0) {
			return `Every content type${schemaNames.length > 0 ? `, ${schemaNames.length} in this tenant` : ''}.`;
		}
		return `${schemas.length} of ${schemaNames.length} content types.`;
	});
</script>

<div class="flex flex-col gap-4">
	<MultiSelect
		id="{idPrefix}-schemas"
		label="Content types"
		placeholder="Every content type"
		hint={schemasHint}
		searchable
		options={schemaOptions}
		bind:value={schemas}
	/>
	{#each schemas as s (s)}
		<input type="hidden" name="schemas" value={s} />
	{/each}

	<RadioGroup name="format" label="Format" hint={ceilingHint} bind:value={format} options={formatOptions} />

	{#if format === 'template'}
		<Textarea
			id="{idPrefix}-template"
			name="template"
			label="Template"
			hint="Rendered once per entry. Fields: .Schema, .Slug, .Title, .Body, .Meta, .Status, .PublishedAt, .CreatedAt, .UpdatedAt."
			rows={5}
			bind:value={template}
			required
		/>
	{/if}

	<CheckboxGroup
		name="statuses"
		label="Statuses"
		hint={statuses.length === 0 ? 'Leave all unchecked to export every status.' : undefined}
		orientation="horizontal"
		options={statusOptions}
		bind:value={statuses}
	/>

	<input type="hidden" name="include_schemas" value={includeSchemas ? 'true' : 'false'} />
	<Toggle
		id="{idPrefix}-include-schemas"
		label="Include the content type definitions"
		hint={format === 'json' || format === 'yaml'
			? 'Adds them to the document next to the entries.'
			: 'Adds a schemas.json file next to the data, so the download becomes a zip.'}
		bind:checked={includeSchemas}
	/>

	<input type="hidden" name="include_media" value={includeMedia ? 'true' : 'false'} />
	<Toggle
		id="{idPrefix}-include-media"
		label="Bundle referenced media"
		hint="Downloads a zip with a folder for each entry, holding its content and the files it references."
		bind:checked={includeMedia}
	/>
</div>
