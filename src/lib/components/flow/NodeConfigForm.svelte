<script lang="ts">
	import { Button, Input, MultiSelect, NumberInput, SectionHeading, Select, Tag, Textarea, Toggle } from '@lyeve-labs/ui-kit';
	import { Lock, Plus, Trash2 } from '@lucide/svelte';
	import NodeConfigForm from './NodeConfigForm.svelte';
	import SourcePicker from './SourcePicker.svelte';
	import CodeEditor from './CodeEditor.svelte';
	import GridEditor from './GridEditor.svelte';
	import type { TablesState } from './TablesPanel.svelte';
	import type { DatasourceOption, FlowOption, JsonSchema, SchemaOption, SystemEvent } from '$lib/flow/types';
	import { GATE_OK, type Gate } from '$lib/api/gate';
	import type { ValidationError } from '$lib/api/flows';
	import {
		datasourceOptions,
		errorsForField,
		eventDescription,
		eventTypeOptions,
		fieldOptions,
		fieldsOf,
		flowOptions,
		fromJSONText,
		hookNameError,
		isLockedOption,
		labelFor,
		languageOf,
		parseNumber,
		propertyList,
		schemaOptions,
		toJSONText,
		widgetFor,
	} from '$lib/flow/schema';
	import { fillableFieldsOf, fillProblem } from '$lib/flow/fill';
	import { ICON } from '$lib/icon';

	interface Props {
		schema: JsonSchema;
		value: Record<string, unknown>;
		/** The JSON pointer this form's keys sit under, for matching validation errors. */
		path?: string;
		errors?: ValidationError[];
		/** Prefix for control ids, so two forms on one page never share one. */
		idPrefix?: string;
		/** The tenant's content schemas, for the schema and field pickers. */
		schemas?: SchemaOption[];
		/** The tenant's datasources, for the datasource picker and the SQL tables. */
		datasources?: DatasourceOption[];
		/** How the datasource read went, so an empty list that was never read is not called empty. */
		datasourcesGate?: Gate;
		/** The published flows, for the flow picker. */
		flows?: FlowOption[];
		/** The id of the flow being edited, which the flow picker leaves out. */
		selfId?: string;
		/** The hooks the engine's plugins publish, for the event picker. */
		events?: SystemEvent[];
		/** Introspection results by datasource id, owned by the page. */
		tables?: Record<string, TablesState>;
		/** Asks the page to introspect a datasource it has no result for. */
		onintrospect?: (id: string) => void;
		/** The form edits the "Fill fields with AI" node, whose field list takes only the fields it may fill. */
		fillNode?: boolean;
		onchange: (value: Record<string, unknown>) => void;
	}

	let {
		schema,
		value,
		path = '/config',
		errors = [],
		idPrefix = 'cfg',
		schemas = [],
		datasources = [],
		datasourcesGate = GATE_OK,
		flows = [],
		selfId,
		events = [],
		tables = {},
		onintrospect,
		fillNode = false,
		onchange,
	}: Props = $props();

	// The sibling that names the schema a field picker reads, and the one
	// that names the datasource a SQL editor introspects. Both are the
	// contract's key names, not node types.
	const SCHEMA_KEY = 'schema';
	const DATASOURCE_KEY = 'datasource';
	const SORT_KEY = 'sort';
	const FILL_KEY = 'fields';

	const schemaRows = $derived(schemaOptions(schemas));
	const flowRows = $derived(flowOptions(flows, selfId));
	const eventRows = $derived(eventTypeOptions(events));
	const siblingFields = $derived(fieldsOf(schemas, value[SCHEMA_KEY]));
	const schemaKnown = $derived(siblingFields.length > 0);

	function fillsFields(key: string): boolean {
		return fillNode && key === FILL_KEY;
	}

	function fieldRows(key: string) {
		if (fillsFields(key)) return fieldOptions(fillableFieldsOf(schemas, value[SCHEMA_KEY]));
		return fieldOptions(siblingFields, key === SORT_KEY);
	}

	/** Why the node refuses each field the list already holds, so a saved one it cannot fill stays in sight. */
	function fillProblems(key: string): string[] {
		if (!fillsFields(key)) return [];
		return tags(value[key]).flatMap((f) => fillProblem(schemas, value[SCHEMA_KEY], f) ?? []);
	}

	const fieldsEmptyHint = $derived(
		typeof value[SCHEMA_KEY] === 'string' && value[SCHEMA_KEY] && !schemaKnown
			? 'This schema is not in the list, so its fields cannot be shown.'
			: 'Choose a schema first to pick from its fields.'
	);

	const datasourceId = $derived.by(() => {
		const name = value[DATASOURCE_KEY];
		return datasources.find((d) => d.name === name)?.id;
	});

	/** The tables for the SQL editor, or the idle state when no known datasource is named. */
	const sqlTables = $derived<TablesState>(
		datasourceId ? (tables[datasourceId] ?? { status: 'loading', tables: [] }) : { status: 'idle', tables: [] }
	);

	const hasSql = $derived(
		propertyList(schema).some((f) => widgetFor(f.schema) === 'code' && languageOf(f.schema, value) === 'sql')
	);

	$effect(() => {
		if (hasSql && datasourceId && !tables[datasourceId]) onintrospect?.(datasourceId);
	});

	// The grid spans two properties: the rows, which carry the hint, and the
	// column list, which is the hinted string list when there is one and the
	// sibling `columns` otherwise. The editor renders once, at the first of
	// the hinted keys.
	const gridKeys = $derived.by(() => {
		const all = propertyList(schema);
		const grid = all.filter((f) => widgetFor(f.schema) === 'grid');
		const rows = grid.find((f) => f.schema.items?.type === 'array')?.key;
		const columns =
			grid.find((f) => f.schema.items?.type === 'string')?.key ??
			all.find((f) => f.key === 'columns' && f.schema.items?.type === 'string')?.key;
		return columns && rows ? { columns, rows, first: grid[0].key } : null;
	});

	function gridColumns(): string[] {
		return gridKeys ? tags(value[gridKeys.columns]) : [];
	}

	function gridRows(): string[][] {
		const raw = gridKeys ? value[gridKeys.rows] : undefined;
		return Array.isArray(raw) ? raw.map((r) => (Array.isArray(r) ? r.map(String) : [])) : [];
	}

	function writeGrid(next: { columns: string[]; rows: string[][] }) {
		if (!gridKeys) return;
		const out = { ...value };
		if (next.columns.length > 0) out[gridKeys.columns] = next.columns;
		else delete out[gridKeys.columns];
		if (next.rows.length > 0) out[gridKeys.rows] = next.rows;
		else delete out[gridKeys.rows];
		onchange(out);
	}

	const EXPRESSION_HINT =
		'Use {{ }} for expressions. Trigger, input, nodes.<id>.output, vars are available';

	const fields = $derived(propertyList(schema));

	function errorFor(key: string, s: JsonSchema): string | undefined {
		const found = errorsForField(s, `${path}/${key}`, errors);
		if (found.length === 0) return undefined;
		return found.map((e) => (e.suffix ? `${e.suffix}: ${e.message}` : e.message)).join('. ');
	}

	function set(key: string, next: unknown) {
		const out = { ...value };
		if (next === undefined) delete out[key];
		else out[key] = next;
		onchange(out);
	}

	function str(v: unknown): string {
		return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
	}

	function tags(v: unknown): string[] {
		return Array.isArray(v) ? v.map(String) : [];
	}

	function addTag(key: string, e: KeyboardEvent) {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		const input = e.currentTarget as HTMLInputElement;
		const text = input.value.trim();
		if (!text) return;
		set(key, [...tags(value[key]), text]);
		input.value = '';
	}

	function removeTag(key: string, index: number) {
		const next = tags(value[key]).filter((_, i) => i !== index);
		set(key, next.length > 0 ? next : undefined);
	}

	function entries(v: unknown): [string, string][] {
		if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
		return Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, toJSONText(val)]);
	}

	function stringValued(s: JsonSchema): boolean {
		const extra = s.additionalProperties;
		return typeof extra === 'object' && extra.type === 'string';
	}

	function writeMap(key: string, rows: [string, string][], s: JsonSchema) {
		const out: Record<string, unknown> = {};
		for (const [k, v] of rows) {
			if (!k) continue;
			out[k] = stringValued(s) ? v : (fromJSONText(v) ?? '');
		}
		set(key, Object.keys(out).length > 0 ? out : undefined);
	}

	function mapKey(key: string, s: JsonSchema, index: number, k: string) {
		const rows = entries(value[key]);
		rows[index] = [k, rows[index]?.[1] ?? ''];
		writeMap(key, rows, s);
	}

	function mapValue(key: string, s: JsonSchema, index: number, v: string) {
		const rows = entries(value[key]);
		rows[index] = [rows[index]?.[0] ?? '', v];
		writeMap(key, rows, s);
	}

	function mapRemove(key: string, s: JsonSchema, index: number) {
		writeMap(key, entries(value[key]).filter((_, i) => i !== index), s);
	}

	let draftKeys = $state<Record<string, string>>({});

	function mapAdd(key: string, s: JsonSchema) {
		const k = (draftKeys[key] ?? '').trim();
		if (!k) return;
		writeMap(key, [...entries(value[key]), [k, '']], s);
		draftKeys = { ...draftKeys, [key]: '' };
	}

	function options(s: JsonSchema): { value: string; label: string }[] {
		return (s.enum ?? []).map((v) => ({ value: String(v), label: String(v) }));
	}

	/** Writes a choice list. An empty one drops the key, so the engine's default applies. */
	function setChoices(key: string, picked: string[]) {
		set(key, picked.length > 0 ? picked : undefined);
	}

	function nested(v: unknown): Record<string, unknown> {
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
	}

	const datasourcesEmpty = $derived.by(() => {
		switch (datasourcesGate.state) {
			case 'ok':
				return 'No datasource of this kind yet. Type the name.';
			case 'forbidden':
				return 'Your role cannot list datasources. Type the name.';
			case 'locked':
			case 'full':
				return 'Datasources are not enabled on this instance. Type the name.';
			case 'absent':
				return 'Datasources are not included in this build. Type the name.';
			default:
				return 'Could not load datasources. Type the name.';
		}
	});
