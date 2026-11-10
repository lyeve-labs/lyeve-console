<script lang="ts">
	import { untrack } from 'svelte';
	import { FormAssist } from '@lyeve-labs/ui-kit';
	import type { SchemaField } from '@lyeve-labs/client';
	import { fieldKey } from '$lib/utils/content-form';
	import { humanizeFieldName } from '$lib/utils/entry-identity';
	import FieldInput from './FieldInput.svelte';
	import FormErrors from './FormErrors.svelte';
	import type { MediaChoice } from '$lib/api/media';
	import type { RelationChoices } from './content/relation-choices';

	let {
		fields,
		formValues,
		validationErrors = {},
		errorKeys = {},
		relations = {},
		mediaChoices = [],
		error,
		label = 'Entry',
	}: {
		fields: SchemaField[];
		/** The parent's state, which each FieldInput writes in place, so the parent never copies it back. */
		formValues: Record<string, unknown>;
		validationErrors?: Record<string, string>;
		/** The key inside a json field that its error is about, by field name. */
		errorKeys?: Record<string, string>;
		/** What each related collection's read gave, by collection name. */
		relations?: Record<string, RelationChoices>;
		/** Published library files a media field may point at. Null when the library could not be read. */
		mediaChoices?: MediaChoice[] | null;
		error?: string | null;
		/** The form's name for an assistant that fills it, such as "New Articles entry". */
		label?: string;
	} = $props();

	/**
	 * How the field's visible label reaches the control FieldInput renders.
	 *
	 * `for` binds a label to a labelable element: a button, an input, a select
	 * or a textarea. Every other control has to carry its own name instead, and
	 * a `for` aimed at one is a label that does nothing when clicked and a
	 * control a screen reader announces unnamed. The two exceptions are the rich
	 * text editor, which is a contenteditable div that names itself, and the
	 * multi-select relation picker, whose trigger is a div holding chips.
	 */
	type Labeling = 'for' | 'self' | 'group';

	function labeling(field: SchemaField): Labeling {
		if (field.field_type === 'rich_text') return 'self';
		if (
			field.field_type === 'relation' &&
			(field.relation_type === 'has_many' || field.relation_type === 'many_to_many')
		) {
			return 'group';
		}
		return 'for';
	}

	/**
	 * The element a `for` label points at. A datetime is one kit field holding
	 * a date trigger and a time half, and its label opens the calendar, so it
	 * names the trigger the field derives from its id.
	 */
	function labelTarget(field: SchemaField): string {
		return field.field_type === 'datetime' ? `field-${field.name}-date` : `field-${field.name}`;
	}

	let root: HTMLDivElement | undefined = $state();

	/*
	 * A refused submit moves focus to the first field it names. The summary at
	 * the top says how many need attention, and focus on the field is what lets
	 * a keyboard reader fix it without hunting down the form. The errors object
	 * is replaced on every refused submit, so this runs once per refusal. The
	 * fields are read untracked: a page whose data is read again derives them
	 * anew, and that is no refusal to move focus for.
	 */
	$effect(() => {
		const named = Object.keys(validationErrors);
		if (named.length === 0 || !root) return;
		const first = untrack(() => fields).find((f) => named.includes(f.name));
		if (!first) return;
		const box = root.querySelector(`[data-field-name="${first.name}"]`);
		// A field that marks a part of itself, such as one key of a json
		// value, takes focus on that part.
		const control =
			box?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
			box?.querySelector<HTMLElement>(
				'input:not([type="hidden"]), textarea, select, button, [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
			);
		control?.focus();
	});

	function relationOf(field: SchemaField): RelationChoices | undefined {
		return relations[field.relation_to ?? ''];
	}

	/** "first_name" reads "First name", the case every other field label uses. */
	function fieldLabel(name: string): string {
		const words = humanizeFieldName(name);
		return words.charAt(0) + words.slice(1).toLowerCase();
	}
</script>

<!-- The failure is read before the fields, so a refused save is the first
     thing in the form rather than something below the last field. -->
<!-- Every field registers with the FormAssist, so an assistant beside the
     page can read the form and suggest values, and the page's own Save posts
     them once the editor accepts each one. A No AI field is withheld there. -->
<FormAssist {label} class="flex flex-col gap-5">
<div bind:this={root} class="flex flex-col gap-5">
<FormErrors message={error ?? undefined} fields={validationErrors} />

{#if fields.length === 0}
	<p class="text-faint text-sm py-4 text-center">This content type has no editable fields.</p>
{:else}
	<!-- The form states the gap between its fields. The caller's Card wraps
	     its children, so a space-y on the Card would not reach them. -->
	<div class="flex flex-col gap-5">
	{#each fields as field (field.name)}
		{@const bind = labeling(field)}
		<div
			class="flex flex-col gap-1.5"
			data-field-name={field.name}
			data-field-type={field.field_type}
			data-relation-type={field.relation_type ?? undefined}
		>
			<!-- The label every other form in the console carries: sentence case,
			     body size, the required marker after it. The kit's Label is the
			     uppercase caption style, and with the field type in brackets
			     after the raw column name it would read "NAME (text)". -->
			<label for={bind === 'for' ? labelTarget(field) : undefined} class="text-sm font-medium text-fg">
				{fieldLabel(field.name)}{#if field.required}<span class="text-danger ms-0.5" aria-hidden="true">*</span>{/if}
			</label>

			{#if bind === 'group'}
				<div role="group" aria-label={field.name}>
					<FieldInput
						{field}
						id="field-{field.name}"
						bind:value={formValues[field.name]}
						relationItems={relationOf(field)?.items ?? []}
						relationTotal={relationOf(field)?.total}
						relationFailed={relationOf(field)?.failed ?? false}
						relationAssistantLabels={relationOf(field)?.assistantLabels}
						{mediaChoices}
						error={validationErrors[field.name]}
						errorKey={errorKeys[field.name]}
					/>
				</div>
			{:else}
				<!-- The message goes to the control, which owns aria-invalid and the
				     paragraph its aria-describedby already points at. Printed here it
				     would be a loose paragraph with no id that nothing references. -->
				<!-- Bound by the key the form state uses, which for a belongs_to is
				     the foreign key column and not the field name. Bound by name,
				     a belongs_to would start undefined, which Svelte refuses for a
				     prop with a fallback. -->
				<FieldInput
					{field}
					id="field-{field.name}"
					bind:value={formValues[fieldKey(field)]}
					relationItems={relationOf(field)?.items ?? []}
					relationTotal={relationOf(field)?.total}
					relationFailed={relationOf(field)?.failed ?? false}
					relationAssistantLabels={relationOf(field)?.assistantLabels}
					{mediaChoices}
					error={validationErrors[field.name]}
					errorKey={errorKeys[field.name]}
				/>
			{/if}
		</div>
	{/each}
	</div>
{/if}
</div>
</FormAssist>
