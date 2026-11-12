<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Card,
		Collapsible,
		Drawer,
		EmptyState,
		FileInput,
		Input,
		Textarea,
		confirm,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { Trash2 } from '@lucide/svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import type { Gate } from '$lib/api/gate';
	import type { SchemaPreset } from '$lib/api/schema-preset-catalog';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import { ICON } from '$lib/icon';

	/**
	 * The presets are offered from the empty state and from the toolbar, the
	 * way the flow editor offers its templates. Each card posts its own id.
	 * The drawer stays open on a refusal so the reason sits beside the card.
	 *
	 * Applying and deleting a preset share the page's one form result, so the
	 * page reads each failure by the action that caused it and hands it here
	 * already split: an apply failure names its card, a delete failure is the
	 * drawer's.
	 */
	let {
		open = $bindable(false),
		presets,
		presetsGate,
		canWrite,
		canSavePresets,
		applyFailure,
		deleteFailure,
	}: {
		open?: boolean;
		presets: SchemaPreset[] | undefined;
		presetsGate: Gate | null | undefined;
		canWrite: boolean | undefined;
		canSavePresets: boolean;
		applyFailure: { preset?: string; error?: unknown } | null;
		deleteFailure: string;
	} = $props();

	let presetPending = $state('');

	// A preset the tenant keeps: read from a URL, a file or a pasted document,
	// and listed with the built-in ones so it can be applied again later.
	let presetSaveError = $state('');
	let presetSaving = $state(false);
	let presetDeleteForm = $state<HTMLFormElement | undefined>();
	let presetDeleteId = $state('');

	const presetSave: SubmitFunction = () => {
		presetSaving = true;
		presetSaveError = '';
		return async ({ result, update, formElement }) => {
			presetSaving = false;
			if (result.type === 'failure') {
				presetSaveError = String((result.data as { saveError?: string })?.saveError ?? 'Could not save the preset. Try again.');
				return;
			}
			if (result.type === 'success') {
				formElement.reset();
				toast.success('Preset saved');
			}
			await update({ reset: false });
		};
	};

	async function deletePreset(id: string, name: string) {
		const ok = await confirm(`Delete the preset ${name}?`, 'Content types it already created are kept. Only the saved preset is deleted.', { confirmLabel: 'Delete' });
		if (!ok) return;
		presetDeleteId = id;
		await tick();
		presetDeleteForm?.requestSubmit();
	}

	/** The card's submit: marks it busy, then closes the drawer on success. */
	function presetSubmit(id: string): SubmitFunction {
		return () => {
			presetPending = id;
			return async ({ result, update }) => {
				presetPending = '';
				if (result.type !== 'failure' && result.type !== 'error') open = false;
				await update();
			};
		};
	}
</script>

<!-- One form per card, so a card creates what it names and nothing has to be
     picked first. The refusal an engine sends (a schema of that name exists)
     is shown under the card it belongs to, with the drawer still open. -->
<Drawer bind:open title="Use a preset" size="lg">
	<div class="flex flex-col gap-4">
		<p class="text-sm text-muted">A preset creates a set of content types with their fields and relations. After that, each one is an ordinary content type.</p>
		{#if canWrite}
			{#if canSavePresets}
				<Collapsible label="Save a preset from a URL or a file">
					<form method="POST" action="?/savePreset" enctype="multipart/form-data" use:enhance={presetSave} class="flex flex-col gap-4 pt-2">
						<FormErrors message={presetSaveError || undefined} />
						<p class="text-sm text-muted">A preset document is JSON or YAML with an id, a name, a description and its content types, each in the same shape as a new content type. Once saved, it appears here next to the built-in presets. Saving the same id again replaces it, so you can save the URL again to refresh it.</p>
						<Input id="preset-url" name="url" type="url" label="URL" placeholder="https://example.com/presets/blog.json" hint="An http or https address. Private and loopback addresses are refused." />
						<FileInput id="preset-file" name="file" label="Or a file" accept=".json,.yaml,.yml,application/json,application/yaml" />
						<Textarea id="preset-document" name="document" label="Or paste the document" rows={6} class="[&_textarea]:text-xs" mono />
						<div class="flex justify-end">
							<Button variant="primary" type="submit" loading={presetSaving}>Save</Button>
						</div>
					</form>
				</Collapsible>
			{:else}
				<div class="flex flex-wrap items-center gap-2 text-sm text-muted" data-testid="preset-save-locked">
					<span>Your license does not include saving your own presets from a URL or a file. The presets below are always available.</span>
					<NotEnabled title="Custom presets" compact />
				</div>
			{/if}
		{/if}
		{#if deleteFailure}
			<Alert tone="danger">{deleteFailure}</Alert>
		{/if}
		{#if presetsGate}
			<GateNotice gate={presetsGate} title="Presets" absent="Presets are not included in this build. Start from New content type instead." />
		{:else if (presets ?? []).length === 0}
			<EmptyState title="No presets" description="Start from New content type instead." />
		{:else}
			<div class="grid gap-3 sm:grid-cols-2" data-testid="preset-gallery">
				{#each presets ?? [] as preset (preset.id)}
					<Card heading={preset.name} headingLevel={3} description={preset.description}>
						{#if preset.source === 'saved'}
							<div class="mb-2 flex flex-wrap items-center gap-2">
								<Badge tone="brand" size="sm">Saved</Badge>
								{#if preset.source_url}
									<span class="min-w-0 flex-1 truncate text-xs text-faint" title={preset.source_url}>{preset.source_url}</span>
								{/if}
								{#if canWrite}
									<Button variant="ghost" size="sm" class="ms-auto" aria-label="Delete the preset {preset.name}" onclick={() => void deletePreset(preset.id, preset.name)}>
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								{/if}
							</div>
						{/if}
						<ul class="flex flex-wrap gap-1.5" aria-label="Content types {preset.name} creates">
							{#each preset.schemas as schema (schema.name)}
								<li>
									<code class="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">{schema.name}</code>
								</li>
							{/each}
						</ul>
						{#if applyFailure && applyFailure.preset === preset.id}
							<Alert tone="danger" class="mt-3">{applyFailure.error}</Alert>
						{/if}
						{#snippet footer()}
							<form
								method="POST"
								action="?/preset"
								use:enhance={presetSubmit(preset.id)}
							>
								<input type="hidden" name="id" value={preset.id} />
								<Button
									variant="primary"
									type="submit"
									loading={presetPending === preset.id}
									disabled={presetPending !== '' && presetPending !== preset.id}
								>
									Create
								</Button>
							</form>
						{/snippet}
					</Card>
				{/each}
			</div>
		{/if}
	</div>
	<form method="POST" action="?/deletePreset" use:enhance bind:this={presetDeleteForm} class="hidden">
		<input type="hidden" name="id" value={presetDeleteId} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
	{/snippet}
</Drawer>
