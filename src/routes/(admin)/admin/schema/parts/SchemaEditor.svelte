<script lang="ts" module>
	export type EditorTab = 'definition' | 'api' | 'history';
</script>

<script lang="ts">
	import { Alert, Badge, Button, Checkbox, Collapsible, CopyButton, Input, NumberInput, SectionHeading, SegmentedControl, Select, Tabs, type SelectOption } from '@lyeve-labs/ui-kit';
	import type { FieldType, Schema, SchemaField, TransportMode, TransportName } from '@lyeve-labs/client';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { tick } from 'svelte';
	import type { Action } from 'svelte/action';
	import { BookOpen, ChevronDown, GripVertical, Link2, Pencil, Plus, RefreshCw, Trash2, TriangleAlert } from '@lucide/svelte';
	import { collectionRoutes } from '$lib/api/collection-api';
	import { curlFor } from '$lib/api/request-preview';
	import { RELATION_KINDS, planRelation, planSchemaRelations, tableName, type RelationType } from '$lib/relations';
	import { decimalScale, dropUnlocalizableMark, fieldNameTarget, localizableProblem, type Problem } from '$lib/schema/editor';
	import { ICON } from '$lib/icon';
	import { methodTone } from '$lib/tones';
	import SchemaHistory from './SchemaHistory.svelte';
	import type { DdlHistory } from './ddl-history.svelte';
	import { addField, addRelation, dropInertFlags, fieldLabel, inertFlags, isTimestamp, removeField } from './schema-fields';

	/**
	 * The editor for one schema. The list view shows it beside the rail and the
	 * canvas in a panel beside the diagram, so both edit the same way.
	 *
	 * The schema is the page's own state, bound so the edits land where the
	 * page reads dirty, problems and the undo stack. The cleared-mark notes are
	 * bound too, so they outlive a switch between the list and the canvas.
	 */
	let {
		schema = $bindable(),
		localizedCleared = $bindable(),
		saved,
		schemas,
		canWrite,
		isNewSchema,
		dirty,
		saveError,
		onreload,
		reloading = false,
		problems,
		isSuperAdmin,
		ddl,
		onrename,
		tab = $bindable('definition'),
	}: {
		schema: Schema;
		localizedCleared: Record<string, string>;
		saved: Schema | null;
		schemas: Schema[];
		canWrite: boolean;
		isNewSchema: boolean;
		dirty: boolean;
		saveError: string;
		/** Set when the failed save can be fixed by opening the content type again. */
		onreload?: () => void;
		reloading?: boolean;
		problems: Problem[];
		isSuperAdmin: boolean;
		ddl: DdlHistory;
		onrename: () => void;
		/** The tab on screen. The page holds it, so it outlives a switch between the list and the canvas. */
		tab?: EditorTab;
	} = $props();

	/**
	 * A saved table has an API and, for a super admin, a history, each a tab
	 * beside its definition. A new one has only the definition, so it draws no
	 * strip. A tab that is not offered falls back to the definition.
	 */
	const tabItems = $derived<{ id: EditorTab; label: string; count?: number }[]>(
		saved
			? [
					{ id: 'definition', label: 'Definition' },
					{ id: 'api', label: 'API' },
					...(isSuperAdmin ? [{ id: 'history' as const, label: 'History', count: ddl.view?.pending || undefined }] : []),
				]
			: []
	);
	const activeTab = $derived<EditorTab>(tabItems.some((t) => t.id === tab) ? tab : 'definition');
	const tabbed = $derived(tabItems.length > 0);

	function chooseTab(id: string) {
		tab = id as EditorTab;
		// The history is read while its tab is shown, not when the table opens,
		// so a type opened later on its definition costs no request.
		ddl.open = tab === 'history';
	}

	type SystemColumn = 'with_created_at' | 'with_updated_at' | 'with_soft_delete' | 'with_localization';

	/**
	 * The field types, grouped and searchable.
	 *
	 * The labels stay the machine names the API stores, so what the picker says
	 * is what the schema holds and what the docs call it. The friendly words go
	 * in `keywords`, where they find the row without renaming it.
	 */
	const FIELD_TYPE_OPTIONS: SelectOption[] = [
		{ value: 'text', label: 'text', group: 'Text', keywords: ['string', 'varchar'] },
		{ value: 'rich_text', label: 'rich_text', group: 'Text', keywords: ['html', 'body', 'wysiwyg'] },
		{ value: 'email', label: 'email', group: 'Text' },
		{ value: 'url', label: 'url', group: 'Text', keywords: ['link', 'href'] },
		{ value: 'uid', label: 'uid', group: 'Text', keywords: ['slug', 'identifier', 'uuid'] },
		{ value: 'number', label: 'number', group: 'Numbers and dates', keywords: ['float', 'double'] },
		{ value: 'integer', label: 'integer', group: 'Numbers and dates', keywords: ['int', 'bigint', 'whole number'] },
		{ value: 'decimal', label: 'decimal', group: 'Numbers and dates', keywords: ['numeric', 'money', 'price', 'currency'] },
		{ value: 'boolean', label: 'boolean', group: 'Numbers and dates', keywords: ['true', 'false', 'flag'] },
		{ value: 'date', label: 'date', group: 'Numbers and dates' },
		{ value: 'datetime', label: 'datetime', group: 'Numbers and dates', keywords: ['timestamp'] },
		{ value: 'json', label: 'json', group: 'Structured', keywords: ['object', 'array'] },
		{ value: 'media', label: 'media', group: 'Structured', keywords: ['image', 'file', 'upload'] },
		// Its own group, so the heading says the word. Under Structured it would
		// sit below the fold of a picker that opens scrolled to the top, past
		// media, where nobody looking for relations thinks to scroll.
		{ value: 'relation', label: 'relation', group: 'Relations', keywords: ['foreign key', 'fk', 'reference', 'join', 'belongs to', 'has many'] },
	];

	/**
	 * The relation kinds, read from the module that knows what each one does.
	 *
	 * Each label is the kind in a few words, short enough for every kind to
	 * stay in sight in one row. The panel under the row names the chosen
	 * kind's cardinality and machine name, so a reader who knows `belongs_to`
	 * still finds it and a reader who does not is told what it means.
	 */
	const RELATION_OPTIONS: { value: RelationType; label: string }[] = RELATION_KINDS.map((k) => ({
		value: k.type,
		label: k.label,
	}));

	// A schema is served over every transport until it says otherwise, so each
	// control shows "Read and write" for a schema that carries no block at all
	// and one is only written once something is narrowed.
	const TRANSPORTS: { key: TransportName; label: string; hint: string }[] = [
		{ key: 'rest', label: 'REST', hint: 'The content API.' },
		{ key: 'graphql', label: 'GraphQL', hint: 'Queries, mutations, subscriptions.' },
		{ key: 'grpc', label: 'gRPC', hint: 'The content and schema services.' },
	];

	const TRANSPORT_MODE_OPTIONS: { value: TransportMode; label: string }[] = [
		{ value: 'rw', label: 'Read and write' },
		{ value: 'r', label: 'Read only' },
		{ value: 'w', label: 'Write only' },
		{ value: 'off', label: 'Not served' },
	];

	function transportMode(s: Schema, key: TransportName): TransportMode {
		return s.transports?.[key] ?? 'rw';
	}

	function setTransport(key: TransportName, mode: TransportMode) {
		const next: Partial<Record<TransportName, TransportMode>> = {
			...(schema.transports ?? {}),
			[key]: mode,
		};
		// Drop the keys that say nothing. Storing "rw" on every transport would
		// turn a default nobody chose into a decision the definition records,
		// and the next reader could not tell the two apart.
		for (const k of Object.keys(next) as TransportName[]) {
			if (next[k] === 'rw') delete next[k];
		}
		schema.transports = Object.keys(next).length > 0 ? next : undefined;
	}

	/** Which schemas a relation may point at. Only has_many may point at its own. */
	function targetOptions(from: Schema, field: SchemaField): SelectOption[] {
		return schemas
			.filter((s) => s.name !== from.name || field.relation_type === 'has_many')
			.map((s) => ({
				value: s.name,
				label: s.display_name || s.name,
				keywords: [s.name, tableName(s.name)],
			}));
	}

	/**
	 * Keeps a row's keystrokes out of the drag zone.
	 *
	 * svelte-dnd-action puts a keydown listener on the row and reads Enter,
	 * Space and the arrow keys on it as drag commands. The listener that stops
	 * them has to be a real one on the element around the controls: an
	 * `onkeydown` attribute is delegated from the document root and runs after
	 * the event has already bubbled past the row, so stopping propagation there
	 * stops nothing. The kit's Checkbox and Select render their own input, so
	 * this is also the only element the page can reach.
	 */
	const keysStayInRow: Action<HTMLElement> = (node) => {
		const stop = (e: KeyboardEvent) => e.stopPropagation();
		node.addEventListener('keydown', stop);
		return {
			destroy() {
				node.removeEventListener('keydown', stop);
			},
		};
	};

	/**
	 * Relations that will not resolve as configured.
	 *
	 * An inverse relation depends on a field of another schema, which is the one
	 * thing this page cannot show in the row that declares it. Without the
	 * summary the only way to find a broken one is to open every relation field
	 * in turn.
	 */
	let brokenRelations = $derived(planSchemaRelations(schema, schemas).filter((r) => r.plan.problem !== null));

	const problemFor = (id: string) => problems.find((p) => p.fieldId === id && p.target === fieldNameTarget(id))?.message;
	const schemaNameProblem = $derived(problems.find((p) => p.fieldId === null)?.message);
	const problemAt = (target: string) => problems.find((p) => p.target === target)?.message;

	/**
	 * Why a row's localized mark was just cleared, by row id. It stays beside
	 * the row until the field can carry the mark again, so the change the
	 * operator did not ask for is never silent. The page holds the record.
	 */
	function followLocalizable(field: SchemaField, key: string) {
		const why = dropUnlocalizableMark(field);
		if (why !== null) localizedCleared[key] = why;
		else if (localizableProblem(field) === null) delete localizedCleared[key];
	}

	function setFieldType(field: SchemaField, next: FieldType, rowId: string) {
		field.field_type = next;
		followLocalizable(field, rowId);
		// A relation with no type saves as a relation to nothing. The picker
		// beside this one already reads as belongs_to, so the field agrees with
		// what the operator can see rather than with an empty box behind it.
		if (next === 'relation' && !field.relation_type) field.relation_type = 'belongs_to';
		// Only a decimal has a precision and a scale, and the engine refuses
		// either on any other type.
		if (next !== 'decimal') {
			delete field.precision;
			delete field.scale;
		}
		dropInertFlags(field);
	}

	// The engine's bounds for a decimal, and the values it uses when the
	// definition names none.
	const DECIMAL_PRECISION_MIN = 1;
	const DECIMAL_PRECISION_MAX = 38;
	const DECIMAL_SCALE_MAX = 30;
	const DECIMAL_PRECISION_DEFAULT = 18;

	/** The largest scale a decimal's precision allows. */
	function maxScale(field: SchemaField): number {
		return Math.min(field.precision ?? DECIMAL_PRECISION_DEFAULT, DECIMAL_SCALE_MAX);
	}

	// A typed value is not held to the box's bounds, so it is brought inside
	// them here rather than refused at save.
	const within = (n: number, lo: number, hi: number) => Math.min(Math.max(Math.trunc(n), lo), hi);

	/**
	 * Shows the stored value in a box whose typed text was brought inside the
	 * bounds. The box's value is bound, so its steppers start from the stored
	 * value, but its text redraws only when that value changes, so a 50 typed
	 * over a stored 38 would otherwise stay on screen while 38 saves.
	 */
	function showStored(id: string, stored: number) {
		void tick().then(() => {
			const box = document.getElementById(id);
			if (box instanceof HTMLInputElement && box.value !== String(stored)) box.value = String(stored);
		});
	}

	/**
	 * Sets the precision and leaves the scale alone. The box reports each
	 * keystroke, so typing 20 passes through 2, and lowering the scale there
	 * would change it without a word. A scale the precision cannot hold is a
	 * problem the save waits on instead.
	 */
	function setPrecision(field: SchemaField, next: number, id: string) {
		field.precision = within(next, DECIMAL_PRECISION_MIN, DECIMAL_PRECISION_MAX);
		if (field.precision !== next) showStored(id, field.precision);
	}

	function setScale(field: SchemaField, next: number, id: string) {
		field.scale = within(next, 0, DECIMAL_SCALE_MAX);
		if (field.scale !== next) showStored(id, field.scale);
	}

	/**
	 * The reorder animation runs on the theme's base rung. The library takes a
	 * number rather than a class, so the token is read once, and the fallback
	 * is the token's own value for the first render on the server.
	 */
	const FLIP_MS =
		typeof document === 'undefined'
			? 200
			: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--duration-base')) || 200;

	function handleDnd(e: CustomEvent<DndEvent<SchemaField>>) {
		// Keep top system fields (id, etc.) at the front, timestamp fields at the back.
		const topSys = schema.fields.filter((f) => f.system && !isTimestamp(f));
		const bottomSys = schema.fields.filter((f) => f.system && isTimestamp(f));
		const user = e.detail.items.filter((f) => !f.system);
		schema.fields = [...topSys, ...user, ...bottomSys];
	}

	/** Toggles a system column the engine manages. Removing one that exists is named at save. */
	function toggleSystemColumn(field: SystemColumn, checked: boolean) {
		schema[field] = checked;
	}

	// Derived field groupings, updated whenever the schema changes.
	/**
	 * What a system field's row says about it, from its own flags. The id is
	 * required and indexed, and the key of an optional relation is indexed
	 * but not required.
	 */
	function systemNote(field: { required?: boolean; indexed?: boolean }): string {
		return ['system', field.required && 'required', field.indexed && 'indexed'].filter(Boolean).join(', ');
	}

	/**
	 * The schema a relation points at, when public delivery would leave the
	 * relation out because that schema is not public itself.
	 */
	function unservedTarget(field: SchemaField): string | null {
		if (!schema.public_delivery || !field.relation_to) return null;
		const target = schemas.find((s) => s.name === field.relation_to);
		if (!target || target.public_delivery) return null;
		return target.display_name || target.name;
	}

	/** The schema plugin refuses longer help text. */
	const HELP_TEXT_MAX = 500;

	/** Which rows show their help text band, by row id. */
	let helpOpen = $state<Record<string, boolean>>({});

	let topSysFields = $derived(schema.fields.filter((f) => f.system && !isTimestamp(f)));
	let userFields = $derived(schema.fields.filter((f) => !f.system));
	let bottomSysFields = $derived(schema.fields.filter((f) => f.system && isTimestamp(f)));
	let savedTsNames = $derived(new Set(bottomSysFields.map((f) => f.name)));
