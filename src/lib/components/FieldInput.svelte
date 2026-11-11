<script lang="ts">
	import {
		Autocomplete,
		Checkbox,
		DatePicker,
		DateTimePicker,
		Input,
		MultiSelect,
		NumberInput,
		Textarea,
	} from '@lyeve-labs/ui-kit';
	import type { SchemaField, Content } from '@lyeve-labs/client';
	import { entryLabel } from '$lib/utils/entry-identity';
	import RichTextEditor from './RichTextEditor.svelte';
	import JsonFieldEditor from './JsonFieldEditor.svelte';
	import MediaPicker from './media/MediaPicker.svelte';
	import type { MediaChoice } from '$lib/api/media';
	import { formatCount } from '$lib/format';
	import { registerOptionLabels } from '$lib/assistant/option-labels';

	type TextareaEv = Event & { currentTarget: HTMLTextAreaElement };

	let {
		field,
		value = $bindable<unknown>(''),
		relationItems = [],
		relationTotal = undefined,
		relationFailed = false,
		relationAssistantLabels = undefined,
		mediaChoices = [],
		id,
		error,
		errorKey,
	}: {
		field: SchemaField;
		value?: unknown;
		relationItems?: Content[];
		/** How many entries the related schema holds. Above the items' count, the picker is cut. */
		relationTotal?: number;
		/** The related schema could not be read, so the picker has nothing to offer. */
		relationFailed?: boolean;
		/** The name an assistant reads for each related entry, by id, in place of the one shown. */
		relationAssistantLabels?: Record<string, string>;
		/** Published library files, offered by a media field's picker. Null when the library could not be read. */
		mediaChoices?: MediaChoice[] | null;
		/**
		 * The id the field's own <Label for=...> points at. Every branch below
		 * puts it on the control it renders, so the label names the control.
		 */
		id?: string;
		/**
		 * The field's validation message. Handed to the control rather than
		 * printed beside it, so it reaches aria-invalid and the paragraph the
		 * control already wires with aria-describedby. Printed alongside, it
		 * would be an unreferenced paragraph that a screen reader never reaches.
		 */
		error?: string;
		/** The key inside a json value that the error is about. */
		errorKey?: string;
	} = $props();

	/*
	 * Every control that posts a value carries the field's name, so the
	 * FormAssist around the form can describe and fill it, and a field marked
	 * No AI or private is withheld there. The help text is the control's hint:
	 * the editor reads it under the field and the assistant follows it.
	 */
	const name = $derived(field.name);
	const noAI = $derived(field.no_ai === true || field.private === true);
	const help = $derived(field.help_text?.trim() || undefined);

	/** The help text, then the hint the control has of its own. */
	function withHelp(own?: string): string | undefined {
		return [help, own].filter(Boolean).join(' ') || undefined;
	}

	const text = {
		get: () => String(value ?? ''),
		set: (next: string) => {
			value = next;
		},
	};

	// A relation option's name, resolved the same way a listing row's is.
	let relationOptions = $derived(
		relationItems.map((item) => ({ value: item.id, label: entryLabel(item) })),
	);

	// The person reads each entry by its name. When that name may be a value
	// the related type keeps from the assistant, the assistant reads another.
	$effect(() => {
		if (!relationAssistantLabels) return;
		return registerOptionLabels(name, new Map(Object.entries(relationAssistantLabels)));
	});

	// The picker is one page of the related collection. Past that page it
	// cannot find an entry, and it says so rather than reading as the whole set.
	const relationCutNote = $derived(
		relationTotal !== undefined && relationTotal > relationItems.length
			? `Showing the first ${formatCount(relationItems.length)} of ${formatCount(relationTotal)} entries in ${field.relation_to}.`
			: undefined,
	);

	let selectedIds = $derived(
		Array.isArray(value) ? (value as unknown[]).map(String).filter(Boolean) : [],
	);

	/**
	 * The rows an inverse relation resolves to, by label where the picker's
	 * items know them and by id where they do not. A populated read hands the
	 * rows themselves. The admin entry hands ids or nothing.
	 */
	let inverseLabels = $derived.by(() => {
		const rows = Array.isArray(value) ? value : value ? [value] : [];
		return rows.map((row) => {
			if (row && typeof row === 'object') return entryLabel(row as Content);
			const found = relationItems.find((item) => item.id === String(row));
			return found ? entryLabel(found) : String(row);
		});
	});

	/**
	 * A number field holds a number or nothing, and NumberInput has no empty
	 * state to show, so an unset optional number reads as zero until it is
	 * touched. The form value is left alone until the operator changes it, so an
	 * untouched blank still serializes to null rather than to a zero nobody
	 * typed.
	 */
	let numberValue = $derived(typeof value === 'number' ? value : Number(value) || 0);

	// A format example at the field's scale, such as 0.00 for a scale of 2.
	function decimalExample(f: SchemaField): string {
		const scale = f.scale ?? 2;
		return scale > 0 ? `0.${'0'.repeat(scale)}` : '0';
	}

	// A datetime is the local wall clock the form utilities convert to and from
	// the stored UTC instant. The kit's DateTimePicker reads minutes or seconds
	// and nothing finer, so a stored fraction is dropped from what it is shown.
	// The value itself changes only when the operator edits the field.
	let dateTimeValue = $derived(String(value ?? '').replace(/\.\d+$/, ''));
	let dateTimeSeconds = $derived(/T\d{2}:\d{2}:\d{2}$/.test(dateTimeValue));

	// The form state holds a json field as text. A value loaded as an object
	// is shown as the text it saves as.
	const jsonText = $derived(
		typeof value === 'string' ? value : value === null || value === undefined ? '' : JSON.stringify(value, null, 2),
	);

