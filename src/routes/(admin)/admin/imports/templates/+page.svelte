<script lang="ts">
	import { Alert, Button, EmptyState, PageShell, Table } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Pencil, Plus, Rows3, Trash2 } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ImportTabs from '$lib/components/ImportTabs.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { confirmed, drawerFailure } from '$lib/forms.svelte';
	import { transformLabel, type MappingTemplate } from '$lib/api/bulk-import';
	import { NO_VALUE } from '$lib/format';
	import { couldNotLoad } from '$lib/outage';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';
	import TemplateDrawer from './TemplateDrawer.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Every form on this page reports through one result, so each failure is
	// tagged with its action. The template drawer shows only its own, the page
	// shows the rest, and a drawer opened after a failure starts clean.
	type Failure = { action?: string; error?: string } | null;
	const failure = drawerFailure(() => (form && 'error' in form ? (form as Failure) : null), ['saveTemplate']);
	const formError = $derived(String(failure.page?.error ?? ''));
	const refusal = $derived(formRefusal(failure.page));
	const templateError = $derived(String(failure.drawer?.error ?? ''));
	const templateRefusal = $derived(formRefusal(failure.drawer));
	// Null while the content types are unread, so the drawer says why it
	// offers none.
	const schemaList = $derived(data.schemas.ok ? data.schemas.value : null);

	// The drawer owns its fields. The page marks the old failure first, so a
	// drawer opened after a failure starts clean.
	let templateDrawer = $state<TemplateDrawer>();

	function openTemplate(t: MappingTemplate | null) {
		failure.opened();
		templateDrawer?.edit(t);
	}

	function removeTemplate(t: MappingTemplate): SubmitFunction {
		return confirmed(
			`Delete template ${t.name}`,
			'Imports that already used it keep their history.',
			{ confirmLabel: 'Delete', success: `${t.name} deleted.` },
		);
	}
</script>

<PageShell
	title="Imports"
	documentTitle="Mapping templates - Imports"
	description="Save a column mapping to reuse it across imports."
	width="wide"
>
	{#snippet actions()}
		{#if data.gate.state === 'ok' && data.templatesRead}
			<Button variant="primary" size="sm" onclick={() => openTemplate(null)}>
				<Plus size={ICON.sm} /> New template
			</Button>
		{/if}
	{/snippet}

	<FormErrors message={formError} refused={refusal} />

	<ImportTabs active="templates" />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Imports"
			absent="Imports are not included in this build."
		/>
	{:else}

		<section class="flex flex-col gap-4" aria-label="Mapping templates">
		<p class="text-sm text-muted">
			A template saves a column mapping with its transforms, key and mode. Choose it when you import the
			same kind of file, instead of mapping each column again.
		</p>
		{#if data.licensed === false}
			<Alert tone="brand">
				Saving templates and the date, split and lookup transforms are not enabled on this engine. Saved
				templates still apply with their transforms, and you can always delete one.
			</Alert>
		{/if}
		{#if !data.templatesRead}
			<GateNotice
				gate={data.templatesGate ?? { state: 'error', message: couldNotLoad('templates') }}
				title="Templates"
				absent="Mapping templates are not included in this build."
			/>
		{:else if data.templates.length === 0}
			<EmptyState title="No mapping templates yet" description="Create a template to reuse a column mapping across imports.">
				{#snippet iconSnippet()}
					<Rows3 size={ICON.lg} />
				{/snippet}
				{#snippet action()}
					<Button variant="secondary" onclick={() => openTemplate(null)}><Plus size={ICON.sm} /> New template</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Mapping templates">
				<thead>
					<tr>
						<th scope="col">Template</th>
						<th scope="col">Content type</th>
						<th scope="col">Columns</th>
						<th scope="col">When an entry exists</th>
						<th scope="col"><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.templates as t (t.id)}
						<tr>
							<td class="font-medium text-fg">{t.name}</td>
							<td data-cell="nowrap" class="font-mono text-xs">{t.content_type || NO_VALUE}</td>
							<td class="text-xs text-muted">
								{t.field_mappings
									.map((m) => (m.transform ? `${m.source_field}, ${transformLabel(m).toLowerCase()}` : m.source_field))
									.join('; ')}
							</td>
							<td data-cell="nowrap" class="text-xs">
								{t.mode === 'upsert' ? `Update it, key ${t.upsert_key}` : 'Leave it alone'}
							</td>
							<td data-cell="nowrap">
								<div class="flex items-center justify-end gap-1">
									<Button variant="ghost" size="sm" aria-label="Edit {t.name}" onclick={() => openTemplate(t)}>
										<Pencil size={ICON.sm} />
									</Button>
									<form method="POST" action="?/deleteTemplate" use:enhance={removeTemplate(t)}>
										<input type="hidden" name="id" value={t.id} />
										<Button variant="ghost" size="sm" type="submit" aria-label="Delete {t.name}">
											<Trash2 size={ICON.sm} class="text-danger" />
										</Button>
									</form>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
		</section>
	{/if}
</PageShell>

<TemplateDrawer
	bind:this={templateDrawer}
	schemas={schemaList}
	licensed={data.licensed}
	error={templateError}
	refused={templateRefusal}
/>
