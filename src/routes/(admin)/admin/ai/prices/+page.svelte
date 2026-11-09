<script lang="ts">
	import { Badge, Button, Drawer, EmptyState, Input, NumberInput, PageShell, RadioGroup, Table, confirm as confirmDialog } from '@lyeve-labs/ui-kit';
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { tracked } from '$lib/forms.svelte';
	import { Coins, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';
	import type { ModelPrice } from '$lib/api/ai';
	import AiSection from '$lib/components/ai/AiSection.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { PROVIDER_KINDS, effectiveGate, providerKindDescription, providerKindLabel } from '$lib/api/ai';
	import { formatDateTime } from '$lib/format';
	import { overlayClosed } from '$lib/overlay';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const kindOptions = PROVIDER_KINDS.map((k) => ({ value: k, label: providerKindLabel(k), description: providerKindDescription(k) }));
	const keyOf = (kind: string, model: string) => `${kind}/${model}`;

	// One drawer for both writes: a null target is a new price. The kind and
	// the model are the row's key, so an existing row keeps them.
	let open = $state(false);
	let editing = $state<ModelPrice | null>(null);
	let kind = $state<string>('openai');
	let model = $state('');
	let input = $state(0);
	let output = $state(0);
	let image = $state(0);

	/*
	 * The drawer and a row's delete share one `form` result. A save shows its
	 * failure in the drawer and a delete on the page, so a failed delete never
	 * reads as a failed save in the next drawer opened. Opening the drawer
	 * clears what an earlier attempt left.
	 */
	let cleared = $state<unknown>(null);
	const failure = $derived.by(() => {
		const f = form as { action?: unknown; error?: unknown } | null;
		if (!f || f === cleared || typeof f.error !== 'string' || !f.error) return null;
		return { action: String(f.action ?? ''), error: f.error };
	});
	const saveFailure = $derived(failure?.action === 'save' ? failure.error : undefined);
	const pageFailure = $derived(failure && failure.action !== 'save' ? failure.error : undefined);

	function openCreate() {
		cleared = form;
		editing = null;
		kind = 'openai';
		model = '';
		input = 0;
		output = 0;
		image = 0;
		open = true;
	}

	function openEdit(p: ModelPrice) {
		cleared = form;
		editing = p;
		kind = p.kind;
		model = p.model;
		input = p.input_per_1k;
		output = p.output_per_1k;
		image = p.image_per_call;
		open = true;
	}

	// The drawer closes once the write is saved. A failure keeps it open
	// beside the message.
	$effect(() => {
		if (form && 'saved' in form && form.saved) open = false;
	});

	// Delete goes through the kit's confirm dialog, then a hidden form, so the
	// row's button never posts on its own and the action stays a form action.
	let deleteTarget = $state<ModelPrice | null>(null);
	let deleteForm = $state<HTMLFormElement>();

	async function askDelete(p: ModelPrice) {
		const ok = await confirmDialog(
			`Delete the price for ${p.model}?`,
			'Costs for this model are estimated as zero until you add a price again.',
			{ confirmLabel: 'Delete' }
		);
		if (!ok) return;
		deleteTarget = p;
		await tick();
		deleteForm?.requestSubmit();
	}

	// The layout's word on the plugin wins over the page's, as it does for the
	// section around the list, so a plugin the layout says is off or absent
	// offers no write here either.
	const canWrite = $derived(data.isSuperAdmin && effectiveGate(data.gate, data.aiLayoutGate).state === 'ok');

	/*
	 * What the live region says after a save. Emptied when a save starts, so a
	 * second save is heard as well, and set once the drawer has left, so the
	 * focus moving back to the page does not cut the announcement off.
	 */
	let announced = $state('');
	const save = tracked(() => {
		announced = '';
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type !== 'success') return;
			await overlayClosed();
			announced = 'Saved.';
		};
	});
</script>

<PageShell
	title="AI prices"
	description="Set what tokens cost for each provider kind and model. Transcript cost estimates use these prices, which apply to the whole engine."
	width="wide"
