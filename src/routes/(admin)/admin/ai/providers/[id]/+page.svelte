<script lang="ts">
	import { tracked } from '$lib/forms.svelte';
	import { Alert, Badge, Breadcrumb, Button, Card, DescriptionList, Input, PageShell, SectionHeading, Tag, confirm as confirmDialog } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { ListTree, ScanSearch, Trash2 } from '@lucide/svelte';
	import { crumbsAfter } from '$lib/breadcrumb';
	import type { ActionData, PageData } from './$types';
	import AiSection from '$lib/components/ai/AiSection.svelte';
	import ProviderForm from '$lib/components/ai/ProviderForm.svelte';
	import { providerKindLabel, type ModelCapabilities } from '$lib/api/ai';
	import { formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';

	const back = { href: '/admin/ai/providers', label: 'Providers' };
	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Delete goes through the kit's confirm dialog, then a hidden form, so the
	// button never posts on its own and the action stays a form action.
	let deleteForm = $state<HTMLFormElement>();

	async function askDelete(name: string) {
		const ok = await confirmDialog(
			`Delete provider ${name}?`,
			'Requests that named it fall back to the next provider by priority. Its key is deleted too.',
			{ confirmLabel: 'Delete' }
		);
		if (!ok) return;
		deleteForm?.requestSubmit();
	}
	let capModel = $state('');

	// One form prop carries the last action only, so each read keeps its own
	// last answer and a capabilities check does not erase the model list.
	let models = $state<string[] | null>(null);
	let capabilities = $state<ModelCapabilities | null>(null);
	$effect(() => {
		if (form?.scope === 'models' && form.models) models = form.models;
		if (form?.scope === 'capabilities' && form.capabilities) capabilities = form.capabilities;
	});

	const p = $derived(data.provider);
	const facts = $derived(
		p
			? [
					{ term: 'Kind', value: providerKindLabel(p.kind) },
					{ term: 'Base URL', value: p.base_url || (p.kind === 'openai_compatible' ? 'none' : "the vendor's") },
					{ term: 'Key', value: p.needs_key ? 'stored, cannot be decrypted: enter it again' : p.has_key ? 'stored' : 'none' },
					{ term: 'Private address', value: p.allow_private ? 'allowed' : 'refused' },
					{ term: 'Created', value: formatDateTime(p.created_at) },
					{ term: 'Updated', value: formatDateTime(p.updated_at) },
				]
			: []
	);

	const saveCaps = tracked(() => async ({ update }) => update({ reset: false }));
	const saveConfig = tracked(() => async ({ update }) => update({ reset: false }));
</script>

<PageShell
	title={p?.name ?? 'Provider'}
	description={p ? providerKindLabel(p.kind) : ''}
	width="wide"
	{back}
>
	{#snippet breadcrumb()}
		<Breadcrumb items={crumbsAfter(back, [{ label: 'AI', href: '/admin/ai' }, { label: 'Providers', href: '/admin/ai/providers' }, { label: p?.name ?? 'Provider' }])} />
	{/snippet}

	<AiSection level={2} tab="providers" gate={data.gate} layoutGate={data.aiLayoutGate} noun="providers">
		{#if p}
			<div class="flex flex-wrap items-center gap-2">
				{#if p.enabled}<Badge tone="success" dot>Enabled</Badge>{:else}<Badge tone="neutral" dot>Disabled</Badge>{/if}
				{#if p.needs_key}<Badge tone="warn" dot>Needs key</Badge>{/if}
				{#each p.modalities as m (m)}<Tag label={m} tone="neutral" />{/each}
				<span class="text-xs text-faint">priority {p.priority}</span>
			</div>

			<DescriptionList items={facts} />

			{#if data.isSuperAdmin}
				<section class="flex flex-col gap-4">
					<SectionHeading level={2}>Configuration</SectionHeading>
					<Card>
						<form
							id="provider-update"
							method="POST"
							action="?/update"
							use:enhance={saveConfig.enhance}
							class="flex flex-col gap-4"
						>
							{#key p.updated_at}
								<ProviderForm id="edit" provider={p} superAdmin={data.isSuperAdmin} />
							{/key}
							{#if (form?.scope === 'config' || form?.scope === 'delete') && form.error}
								<Alert tone="danger">{form.error}</Alert>
							{:else if form?.scope === 'config' && 'saved' in form}
								<Alert tone="success" autoDismiss>Saved.</Alert>
							{/if}
							<div class="flex justify-end gap-3">
								<Button variant="ghost" onclick={() => askDelete(p.name)}>
									<Trash2 size={ICON.sm} aria-hidden="true" class="text-danger" /> Delete
								</Button>
								<Button variant="primary" type="submit" loading={saveConfig.pending}>Save</Button>
							</div>
						</form>
					</Card>
				</section>
			{/if}

			<section class="grid gap-4 md:grid-cols-2">
				<Card heading="Models" headingLevel={2} description="See which models this provider offers. The list is not saved.">
					<form method="POST" action="?/models" use:enhance class="flex flex-col gap-3">
						<div>
							<Button variant="secondary" size="sm" type="submit">
								<ListTree size={ICON.sm} aria-hidden="true" /> List models
							</Button>
						</div>
						{#if form?.scope === 'models' && form.error}
							<Alert tone="danger">{form.error}</Alert>
						{:else if models && models.length === 0}
							<p class="text-xs text-muted">This provider returned no models.</p>
						{:else if models}
							<ul class="flex flex-wrap gap-1" aria-label="Models">
								{#each models as m (m)}
									<li><Tag label={m} tone="neutral" /></li>
								{/each}
							</ul>
						{/if}
					</form>
				</Card>

				<Card heading="Capabilities" headingLevel={2} description="Check what one model on this provider can do, based on the model and this provider's modalities. No key is needed.">
					<form method="POST" action="?/capabilities" use:enhance={saveCaps.enhance} class="flex flex-col gap-3">
						<Input id="cap-model" name="model" label="Model" bind:value={capModel} placeholder={p.default_model || 'the default model'} />
						<div>
							<Button variant="secondary" size="sm" type="submit">
								<ScanSearch size={ICON.sm} aria-hidden="true" /> Check
							</Button>
						</div>
						{#if form?.scope === 'capabilities' && form.error}
							<Alert tone="danger">{form.error}</Alert>
						{:else if capabilities}
							{@const c = capabilities}
							<div class="flex flex-wrap items-center gap-2" data-testid="capabilities">
								<span class="text-xs text-muted">{c.model}</span>
								<!-- The words say which it can do, so the tone is not the only sign. -->
								<Badge tone={c.text ? 'success' : 'neutral'} size="sm">{c.text ? 'text' : 'no text'}</Badge>
								<Badge tone={c.embed ? 'success' : 'neutral'} size="sm">{c.embed ? 'embed' : 'no embed'}</Badge>
								<Badge tone={c.image ? 'success' : 'neutral'} size="sm">{c.image ? 'image' : 'no image'}</Badge>
								<Badge tone={c.vision ? 'success' : 'neutral'} size="sm">{c.vision ? 'vision' : 'no vision'}</Badge>
								{#if c.max_tokens > 0}<span class="text-xs text-faint">{c.max_tokens} tokens</span>{/if}
							</div>
						{/if}
					</form>
				</Card>
			</section>
		{/if}
	</AiSection>
</PageShell>

{#if p}
	<form method="POST" action="?/delete" use:enhance bind:this={deleteForm} class="hidden"></form>
{/if}