</script>

<!-- A field the server owns. It sits in the same columns as an editable row so
     the Req and Idx boxes below stay under their headings. -->
{#snippet lockedField(name: string, type: string, note: string)}
	<div class="flex items-center gap-3 rounded-lg border border-line/40 bg-surface p-3">
		<span class="w-3.5 shrink-0"></span>
		<span class="min-w-0 flex-1">
			<span class="text-sm font-medium text-brand">{name}</span>
			<span class="ms-2 text-xs text-faint">{note}</span>
		</span>
		<span class="shrink-0 @xl:w-36"><Badge>{type}</Badge></span>
		<span class="hidden w-10 shrink-0 @xl:block"></span>
		<span class="hidden w-10 shrink-0 @xl:block"></span>
		<span class="hidden w-10 shrink-0 @xl:block"></span>
		<span class="hidden w-14 shrink-0 @xl:block"></span>
		<span class="hidden w-12 shrink-0 @xl:block"></span>
		<span class="hidden w-8 shrink-0 @xl:block"></span>
		<span class="hidden w-8 shrink-0 @xl:block"></span>
	</div>
{/snippet}

<!-- A column the next save will create, drawn dashed because it does not exist yet. -->
{#snippet plannedField(name: string, type: string, note: string, role: string)}
	<div class="flex items-center gap-3 rounded-lg border border-dashed border-line/50 bg-surface/60 p-3">
		<span class="w-3.5 shrink-0"></span>
		<div class="min-w-0 flex-1">
			<span class="text-sm font-medium text-brand/70">{name}</span>
			<span class="ms-2 text-xs text-faint italic">{role}</span>
			<p class="mt-0.5 text-xs text-faint">{note}</p>
		</div>
		<span class="shrink-0 @xl:w-36"><Badge>{type}</Badge></span>
		<span class="hidden w-10 shrink-0 @xl:block"></span>
		<span class="hidden w-10 shrink-0 @xl:block"></span>
		<span class="hidden w-10 shrink-0 @xl:block"></span>
		<span class="hidden w-14 shrink-0 @xl:block"></span>
		<span class="hidden w-12 shrink-0 @xl:block"></span>
		<span class="hidden w-8 shrink-0 @xl:block"></span>
		<span class="hidden w-8 shrink-0 @xl:block"></span>
	</div>
{/snippet}

<!-- Positioned, so the absolutely placed sr-only labels inside it scroll here
     instead of stretching the shell's scroll range below the editor. -->
<div class="relative min-h-0 min-w-0 flex-1 overflow-auto p-6">
<!-- The editor sits beside the list in a wide column and in a panel as narrow
     as 420px on the canvas, so its rows split by its own width, not the
     window's. -->
<div class="@container flex flex-col gap-4">
	<!-- The live region is mounted whether or not there is a message in
	     it. Alert carries role="alert", but an element inserted into the
	     page at the moment of the failure is announced inconsistently.
	     A region already in the tree is a change a reader is watching. -->
	<div aria-live="assertive" aria-atomic="true">
		{#if saveError}
			<div data-testid="save-error">
				<Alert tone="danger">
					<p>{saveError}</p>
					{#if onreload}
						<div class="mt-3">
							<Button variant="secondary" size="sm" loading={reloading} onclick={onreload}>
								<RefreshCw size={ICON.sm} aria-hidden="true" /> Reload
							</Button>
						</div>
					{/if}
				</Alert>
			</div>
		{/if}
	</div>


	<!-- Under the live region, so a failed save shows whichever tab is open. -->
	{#if tabbed}
		<Tabs items={tabItems} active={activeTab} onchange={chooseTab} />
	{/if}

	{#if activeTab === 'definition'}
	<!-- The kit's tabs carry no ids, so each panel names itself. -->
	<div class="flex min-w-0 flex-col gap-4" role={tabbed ? 'tabpanel' : undefined} aria-label={tabbed ? 'Definition' : undefined}>
	<fieldset disabled={!canWrite} class="flex min-w-0 flex-col gap-4">
	<legend class="sr-only">Definition of {schema.display_name || schema.name || 'the new content type'}</legend>
	<div class="grid min-w-0 gap-3 @xl:grid-cols-2">
		<Input
			id="schema-display-name"
			label="Display name"
			placeholder="Content type display name"
			bind:value={schema.display_name}
		/>
		{#if saved}
			<!-- A saved table moves only through Rename, which takes its rows
			     with it. Edited here, the new name would save a second, empty
			     table. -->
			<div class="flex items-end gap-2">
				<Input
					id="schema-name"
					label="Machine name"
					value={schema.name}
					readonly
					class="flex-1"
					mono
				/>
				{#if canWrite}
					<Button
						variant="secondary"
						onclick={onrename}
						disabled={dirty}
						hint={dirty ? 'Save or undo the changes first' : 'Rename the table and its API path'}
					>
						<Pencil size={ICON.sm} /> Rename
					</Button>
				{/if}
			</div>
		{:else}
			<Input
				id="schema-name"
				label="Machine name"
				placeholder="schema_name"
				hint="The table name and the API path. Letters, digits and underscores."
				bind:value={schema.name}
				error={schemaNameProblem}
			/>
		{/if}
	</div>

	<!-- What the engine keeps beside the fields. Open for a new schema,
	     where it is chosen. Folded for a saved one, where the fields are
	     what is being edited and this would push them down the page. -->
	<Collapsible label="Table settings" open={isNewSchema}>
		<div class="flex flex-col gap-4">
			<div class="flex flex-wrap items-center gap-x-6 gap-y-3">
				<Checkbox
					size="sm"
					label="created_at"
					checked={schema.with_created_at ?? false}
					onchange={(checked) => toggleSystemColumn('with_created_at', checked)}
				/>
				<Checkbox
					size="sm"
					label="updated_at"
					checked={schema.with_updated_at ?? false}
					onchange={(checked) => toggleSystemColumn('with_updated_at', checked)}
				/>
				<Checkbox
					size="sm"
					label="soft_delete"
					checked={schema.with_soft_delete ?? false}
					onchange={(checked) => toggleSystemColumn('with_soft_delete', checked)}
				/>
				{#if saved && schema.with_localization}
					<!-- Translations live per entry and per locale in the
					     localization plugin, and the _locale column this flag adds is
					     read by nothing. A schema that carries it keeps its column and
					     shows the flag as it is. A new schema is never offered it. -->
					<Checkbox
						size="sm"
						label="localization"
						checked={true}
						disabled
						hint="Not used. Translations are stored per entry and locale."
					/>
				{/if}
				<span class="text-xs text-faint">System columns, set automatically.</span>
			</div>
			<div class="border-t border-line pt-4">
				<div class="mb-3">
					<SectionHeading level={3}>Transports</SectionHeading>
					<span class="mt-1 block text-xs text-faint">
						Choose where this content type is served. A new content type is read and write on all
						three until you narrow it here.
					</span>
				</div>
				<div class="flex flex-col gap-3">
					{#each TRANSPORTS as t (t.key)}
						<div class="min-w-0" data-testid="transport-{t.key}">
							<SegmentedControl
								id="transport-{t.key}"
								label={t.label}
								size="sm"
								class="max-w-full overflow-x-auto"
								options={TRANSPORT_MODE_OPTIONS}
								value={transportMode(schema, t.key)}
								onchange={(v) => setTransport(t.key, v)}
								hint={t.hint}
							/>
						</div>
					{/each}
				</div>
			</div>
			<div class="flex flex-col gap-3 border-t border-line pt-4">
				<SectionHeading level={3}>Public delivery</SectionHeading>
				<Checkbox
					id="schema-public-delivery"
					label="Serve on public delivery"
					description="Anyone can read the published entries of this content type without a token, and a CDN can cache them. Fields you mark Private are left out."
					checked={schema.public_delivery === true}
					onchange={(checked) => (schema.public_delivery = checked || undefined)}
				/>
				{#if schema.public_delivery && !schema.with_draft_publish}
					<Alert tone="warn">
						This content type has no draft and publish, so public delivery serves every entry.
					</Alert>
				{/if}
			</div>
		</div>
	</Collapsible>

	{#if brokenRelations.length > 0}
		<div data-testid="relation-problems">
			<Alert tone="warn">
				<span class="flex items-start gap-2">
					<TriangleAlert size={ICON.sm} class="mt-0.5 shrink-0" />
					<span>
						{brokenRelations.length}
						{brokenRelations.length === 1 ? 'relation' : 'relations'} on this content type
						will not work as configured. An inverse relation depends on a field in
						the other content type, which this row cannot show.
						<span class="mt-1 block space-y-0.5">
							{#each brokenRelations as r (r.field.id ?? r.field.name)}
								<span class="block">
									<span class="font-mono">{r.field.name || 'unnamed field'}</span>:
									{r.plan.problem}
								</span>
							{/each}
						</span>
					</span>
				</span>
			</Alert>
		</div>
	{/if}

<div class="@container space-y-2">
	<!-- The Req and Idx boxes in the rows below are named by these two
	     headings, so each box repeats the heading and adds its field. -->
	<!-- The column labels line up with the row's fixed widths, which
	     only hold once this list is 36rem wide. The list shares the window
	     with the navigation and the schema list, so the breakpoint reads
	     its own width rather than the window's. Below it the row wraps and
	     each box carries its own short label instead. -->
	<!-- The transparent border stands in for the rows' own, so the columns
	     start at the same offset. -->
	<div class="hidden items-center gap-3 border border-transparent px-3 text-xs text-faint @xl:flex">
		<span class="w-3.5 shrink-0"></span>
		<span class="flex-1">Field</span>
		<span class="w-36 shrink-0">Type</span>
		<span class="w-10 shrink-0 text-center">Req</span>
		<span class="w-10 shrink-0 text-center">Idx</span>
		<span class="w-10 shrink-0 text-center" title="Translated per locale">i18n</span>
		<span class="w-14 shrink-0 text-center" title="Never served on public delivery">Private</span>
		<span class="w-12 shrink-0 text-center" title="Never read or filled by the assistant">No AI</span>
		<span class="w-8 shrink-0"></span>
		<span class="w-8 shrink-0"></span>
	</div>

	{#if topSysFields.length > 0}
		{#each topSysFields as field (field.id ?? field.name)}
			{@render lockedField(field.name, field.field_type, systemNote(field))}
		{/each}
	{:else}
		{@render plannedField('id', 'uid', 'Generated UUID. Unique, indexed and not editable.', 'auto, system')}
	{/if}

	<div
		use:dndzone={{ items: userFields, flipDurationMs: FLIP_MS, dragDisabled: !canWrite }}
		onconsider={handleDnd}
		onfinalize={handleDnd}
		class="space-y-2"
	>
		{#each userFields as field, i (field.id ?? i)}
		{@const rowId = field.id ?? String(i)}
		{@const plan = planRelation(schema, field, schemas)}
		{@const inert = inertFlags(field)}
		<div class="rounded-lg border border-line bg-surface-2">
			<div class="flex items-center gap-3 p-3">
				<GripVertical size={ICON.sm} class="shrink-0 cursor-grab text-faint" />
				<div class="flex min-w-0 flex-1 flex-wrap items-center gap-3" use:keysStayInRow>
					<Input
						id={fieldNameTarget(rowId)}
						name="field-name-{rowId}"
						aria-label="Field name"
						autocomplete="off"
						placeholder="field_name"
						bind:value={field.name}
						error={problemFor(rowId)}
						class="min-w-40 flex-1"
					/>

					<label for="field-type-{rowId}" class="sr-only">
						Type, {fieldLabel(field)}
					</label>
					<Select
						id="field-type-{rowId}"
						searchable
						options={FIELD_TYPE_OPTIONS}
						value={field.field_type}
						onvaluechange={(v) => setFieldType(field, v as FieldType, rowId)}
						class="w-36 shrink-0"
					/>

					<div class="flex shrink-0 items-center gap-1.5 @xl:w-10 @xl:justify-center" title={inert.required ?? undefined}>
						<span class="text-xs text-faint @xl:hidden" aria-hidden="true">Req</span>
						<Checkbox
							size="sm"
							label="Required, {fieldLabel(field)}"
							labelHidden
							checked={field.required}
							disabled={inert.required !== null}
							onchange={(checked) => (field.required = checked)}
						/>
					</div>
					<div class="flex shrink-0 items-center gap-1.5 @xl:w-10 @xl:justify-center" title={inert.indexed ?? undefined}>
						<span class="text-xs text-faint @xl:hidden" aria-hidden="true">Idx</span>
						<Checkbox
							size="sm"
							label="Indexed, {fieldLabel(field)}"
							labelHidden
							checked={field.indexed}
							disabled={inert.indexed !== null}
							onchange={(checked) => (field.indexed = checked)}
						/>
					</div>
					<!-- Translatable. It generates no column, because a
					     translation is stored once per entry and locale, so
					     marking a field runs no migration. The box is
					     disabled rather than hidden where it cannot apply,
					     and says why: hiding it would leave somebody looking
					     for a control the engine does have. -->
					<div
						class="flex shrink-0 items-center gap-1.5 @xl:w-10 @xl:justify-center"
						title={localizableProblem(field) ?? 'Translated per locale.'}
					>
						<span class="text-xs text-faint @xl:hidden" aria-hidden="true">i18n</span>
						<Checkbox
							size="sm"
							label="Translated per locale, {fieldLabel(field)}"
							labelHidden
							checked={field.localized === true}
							disabled={localizableProblem(field) !== null}
							onchange={(checked) => (field.localized = checked)}
						/>
					</div>
					<!-- Left out of public delivery. Unchecked stores no mark, so
					     an undo back to the saved definition is not an edit. -->
					<div class="flex shrink-0 items-center gap-1.5 @xl:w-14 @xl:justify-center" title="Never served on public delivery">
						<span class="text-xs text-faint @xl:hidden" aria-hidden="true">Private</span>
						<Checkbox
							size="sm"
							label="Private, {fieldLabel(field)}"
							labelHidden
							checked={field.private === true}
							onchange={(checked) => (field.private = checked || undefined)}
						/>
					</div>
					<!-- Kept from the assistant. Unchecked stores no mark, as Private does. -->
					<div class="flex shrink-0 items-center gap-1.5 @xl:w-12 @xl:justify-center" title="Never read or filled by the assistant">
						<span class="text-xs text-faint @xl:hidden" aria-hidden="true">No AI</span>
						<Checkbox
							size="sm"
							label="No AI, {fieldLabel(field)}"
							labelHidden
							checked={field.no_ai === true}
							onchange={(checked) => (field.no_ai = checked || undefined)}
						/>
					</div>
					<button
						type="button"
						onclick={() => (helpOpen[rowId] = !helpOpen[rowId])}
						aria-expanded={helpOpen[rowId] === true}
						aria-controls="help-band-{rowId}"
						aria-label="Help text, {fieldLabel(field)}"
						title={field.help_text ? 'Help text set' : 'Add help text'}
						class="relative hit-area flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-surface-2 hover:text-fg {field.help_text ? 'text-brand' : 'text-faint'}"
					>
						<ChevronDown size={ICON.sm} class="transition-transform duration-base {helpOpen[rowId] ? 'rotate-180' : ''}" />
					</button>
					{#if canWrite}
					<button
						type="button"
						onclick={() => removeField(schema, rowId)}
						aria-label="Remove field {fieldLabel(field)}"
						class="relative hit-area flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-faint transition-colors duration-base hover:bg-surface-2 hover:text-danger"
					>
						<Trash2 size={ICON.sm} />
					</button>
					{:else}
					<!-- Holds the remove button's column, so the boxes stay under their headings. -->
					<span class="hidden w-8 shrink-0 @xl:block"></span>
					{/if}
				</div>
			</div>

			{#if helpOpen[rowId]}
				<!-- Its own band under the row, as the relation's is: on the row's
				     line a sentence-long input has no room to be read. -->
				<div id="help-band-{rowId}" class="border-t border-line/60 bg-surface/60 p-3" use:keysStayInRow>
					<Input
						id="help-text-{rowId}"
						name="help-text-{rowId}"
						label="Help text"
						hint="Shown under the field to editors and followed by the assistant, up to 500 characters."
						maxlength={HELP_TEXT_MAX}
						autocomplete="off"
						value={field.help_text ?? ''}
						oninput={(e: Event & { currentTarget: HTMLInputElement }) => (field.help_text = e.currentTarget.value || undefined)}
					/>
				</div>
			{/if}

			{#if localizedCleared[rowId] && localizableProblem(field) !== null}
				<p id="localized-note-{rowId}" class="px-3 pb-3 text-xs text-muted">
					No longer translated per locale. {localizedCleared[rowId]}
				</p>
			{/if}

			{#if field.field_type === 'relation'}
				<!-- Its own band under the row rather than three more boxes
				     inside it. On the same line as the name, the type and two
				     checkboxes, every relation control is too narrow to read
				     and nothing has room to say what the relation does. -->
				<div
					class="space-y-3 border-t border-line/60 bg-surface/60 p-3"
					data-testid="relation-panel-{rowId}"
					use:keysStayInRow
				>
					<!-- The problem list moves focus to the kind's radio group by its
					     id, and the group names the problem as its description. -->
					<div class="min-w-0">
						<SegmentedControl
							id="relation-type-{rowId}"
							label="Relation"
							size="sm"
							class="max-w-full overflow-x-auto"
							options={RELATION_OPTIONS}
							value={field.relation_type ?? 'belongs_to'}
							onchange={(v) => {
								field.relation_type = v;
								dropInertFlags(field);
							}}
							error={problemAt(`relation-type-${rowId}`)}
						/>
					</div>
					<div class="grid gap-3 @xl:grid-cols-2">
						<Select
							id="relation-target-{rowId}"
							label="Target content type"
							error={problemAt(`relation-target-${rowId}`)}
							searchable
							placeholder="Pick a content type"
							options={targetOptions(schema, field)}
							value={field.relation_to ?? ''}
							onvaluechange={(v) => {
								field.relation_to = v;
							}}
						/>
					</div>
					{#if unservedTarget(field)}
						<p class="text-xs text-muted">
							Public delivery does not serve this relation until {unservedTarget(field)} is public too.
						</p>
					{/if}

					{#if plan}
						<p class="text-sm text-fg">{plan.sentence}</p>

						<dl class="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
							<dt class="text-faint">Cardinality</dt>
							<dd class="text-muted">{plan.kind.cardinality}</dd>
							<dt class="text-faint">Stored as</dt>
							<dd class="font-mono text-muted">{plan.kind.type}</dd>
							<dt class="text-faint">Key stored in</dt>
							<dd class="text-muted">{plan.kind.storage}</dd>
							<dt class="text-faint">Read through</dt>
							<dd class="font-mono text-muted">{plan.reads}</dd>
							<dt class="text-faint">Req and Idx</dt>
							<dd class="text-muted">{plan.flags}</dd>
						</dl>

						{#if plan.creates.length > 0}
							<div>
								<p class="mb-1 text-xs text-faint">Saving creates</p>
								<ul class="space-y-0.5 text-xs text-muted">
									{#each plan.creates as line (line)}
										<li>{line}</li>
									{/each}
								</ul>
							</div>
						{:else}
							<p class="text-xs text-faint">
								Saving adds nothing to this table. This side of the relation comes
								from the other content type.
							</p>
						{/if}

						{#if plan.problem}
							<Alert tone="warn">
								{plan.problem}
								{#if plan.requires && !plan.requires.satisfied}
									Add a field named
									<span class="font-mono">{plan.requires.field}</span>
									to <span class="font-medium">{plan.requires.schema}</span>,
									typed relation, kind "Belongs to one", pointing back here.
								{/if}
							</Alert>
						{/if}
					{:else}
						<p class="text-xs text-faint">
							Pick a target content type to see which table stores this relation and
							what saving creates.
						</p>
					{/if}
				</div>
			{:else if field.field_type === 'decimal'}
				<!-- Precision and scale decide the column, so they sit in a band
				     under the row, as a relation's settings do. An absent value
				     is the engine's default, which is what each box shows. -->
				<div
					class="grid gap-3 border-t border-line/60 bg-surface/60 p-3 @xl:grid-cols-2"
					data-testid="decimal-panel-{rowId}"
					use:keysStayInRow
				>
					<NumberInput
						id="decimal-precision-{rowId}"
						label="Precision"
						hint="The most digits a value can have, from {DECIMAL_PRECISION_MIN} to {DECIMAL_PRECISION_MAX}."
						min={DECIMAL_PRECISION_MIN}
						max={DECIMAL_PRECISION_MAX}
						bind:value={() => field.precision ?? DECIMAL_PRECISION_DEFAULT, (next: number) => setPrecision(field, next, `decimal-precision-${rowId}`)}
					/>
					<NumberInput
						id="decimal-scale-{rowId}"
						label="Scale"
						hint="How many of those digits come after the decimal point, from 0 to {maxScale(field)}."
						min={0}
						max={maxScale(field)}
						bind:value={() => decimalScale(field), (next: number) => setScale(field, next, `decimal-scale-${rowId}`)}
						error={problemAt(`decimal-scale-${rowId}`)}
					/>
				</div>
			{/if}
		</div>
	{/each}
	</div>

	{#each bottomSysFields as field (field.id ?? field.name)}
		{@render lockedField(field.name, 'datetime', 'system, set automatically')}
	{/each}
	{#if schema.with_created_at && !savedTsNames.has('created_at')}
		{@render plannedField('created_at', 'datetime', 'Set on insert. Not editable.', 'auto, system')}
	{/if}
	{#if schema.with_updated_at && !savedTsNames.has('updated_at')}
		{@render plannedField('updated_at', 'datetime', 'Set on every write. Not editable.', 'auto, system')}
	{/if}
	{#if schema.with_soft_delete}
		{@render plannedField('deleted_at', 'datetime', 'Set when a row is soft-deleted. NULL for active rows.', 'system, soft delete')}
	{/if}
	{#if schema.with_localization}
		{@render plannedField('_locale', 'text', 'Translations are stored per entry and locale. This column is not used.', 'system, not read')}
	{/if}
</div>

{#if canWrite}
<div class="flex flex-wrap items-center gap-2">
	<Button variant="outline" size="sm" class="border-dashed" onclick={() => addField(schema)}>
		<Plus size={ICON.sm} /> Add field
	</Button>
	<Button variant="outline" size="sm" class="border-dashed" onclick={() => addRelation(schema)}>
		<Link2 size={ICON.sm} /> Add relation
	</Button>
	<span class="text-xs text-faint">
		A relation is a field typed <span class="font-mono">relation</span>.
	</span>
</div>
{/if}

</fieldset>

<!-- The four relation kinds are four different database objects, and
     the picker shows them as four words. This is the page saying
     which is which, once, rather than each row saying it again. -->
<Collapsible label="How relations work" icon={BookOpen}>
	<div class="space-y-4 text-sm text-muted">
		<p>
			Add one with <span class="font-medium text-fg">Add relation</span>, or
			set any field's type to <span class="font-mono">relation</span>. The row
			then shows a panel where you choose the kind and the target content type, and
			it shows which table stores the relation and what saving creates. The kinds:
		</p>

		<div class="overflow-x-auto">
			<table class="w-full min-w-[36rem] border-collapse text-left text-xs">
				<thead>
					<tr class="border-b border-line text-faint">
						<th scope="col" class="py-2 pe-4 font-medium">Kind</th>
						<th scope="col" class="py-2 pe-4 font-medium">Cardinality</th>
						<th scope="col" class="py-2 pe-4 font-medium">Key stored in</th>
						<th scope="col" class="py-2 font-medium">What saving creates</th>
					</tr>
				</thead>
				<tbody>
					{#each RELATION_KINDS as k (k.type)}
						<tr class="border-b border-line/50 align-top">
							<td class="py-2 pe-4">
								<span class="block text-fg">{k.label}</span>
								<span class="font-mono text-faint">{k.type}</span>
							</td>
							<td class="py-2 pe-4">{k.cardinality}</td>
							<td class="py-2 pe-4">{k.storage}</td>
							<td class="py-2">{k.blurb}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<p>
			An inverse relation is read through a column named after
			<em>this content type</em>, not after the field. An
			<span class="font-mono">author</span> with a
			<span class="font-mono">has_many</span> field called
			<span class="font-mono">articles</span> resolves through
			<span class="font-mono">author_id</span> on
			<span class="font-mono">_article</span>, so the field can be called
			anything and renaming it moves nothing in the database. It does need
			a <span class="font-mono">belongs_to</span> field named
			<span class="font-mono">author</span> on the other content type.
		</p>

		<p>
			A relation is not a column you fill in. Only
			<span class="font-mono">belongs_to</span> adds one here. The other
			three are stored elsewhere, so a content type whose relations all point
			outward has no relation columns of its own. That is expected.
		</p>

		<p>
			Required changes what a delete does. A required
			<span class="font-mono">belongs_to</span> deletes this row when the
			row it points at is deleted. An optional one keeps this row and clears
			the key.
		</p>
	</div>
</Collapsible>

	</div>
	{:else if activeTab === 'api' && saved}
	<div class="flex min-w-0 flex-col gap-3 text-sm text-muted" role="tabpanel" aria-label="API">
		<p>
			Read and write this content type's entries through these routes. Reads need a bearer token. Writes need the
			editor, admin or super admin role. See the
			<a href="/admin/api-reference" class="text-brand hover:underline">API reference</a>
			for every parameter.
		</p>
		<ul class="space-y-2">
			{#each collectionRoutes(schema.name) as route (route.method + route.path)}
				{@const preview = curlFor(route)}
				<li class="rounded-lg border border-line bg-surface p-3">
					<div class="flex flex-wrap items-center gap-2">
						<Badge tone={methodTone(route.method)} class="font-mono">{route.method}</Badge>
						<code class="min-w-0 flex-1 truncate font-mono text-xs text-fg">{route.path}</code>
						<span class="text-xs text-faint">{route.summary}</span>
						<!-- The words say what is copied. Every row's button reads the same,
						     so the tooltip names the route and becomes its description. -->
						<CopyButton
							value={preview}
							text="curl"
							title="Copy a curl request for {route.method} {route.path}"
							size={ICON.xs}
							class="shrink-0"
						/>
					</div>
				</li>
			{/each}
		</ul>
	</div>
	{:else if activeTab === 'history' && saved && isSuperAdmin}
	<div class="min-w-0" role="tabpanel" aria-label="History">
		<SchemaHistory {ddl} />
	</div>
	{/if}
</div>
</div>