>
	{#snippet actions()}
		{#if canWrite}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} aria-hidden="true" /> New price
			</Button>
		{/if}
	{/snippet}

	<!-- The row's "Saved." arrives with a new row, and a screen reader announces
	     a region only when text arrives in one already on the page, so the
	     sentence is spoken from here. A div because in Firefox Orca drops a
	     quick insertion into a paragraph, and no status role because Orca reads
	     a status bar as chrome and says nothing. -->
	<div class="sr-only" aria-live="polite" aria-atomic="true" data-testid="price-saved">{announced}</div>
	<AiSection level={2} tab="prices" gate={data.gate} layoutGate={data.aiLayoutGate} noun="prices">
		<FormErrors message={pageFailure} />

		{#if data.prices.length === 0}
			<EmptyState
				level={2}
				title="No prices yet"
				description="A model with no price is estimated at zero cost. Prices are in dollars per thousand tokens, or per call for images."
			>
				{#snippet iconSnippet()}
					<Coins size={ICON.lg} />
				{/snippet}
				{#snippet action()}
					{#if canWrite}
						<Button variant="secondary" onclick={openCreate}>
							<Plus size={ICON.sm} aria-hidden="true" /> New price
						</Button>
					{/if}
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Prices">
				<thead>
					<tr>
						<th scope="col">Kind</th>
						<th scope="col">Model</th>
						<th scope="col">Input per 1K</th>
						<th scope="col">Output per 1K</th>
						<th scope="col">Image per call</th>
						<th scope="col">Updated</th>
						{#if data.isSuperAdmin}<th scope="col" class="text-right">Actions</th>{/if}
					</tr>
				</thead>
				<tbody>
					{#each data.prices as p (keyOf(p.kind, p.model))}
						{@const mine = form?.key === keyOf(p.kind, p.model)}
						<tr>
							<td><Badge tone="violet" size="sm">{providerKindLabel(p.kind)}</Badge></td>
							<td data-cell="nowrap" class="font-medium">{p.model}</td>
							<td data-cell="nowrap" class="font-mono text-muted">${p.input_per_1k}</td>
							<td data-cell="nowrap" class="font-mono text-muted">${p.output_per_1k}</td>
							<td data-cell="nowrap" class="font-mono text-muted">${p.image_per_call}</td>
							<td data-cell="nowrap" class="text-muted">
								{formatDateTime(p.updated_at)}
								{#if mine && form && 'saved' in form}
									<span class="block text-xs text-success">Saved.</span>
								{/if}
							</td>
							{#if data.isSuperAdmin}
								<td class="text-right">
									<span class="inline-flex items-center gap-1">
										<Button variant="ghost" size="sm" onclick={() => openEdit(p)} aria-label="Edit price for {p.model}">
											<Pencil size={ICON.sm} aria-hidden="true" />
										</Button>
										<Button variant="ghost" size="sm" onclick={() => askDelete(p)} aria-label="Delete price for {p.model}">
											<Trash2 size={ICON.sm} aria-hidden="true" class="text-danger" />
										</Button>
									</span>
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
	</AiSection>
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.model}` : 'New price'}>
	<form method="POST" action="?/save" id="price-form" use:enhance={save.enhance} class="flex flex-col gap-4">
		<FormErrors message={saveFailure} />
		{#if editing}
			<input type="hidden" name="kind" value={editing.kind} />
			<input type="hidden" name="model" value={editing.model} />
			<Input id="price-kind" label="Kind" value={providerKindLabel(editing.kind)} disabled />
			<Input id="price-model" label="Model" value={editing.model} disabled />
		{:else}
			<RadioGroup name="kind" label="Kind" options={kindOptions} bind:value={kind} />
			<Input id="price-model" name="model" label="Model" required placeholder="gpt-4o-mini" bind:value={model} />
		{/if}
		<NumberInput id="price-in" name="input_per_1k" label="Input per 1K" min={0} step={0.0001} bind:value={input} />
		<NumberInput id="price-out" name="output_per_1k" label="Output per 1K" min={0} step={0.0001} bind:value={output} />
		<NumberInput id="price-image" name="image_per_call" label="Image per call" min={0} step={0.0001} bind:value={image} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="price-form" loading={save.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>

<form method="POST" action="?/delete" use:enhance bind:this={deleteForm} class="hidden">
	<input type="hidden" name="kind" value={deleteTarget?.kind ?? ''} />
	<input type="hidden" name="model" value={deleteTarget?.model ?? ''} />
</form>