</script>

<div class="flex flex-col gap-3" data-testid="node-config-form">
	{#each fields as field (field.key)}
		{@const widget = widgetFor(field.schema)}
		{@const id = `${idPrefix}-${field.key}`}
		{@const label = labelFor(field.key, field.schema)}
		{@const hint = field.schema.description}
		{@const error = errorFor(field.key, field.schema)}
		{@const current = value[field.key]}
		{#if isLockedOption(field.schema)}
			<p class="-mb-2 flex items-center gap-2 text-xs text-muted" data-testid="option-locked-{field.key}">
				<Lock size={ICON.xs} aria-hidden="true" class="shrink-0" />
				<span>{label}: only the default is enabled on this instance.</span>
			</p>
		{/if}
		{#if gridKeys && field.key === gridKeys.columns && widget !== 'grid'}
			<!-- The grid edits the columns. A second control for them would write the same key. -->
		{:else if widget === 'expression'}
			<Textarea
				{id}
				{label}
				rows={3}
				required={field.required}
				value={str(current)}
				hint={hint ? `${hint} ${EXPRESSION_HINT}` : EXPRESSION_HINT}
				{error}
				oninput={(e) => set(field.key, e.currentTarget.value || undefined)}
				mono
			/>
		{:else if widget === 'string'}
			<Input
				{id}
				{label}
				required={field.required}
				value={str(current)}
				{hint}
				{error}
				oninput={(e) => set(field.key, e.currentTarget.value || undefined)}
			/>
		{:else if widget === 'number'}
			{#if typeof current === 'string'}
				<!-- A number field holding an expression stays a text field until the text is a number again. -->
				<Input
					{id}
					{label}
					required={field.required}
					value={current}
					hint={hint ?? EXPRESSION_HINT}
					{error}
					oninput={(e) => {
						const raw = e.currentTarget.value;
						const n = parseNumber(raw);
						set(field.key, n !== undefined ? n : raw || undefined);
					}}
					mono
				/>
			{:else}
				<NumberInput
					{id}
					{label}
					required={field.required}
					value={typeof current === 'number' ? current : undefined}
					min={field.schema.minimum}
					max={field.schema.maximum}
					{hint}
					{error}
					onchange={(n) => set(field.key, Number.isFinite(n) ? n : undefined)}
				/>
			{/if}
		{:else if widget === 'boolean'}
			<Toggle {id} {label} {hint} checked={current === true} onchange={(on) => set(field.key, on)} />
		{:else if widget === 'enum'}
			<Select
				{id}
				{label}
				required={field.required}
				options={options(field.schema)}
				value={current === undefined || current === null ? null : String(current)}
				placeholder="Choose"
				{hint}
				{error}
				onvaluechange={(v) => set(field.key, v || undefined)}
			/>
		{:else if widget === 'choices'}
			<MultiSelect
				{id}
				{label}
				options={options(field.schema.items ?? {})}
				value={tags(current ?? field.schema.default)}
				placeholder="Choose"
				{hint}
				{error}
				onchange={(picked) => setChoices(field.key, picked)}
			/>
		{:else if widget === 'schema'}
			<SourcePicker
				{id}
				{label}
				required={field.required}
				options={schemaRows}
				value={str(current)}
				{hint}
				{error}
				emptyHint="No content schemas to choose from. Type the name."
				onchange={(v) => set(field.key, v)}
			/>
		{:else if widget === 'field'}
			<SourcePicker
				{id}
				{label}
				required={field.required}
				options={fieldRows(field.key)}
				value={str(current)}
				{hint}
				{error}
				emptyHint={fieldsEmptyHint}
				onchange={(v) => set(field.key, v)}
			/>
		{:else if widget === 'datasource'}
			<SourcePicker
				{id}
				{label}
				required={field.required}
				options={datasourceOptions(datasources, field.schema['x-kinds'])}
				value={str(current)}
				{hint}
				{error}
				emptyHint={datasourcesEmpty}
				onchange={(v) => set(field.key, v)}
			/>
		{:else if widget === 'flow'}
			<SourcePicker
				{id}
				{label}
				required={field.required}
				options={flowRows}
				value={str(current)}
				{hint}
				{error}
				emptyHint="No other flow is published yet. Type the slug."
				customLabel="Another slug or an expression"
				onchange={(v) => set(field.key, v)}
			/>
		{:else if widget === 'event'}
			<SourcePicker
				{id}
				{label}
				required={field.required}
				options={eventRows}
				value={str(current)}
				hint={eventDescription(events, current) ?? hint}
				error={error ?? hookNameError(current)}
				emptyHint="No hooks to choose from. Type the name a plugin publishes."
				customLabel="Another hook name"
				customPlaceholder="plugin:after_something"
				customHint="The name a plugin publishes, such as flow.run_failed."
				onchange={(v) => set(field.key, v)}
			/>
		{:else if widget === 'code'}
			{@const language = languageOf(field.schema, value)}
			<CodeEditor
				{id}
				{label}
				required={field.required}
				value={str(current)}
				{language}
				{hint}
				{error}
				tables={language === 'sql' ? sqlTables : undefined}
				onretry={datasourceId ? () => onintrospect?.(datasourceId) : undefined}
				oninput={(text) => set(field.key, text || undefined)}
			/>
		{:else if widget === 'grid'}
			{#if gridKeys && field.key === gridKeys.first}
				<div class="flex flex-col gap-2 rounded-md border border-line p-3">
					<SectionHeading level={3} variant="eyebrow">Table</SectionHeading>
					{#if error}<span class="text-xs text-danger">{error}</span>{/if}
					<GridEditor columns={gridColumns()} rows={gridRows()} idPrefix={id} onchange={writeGrid} />
				</div>
			{/if}
		{:else if widget === 'tags' || widget === 'fields'}
			<div class="flex flex-col gap-1.5">
				{#if widget === 'fields' && siblingFields.length > 0}
					<!-- Keyed on the count so the picker shows the placeholder again after each pick. -->
					{#key tags(current).length}
					<Select
						{id}
						{label}
						searchable
						options={fieldRows(field.key).filter((o) => !tags(current).includes(o.value))}
						value={null}
						placeholder="Add a field"
						hint={hint ??
							(fillsFields(field.key) && fieldRows(field.key).length === 0
								? 'No field of this content type can be filled with AI.'
								: 'Pick a field, or type a custom one below and press Enter.')}
						{error}
						describedBy={fillProblems(field.key).map((_, i) => `${id}-problem-${i}`).join(' ') || undefined}
						onvaluechange={(v) => {
							if (v) set(field.key, [...tags(current), v]);
						}}
					/>
					{/key}
					<Input
						id="{id}-custom"
						aria-label="{label} custom value"
						placeholder="Custom value, Enter adds it"
						onkeydown={(e) => addTag(field.key, e)}
						mono
					/>
				{:else}
					<Input
						{id}
						{label}
						placeholder="Type a value and press Enter"
						hint={hint ?? (widget === 'fields' ? `Enter adds a value. ${fieldsEmptyHint}` : 'Enter adds a value.')}
						{error}
						onkeydown={(e) => addTag(field.key, e)}
					/>
				{/if}
				{#if tags(current).length > 0}
					<div class="flex flex-wrap gap-1">
						{#each tags(current) as tag, i (`${i}:${tag}`)}
							<Tag
								label={tag}
								tone={fillsFields(field.key) && fillProblem(schemas, value[SCHEMA_KEY], tag) ? 'danger' : undefined}
								removable
								onremove={() => removeTag(field.key, i)}
							/>
						{/each}
					</div>
				{/if}
				{#each fillProblems(field.key) as problem, i (i)}
					<p id="{id}-problem-{i}" class="text-xs text-danger">{problem}</p>
				{/each}
			</div>
		{:else if widget === 'object'}
			<div class="flex flex-col gap-2 rounded-md border border-line p-3">
				<SectionHeading level={3} variant="eyebrow">{label}</SectionHeading>
				{#if hint}<span class="text-xs text-muted">{hint}</span>{/if}
				<NodeConfigForm
					schema={field.schema}
					value={nested(current)}
					path={`${path}/${field.key}`}
					{errors}
					idPrefix={id}
					{schemas}
					{datasources}
					{flows}
					{selfId}
					{events}
					{tables}
					{onintrospect}
					onchange={(v) => set(field.key, Object.keys(v).length > 0 ? v : undefined)}
				/>
			</div>
		{:else if widget === 'map'}
			<div class="flex flex-col gap-2 rounded-md border border-line p-3">
				<SectionHeading level={3} variant="eyebrow">{label}</SectionHeading>
				{#if hint}<span class="text-xs text-muted">{hint}</span>{/if}
				{#if error}<span class="text-xs text-danger">{error}</span>{/if}
				{#each entries(current) as [k, v], i (i)}
					<div class="flex items-end gap-2">
						<Input
							id="{id}-k{i}"
							label="Key"
							value={k}
							class="min-w-0 flex-1"
							onchange={(e) => mapKey(field.key, field.schema, i, e.currentTarget.value)}
						/>
						<Input
							id="{id}-v{i}"
							label="Value"
							value={v}
							class="min-w-0 flex-1"
							onchange={(e) => mapValue(field.key, field.schema, i, e.currentTarget.value)}
							mono
						/>
						<Button
							variant="ghost"
							size="sm"
							aria-label="Remove {k}"
							onclick={() => mapRemove(field.key, field.schema, i)}
						>
							<Trash2 size={ICON.sm} class="text-danger" />
						</Button>
					</div>
				{/each}
				<div class="flex items-end gap-2">
					{#if field.schema['x-keys-source'] === 'content-fields' && siblingFields.length > 0}
						<Select
							id="{id}-new"
							label="New key"
							searchable
							options={fieldRows(field.key).filter((o) => !entries(current).some(([k]) => k === o.value))}
							value={draftKeys[field.key] ?? null}
							placeholder="Pick a field"
							class="min-w-0 flex-1"
							onvaluechange={(v) => (draftKeys = { ...draftKeys, [field.key]: v })}
						/>
					{:else}
						<Input
							id="{id}-new"
							label="New key"
							value={draftKeys[field.key] ?? ''}
							class="min-w-0 flex-1"
							oninput={(e) => (draftKeys = { ...draftKeys, [field.key]: e.currentTarget.value })}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									mapAdd(field.key, field.schema);
								}
							}}
						/>
					{/if}
					<Button variant="secondary" size="sm" onclick={() => mapAdd(field.key, field.schema)}>
						<Plus size={ICON.sm} />
						Add
					</Button>
				</div>
			</div>
		{:else}
			<Textarea
				{id}
				{label}
				rows={4}
				required={field.required}
				value={toJSONText(current)}
				hint={hint ? `${hint} JSON, or an expression.` : 'JSON, or an expression.'}
				{error}
				onblur={(e) => set(field.key, fromJSONText(e.currentTarget.value))}
				mono
			/>
		{/if}
	{/each}
	{#if fields.length === 0}
		<p class="text-sm text-muted">This node has no settings.</p>
	{/if}
</div>
