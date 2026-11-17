<script lang="ts">
	import { Alert, Badge, Button, Card, Collapsible, Drawer, EmptyState, FileInput, Input, Textarea, confirm, toast } from '@lyeve-labs/ui-kit';
	import { Lock, Trash2 } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { tick } from 'svelte';
	import type { FlowTemplate } from '#lib/api/flows.ts';
	import { triggerLabel } from '#lib/flow/triggers.ts';
	import { ICON } from '#lib/icon.ts';

	interface Props {
		open?: boolean;
		templates: FlowTemplate[];
		/** The flow as a template document, posted by "Save this flow as a template". */
		flowDocument: string;
		/** Whether the role may save a template. */
		canUpdate: boolean;
		/** Whether the role may delete a saved template. */
		canDelete: boolean;
		/** Puts a template on the canvas. The page owns the canvas, so it also closes the gallery. */
		onuse: (template: FlowTemplate) => void;
	}

	let { open = $bindable(false), templates, flowDocument, canUpdate, canDelete, onuse }: Props = $props();

	// Templates the tenant keeps: this flow, a URL, a file or a paste.
	let templateError = $state('');
	let templateSaving = $state(false);
	let templateDeleteForm = $state<HTMLFormElement | undefined>();
	let templateDeleteId = $state('');
	const templateSave: SubmitFunction = () => {
		templateSaving = true;
		templateError = '';
		return async ({ result, update, formElement }) => {
			templateSaving = false;
			if (result.type === 'failure') {
				templateError = String((result.data as { templateError?: string })?.templateError ?? 'Could not save the template. Try again.');
				return;
			}
			if (result.type === 'success') {
				if (formElement !== templateDeleteForm) formElement.reset();
				const d = result.data as { savedTemplate?: string; deletedTemplate?: string } | undefined;
				toast.success(d?.deletedTemplate ? 'Template deleted' : 'Template saved');
			}
			await update({ reset: false, refreshAll: true });
		};
	};
	async function deleteTemplate(id: string, name: string) {
		const ok = await confirm(`Delete the template ${name}?`, 'Flows you already started from it do not change.', { confirmLabel: 'Delete' });
		if (!ok) return;
		templateDeleteId = id;
		await tick();
		templateDeleteForm?.requestSubmit();
	}
</script>

<!-- Drawers, like the schema builder's presets and import: a gallery and a
     form are panels beside the canvas, and a Modal is for a confirmation. -->
<Drawer bind:open title="Use a template" size="lg">
	<div class="flex flex-col gap-4">
		<p class="text-sm text-muted">A template puts its trigger and nodes on this canvas. The flow keeps its name and slug, and nothing is saved until you save.</p>
		{#if canUpdate}
			<Collapsible label="Save a template">
				<div class="flex flex-col gap-4 pt-2">
					<p class="text-sm text-muted">Saved templates appear here beside the built-in ones, under their slug. Saving a template with the same slug replaces it, so saving from the same URL again updates it.</p>
					<form method="POST" action="?/saveTemplate" use:enhance={templateSave}>
						<input type="hidden" name="document" value={flowDocument} />
						<Button variant="secondary" type="submit" loading={templateSaving}>Save this flow as a template</Button>
					</form>
					<form method="POST" action="?/saveTemplate" enctype="multipart/form-data" use:enhance={templateSave} class="flex flex-col gap-4">
						<Input id="template-url" name="url" type="url" label="URL" placeholder="https://example.com/flows/welcome.yaml" hint="An http or https address. Private and loopback addresses are not allowed." />
						<FileInput id="template-file" name="file" label="Or a file" accept=".json,.yaml,.yml,application/json,application/yaml" />
						<Textarea id="template-document" name="document" label="Or paste the definition" rows={6} class="[&_textarea]:text-xs" mono />
						<div class="flex justify-end">
							<Button variant="primary" type="submit" loading={templateSaving}>Save</Button>
						</div>
					</form>
					{#if templateError}
						<Alert tone="danger">{templateError}</Alert>
					{/if}
				</div>
			</Collapsible>
		{/if}
		{#if templates.length === 0}
			<EmptyState title="No templates" description="Start from the palette or import a definition instead." />
		{:else}
			<div class="grid gap-3 sm:grid-cols-2" data-testid="template-gallery">
				{#each templates as t (t.id)}
					<Card heading={t.name} headingLevel={3} description={t.description}>
						<div class="flex flex-wrap items-center gap-2">
							{#if t.source === 'saved'}
								<Badge tone="brand" size="sm">Saved</Badge>
							{/if}
							{#if t.enabled === false}
								<span data-testid="template-locked"><Badge tone="neutral" size="sm"><Lock size={ICON.xs} aria-hidden="true" /> Not enabled on this instance</Badge></span>
							{/if}
							<span class="text-xs text-faint">{triggerLabel(t.definition.trigger.type)} trigger, {t.definition.nodes.length} node{t.definition.nodes.length === 1 ? '' : 's'}</span>
							{#if t.source === 'saved' && canDelete}
								<Button variant="ghost" size="sm" class="ms-auto" aria-label="Delete the template {t.name}" onclick={() => void deleteTemplate(t.id, t.name)}>
									<Trash2 size={ICON.sm} class="text-danger" />
								</Button>
							{/if}
						</div>
						{#snippet footer()}
							<Button variant="primary" onclick={() => onuse(t)}>Use</Button>
						{/snippet}
					</Card>
				{/each}
			</div>
		{/if}
	</div>
	<form method="POST" action="?/deleteTemplate" use:enhance={templateSave} bind:this={templateDeleteForm} class="hidden">
		<input type="hidden" name="id" value={templateDeleteId} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
	{/snippet}
</Drawer>