</script>

{#if field.field_type === 'rich_text'}
	<RichTextEditor bind:value={value as string} required={field.required} {id} label={field.name} {name} hint={help} {noAI} />
	{#if error}
		<!-- TipTap edits a contenteditable div and takes no describedby of its
		     own, so this paragraph carries the id the control would point at. -->
		<p id={id ? `${id}-error` : undefined} class="text-xs text-danger">{error}</p>
	{/if}

{:else if field.field_type === 'boolean'}
	<!-- A checkbox, not a switch: `<label for>` binds to it, so the field's own
	     label names it and clicking that label toggles the value. A div is not
	     a labelable element, so a switch wrapped in one would leave the label
	     pointing at nothing. -->
	<Checkbox
		{id}
		{error}
		{name}
		{noAI}
		hint={help}
		bind:checked={() => Boolean(value), (checked: boolean) => { value = checked; }}
		label={field.name}
		labelHidden
		required={field.required}
	/>

{:else if field.field_type === 'json'}
	<JsonFieldEditor
		{id}
		{error}
		{errorKey}
		{name}
		hint={help}
		{noAI}
		bind:value={() => jsonText, (next: string) => { value = next; }}
		required={field.required}
	/>

{:else if field.field_type === 'relation'}
	{#if field.relation_type === 'has_one' || field.relation_type === 'has_many'}
		<!-- The key lives on the other table, so nothing typed here can be
		     saved: a has_one value would go to the insert as a column that
		     does not exist, and a has_many selection never reaches the
		     request. What can be shown is what points here. -->
		<div {id} class="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm" data-testid="inverse-relation">
			{#if inverseLabels.length > 0}
				<ul class="space-y-0.5 text-fg">
					{#each inverseLabels as label (label)}
						<li>{label}</li>
					{/each}
				</ul>
			{:else}
				<p class="text-faint">No linked entries yet.</p>
			{/if}
			<p class="mt-1 text-xs text-faint">
				This link is set on the <code class="text-muted">{field.relation_to}</code> entry.
				Change it there, not here.
			</p>
		</div>
	{:else if field.relation_type === 'many_to_many'}
		{#if relationFailed}
			<p class="text-xs text-danger">
				Could not load the entries in <code>{field.relation_to}</code>. Reload the page to try again.
			</p>
		{:else if relationItems.length > 0}
			<MultiSelect
				{id}
				{error}
				{name}
				{noAI}
				bind:value={() => selectedIds, (ids: string[]) => { value = ids; }}
				options={relationOptions}
				placeholder="Select {field.relation_to ?? 'entries'}"
				hint={withHelp(relationCutNote)}
				searchable
				required={field.required}
			/>
		{:else if relationTotal === 0}
			<p class="text-xs text-faint">
				<code class="text-muted">{field.relation_to}</code> has no entries yet.
			</p>
		{:else}
			<p class="text-xs text-faint">
				No entries of <code class="text-muted">{field.relation_to}</code> to choose from.
			</p>
		{/if}
	{:else if relationItems.length > 0}
		<!-- A combobox, not a select. The picker is fed up to 500 rows, and a
		     native option list of that length can only be scrolled. -->
		<Autocomplete
			{id}
			{error}
			{name}
			{noAI}
			bind:value={() => String(value ?? ''), (next: string) => { value = next || null; }}
			options={relationOptions}
			placeholder="Search {field.relation_to ?? 'entries'}"
			hint={withHelp(relationCutNote)}
			required={field.required}
		/>
	{:else}
		<Input
			{id}
			{error}
			{name}
			{noAI}
			type="text"
			bind:value={text.get, text.set}
			placeholder="UUID"
			hint={withHelp(relationFailed
				? `Could not load the entries in ${field.relation_to}. Enter an ID by hand, or reload the page to try again.`
				: relationTotal === 0
					? `${field.relation_to} has no entries yet. Enter an ID by hand.`
					: `Enter the ID of an entry in ${field.relation_to}.`)}
			required={field.required}
		/>
	{/if}

{:else if field.field_type === 'number'}
	<NumberInput
		{id}
		{error}
		{name}
		{noAI}
		hint={help}
		bind:value={() => numberValue, (next: number) => { value = next; }}
		required={field.required}
	/>

{:else if field.field_type === 'integer'}
	<!-- Text, not a number input: a number input reads what is typed as a
	     double, which rounds past 2^53, so a long whole number would show
	     and save different digits from the ones typed. -->
	<Input
		{id}
		{error}
		type="text"
		inputmode="numeric"
		{name}
		{noAI}
		hint={help}
		bind:value={text.get, text.set}
		required={field.required}
		autocomplete="off"
	/>

{:else if field.field_type === 'decimal'}
	<!-- Text, not a number input: a decimal is exact digits, and a number
	     input reads what is typed as a double, so 0.10 would come back 0.1
	     and a long value would round. -->
	<Input
		{id}
		{error}
		type="text"
		inputmode="decimal"
		{name}
		{noAI}
		hint={help}
		bind:value={text.get, text.set}
		placeholder={decimalExample(field)}
		required={field.required}
		autocomplete="off"
	/>

{:else if field.field_type === 'date'}
	<DatePicker
		{id}
		{error}
		{name}
		{noAI}
		hint={help}
		bind:value={() => String(value ?? ''), (next: string) => { value = next || null; }}
		required={field.required}
	/>

{:else if field.field_type === 'datetime'}
	<DateTimePicker
		{id}
		{error}
		{name}
		{noAI}
		hint={help}
		bind:value={() => dateTimeValue, (next: string) => { value = next || null; }}
		seconds={dateTimeSeconds}
		required={field.required}
	/>

{:else if field.field_type === 'email'}
	<Input
		{id}
		{error}
		type="email"
		{name}
		{noAI}
		hint={help}
		bind:value={text.get, text.set}
		placeholder="user@example.com"
		required={field.required}
		autocomplete="off"
	/>

{:else if field.field_type === 'url'}
	<Input
		{id}
		{error}
		type="url"
		{name}
		{noAI}
		hint={help}
		bind:value={text.get, text.set}
		placeholder="https://"
		required={field.required}
		autocomplete="off"
	/>

{:else if field.field_type === 'media'}
	<!-- A library file is stored by its public path, which a site prefixes
	     with its own address. An outside file by its full URL. -->
	<div class="flex flex-col gap-2">
		<Input
			{id}
			{error}
			{name}
			{noAI}
			bind:value={text.get, text.set}
			placeholder="/api/v1/media/... or https://example.com/image.jpg"
			hint={withHelp('Choose a published file from the library, or enter the URL of a file hosted elsewhere.')}
			required={field.required}
			autocomplete="off"
		/>
		<div>
			<MediaPicker choices={mediaChoices} onpick={(c) => (value = c.public_url)} />
		</div>
	</div>

{:else if field.field_type === 'uid'}
	<!-- The server assigns this, so an editable box would only let an
	     operator type a value the write refuses. -->
	<Input
		{id}
		{error}
		type="text"
		readonly
		value={String(value ?? '')}
		placeholder="Assigned on save"
		hint="Set automatically. It cannot be edited."
		autocomplete="off"
		mono
	/>

{:else}
	<!-- text and any unknown types -->
	<Input
		{id}
		{error}
		type="text"
		{name}
		{noAI}
		hint={help}
		bind:value={text.get, text.set}
		required={field.required}
		autocomplete="off"
	/>
{/if}
