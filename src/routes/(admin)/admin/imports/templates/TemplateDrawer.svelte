<script lang="ts">
	import { couldNotLoad } from '$lib/outage';
	import { Button, Drawer, Input, RadioGroup, Select, toast } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { Plus, Trash2 } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import TransformField from '$lib/components/imports/TransformField.svelte';
	import type { Refusal } from '$lib/api/refusal';
	import { tracked } from '$lib/forms.svelte';
	import {
		emptyTransform,
		mappingTargets,
		transformDraft,
		transformFields,
		type FieldMapping,
		type ImportMode,
		type ImportSchema,
		type MappingTemplate,
		type TransformDraft,
	} from '$lib/api/bulk-import';
	import { ICON } from '$lib/icon';

	/**
	 * The drawer that creates or edits a mapping template: a saved mapping an
	 * import names instead of mapping its columns again.
	 *
	 * The page opens it through `edit`, because the page decides which failure
	 * is old at the moment it opens. The drawer owns its fields from then on.
	 */
	let {
		open = $bindable(false),
		schemas,
		licensed,
		error = '',
		refused = null,
	}: {
		open?: boolean;
		/** Null while the content types are unread, so the drawer says why it offers none. */
		schemas: ImportSchema[] | null;
		licensed: boolean | null;
		/** The failure of a save, already filtered by the page to this drawer's action. */
		error?: string;
		refused?: Refusal | null;
	} = $props();

	interface MappingRow {
		id: number;
		source: string;
		target: string;
		transform: TransformDraft;
	}

	let editingTemplate = $state<MappingTemplate | null>(null);
	let templateName = $state('');
	let templateType = $state('');
	let templateMode = $state<ImportMode>('create');
	let templateKey = $state('');
	let rows = $state<MappingRow[]>([]);
	let nextRow = 0;

	const templateTargets = $derived(
		mappingTargets((schemas ?? []).find((x) => x.name === templateType)?.fields ?? []),
	);
	const targetOptions = $derived(templateTargets.map((t) => ({ value: t.value, label: t.label })));

	/** The rows as the plugin takes them, or the first problem in words. */
	const templateMappings = $derived.by((): FieldMapping[] | string => {
		const out: FieldMapping[] = [];
		for (const r of rows) {
			if (!r.source.trim() && !r.target) continue;
			if (!r.source.trim() || !r.target) return 'Give every row a column in the file and the field it fills.';
			const fields = transformFields(r.transform);
			if (typeof fields === 'string') return `${r.source}: ${fields}`;
			const dataType = templateTargets.find((t) => t.value === r.target)?.dataType;
			out.push({ source_field: r.source.trim(), target_field: r.target, data_type: dataType, ...fields });
		}
		return out;
	});

	function addRow(source = '', target = '', transform: TransformDraft = emptyTransform()) {
		rows = [...rows, { id: nextRow++, source, target, transform }];
	}

	/** Open the drawer on a stored template, or on a blank one for null. */
	export function edit(t: MappingTemplate | null) {
		editingTemplate = t;
		templateName = t?.name ?? '';
		templateType = t?.content_type ?? (schemas?.length === 1 ? schemas[0].name : '');
		templateMode = t?.mode === 'upsert' ? 'upsert' : 'create';
		templateKey = t?.upsert_key ?? '';
		rows = [];
		for (const m of t?.field_mappings ?? []) addRow(m.source_field, m.target_field, transformDraft(m));
		if (rows.length === 0) addRow();
		open = true;
	}

	const saveTemplate = tracked(() => {
		const subject = templateName;
		const verb = editingTemplate ? 'Saved' : 'Created';
		return async ({ result, update }) => {
			if (result.type !== 'failure') open = false;
			await update();
			if (result.type === 'success') toast.success(`${verb} ${subject}`);
		};
	});
</script>

<Drawer bind:open title={editingTemplate ? `Edit ${editingTemplate.name}` : 'New template'}>
	<form
		id="template-form"
		method="POST"
		action={editingTemplate ? '?/updateTemplate' : '?/createTemplate'}
		use:enhance={saveTemplate.enhance}
	>
		{#if editingTemplate}
			<input type="hidden" name="id" value={editingTemplate.id} />
		{/if}
		<input type="hidden" name="mappings" value={JSON.stringify(typeof templateMappings === 'string' ? [] : templateMappings)} />
		<div class="flex flex-col gap-4">
			<FormErrors message={error || undefined} {refused} />
			<Input id="template-name" name="name" label="Name" bind:value={templateName} required />
			<Select
				id="template-type"
				name="content_type"
				label="Content type"
				searchable
				hint={schemas === null ? couldNotLoad('content types', { reload: true }) : undefined}
				bind:value={templateType}
				options={(schemas ?? []).map((x) => ({ value: x.name, label: x.name }))}
			/>
			<RadioGroup
				label="When an entry already exists"
				name="mode"
				hint="The key field matches each row to an existing entry."
				bind:value={templateMode}
				options={[
					{ value: 'create', label: 'Create only', description: 'Leave an entry the key finds alone and report the row as skipped.' },
					{ value: 'upsert', label: 'Create and update', description: 'Overwrite the fields of an entry the key finds, and create the rest.' },
				]}
			/>
			{#if templateMode === 'upsert'}
				<Select
					id="template-key"
					name="upsert_key"
					label="Key field"
					hint="The field that matches a row to the entry it updates."
					searchable
					bind:value={templateKey}
					options={[
						{ value: '', label: 'Choose the key field' },
						{ value: 'entry.slug', label: 'Entry slug' },
						...templateTargets.filter((t) => !t.value.startsWith('entry.')).map((t) => ({ value: t.value, label: t.value })),
					]}
				/>
			{/if}
			<div class="flex flex-col gap-3">
				{#each rows as r, i (r.id)}
					<div class="flex flex-col gap-2 rounded border border-line p-3">
						<div class="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
							<Input id="template-source-{r.id}" label="Column in the file" bind:value={r.source} />
							<Select
								id="template-target-{r.id}"
								label="Field"
								searchable
								bind:value={r.target}
								options={[{ value: '', label: 'Choose a field' }, ...targetOptions]}
							/>
							<Button
								variant="ghost"
								size="sm"
								aria-label="Remove column {r.source || i + 1}"
								onclick={() => (rows = rows.filter((x) => x.id !== r.id))}
							>
								<Trash2 size={ICON.sm} class="text-danger" />
							</Button>
						</div>
						<TransformField
							id="template-{r.id}"
							label="Transform"
							{licensed}
							bind:draft={r.transform}
						/>
					</div>
				{/each}
				<div>
					<Button variant="secondary" size="sm" onclick={() => addRow()}>
						<Plus size={ICON.sm} /> Add column
					</Button>
				</div>
				{#if typeof templateMappings === 'string'}
					<p class="text-xs text-danger">{templateMappings}</p>
				{/if}
			</div>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button
			variant="primary"
			type="submit"
			form="template-form"
			disabled={typeof templateMappings === 'string'}
			loading={saveTemplate.pending}
		>
			{editingTemplate ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>
