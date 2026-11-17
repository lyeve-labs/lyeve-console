<script lang="ts">
	import { FilterChips, SectionHeading, SegmentedControl, Toggle } from '@lyeve-labs/ui-kit';
	import CodeEditor from './CodeEditor.svelte';
	import GridEditor from './GridEditor.svelte';
	import type { JsonSchema } from '#lib/flow/types.ts';
	import type { ValidationError } from '#lib/api/flows.ts';
	import { errorsForField, propertyList } from '#lib/flow/schema.ts';
	import { INLINE_FORMATS, isInlineFormat, previewCount, type InlineFormat } from '#lib/flow/inline.ts';

	/**
	 * The inspector for data typed in place. The format decides the editor:
	 * a table is a grid, everything else is the code editor in that language.
	 * It writes the same keys the generic form would, so the engine sees one
	 * shape whichever editor drew it.
	 */
	interface Props {
		schema: JsonSchema;
		value: Record<string, unknown>;
		errors?: ValidationError[];
		idPrefix?: string;
		onchange: (value: Record<string, unknown>) => void;
	}

	let { schema, value, errors = [], idPrefix = 'inline', onchange }: Props = $props();

	const LABELS: Record<InlineFormat, string> = { json: 'JSON', yaml: 'YAML', csv: 'CSV', text: 'Text', table: 'Table' };

	const formats = $derived.by(() => {
		const declared = propertyList(schema).find((f) => f.key === 'format')?.schema.enum;
		const list = (Array.isArray(declared) ? declared : [...INLINE_FORMATS]).filter(isInlineFormat);
		return list.map((f) => ({ value: f, label: LABELS[f] }));
	});

	const format = $derived<InlineFormat>(isInlineFormat(value.format) ? value.format : 'json');
	const content = $derived(typeof value.content === 'string' ? value.content : '');
	const header = $derived(value.header !== false);

	const columns = $derived(Array.isArray(value.columns) ? value.columns.map(String) : []);
	const rows = $derived(
		Array.isArray(value.rows) ? value.rows.map((r) => (Array.isArray(r) ? r.map(String) : [])) : []
	);

	function errorFor(key: string): string | undefined {
		const s = schema.properties?.[key] ?? {};
		const found = errorsForField(s, `/config/${key}`, errors);
		return found.length > 0 ? found.map((e) => e.message).join('. ') : undefined;
	}

	function set(patch: Record<string, unknown>) {
		const out = { ...value, ...patch };
		for (const k of Object.keys(patch)) if (out[k] === undefined) delete out[k];
		onchange(out);
	}

	const count = $derived(previewCount(format, content, header));
	const PLACEHOLDER: Record<InlineFormat, string> = {
		json: '[{"id": 1, "name": "one"}]',
		yaml: '- id: 1\n  name: one',
		csv: 'id,name\n1,one',
		text: 'Any text. It may carry {{ expressions }}.',
		table: '',
	};
</script>

<div class="flex flex-col gap-3" data-testid="inline-data-editor">
	<!-- Five formats do not fit one strip in the inspector, so they are chips
	     that wrap. A schema that narrows them to a few keeps the strip. -->
	{#if formats.length >= 5}
		<div class="flex flex-col gap-1.5">
			<span class="text-xs font-medium text-fg" aria-hidden="true">Format</span>
			<FilterChips label="Format" value={format} options={formats} onchange={(v) => set({ format: v })} />
		</div>
	{:else}
		<SegmentedControl
			label="Format"
			size="sm"
			value={format}
			options={formats}
			onchange={(v) => set({ format: v })}
		/>
	{/if}
	{#if errorFor('format')}<span class="text-xs text-danger">{errorFor('format')}</span>{/if}
	{#if format === 'table'}
		<div class="flex flex-col gap-2 rounded-md border border-line p-3">
			<SectionHeading level={3} variant="eyebrow">Table</SectionHeading>
			{#if errorFor('columns') || errorFor('rows')}
				<span class="text-xs text-danger">{errorFor('columns') ?? errorFor('rows')}</span>
			{/if}
			<GridEditor
				{columns}
				{rows}
				idPrefix="{idPrefix}-grid"
				onchange={(next) =>
					set({
						columns: next.columns.length > 0 ? next.columns : undefined,
						rows: next.rows.length > 0 ? next.rows : undefined,
					})}
			/>
		</div>
	{:else}
		<CodeEditor
			id="{idPrefix}-content"
			label="Content"
			language={format}
			value={content}
			placeholder={PLACEHOLDER[format]}
			error={errorFor('content')}
			hint={format === 'text' ? undefined : 'The node passes on the parsed value. Expressions in double braces are filled in first.'}
			oninput={(text) => set({ content: text || undefined })}
		/>
		{#if format === 'csv'}
			<Toggle
				id="{idPrefix}-header"
				label="First line is the header"
				checked={header}
				onchange={(on) => set({ header: on ? undefined : false })}
			/>
		{/if}
		<p class="text-xs text-muted" data-testid="inline-preview">
			{#if count === null}
				Preview: rows cannot be counted until a run fills in the expressions.
			{:else}
				Preview: {count} row{count === 1 ? '' : 's'}
			{/if}
		</p>
	{/if}
</div>
