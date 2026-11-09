<script lang="ts">
	import { Alert, Badge, Button, Card, Input, NumberInput, PageShell, SectionHeading } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { RotateCcw } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';
	import CostTabs from '$lib/components/CostTabs.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { RESOURCE_TYPES, type Price, type ResourceType } from '$lib/api/cost';
	import { formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The tenant list is the super admin's. An admin who can read this page
	// would be sent to a 403 by a way back that names it.
	const back = $derived(
		data.user?.roles?.includes('super_admin') ? { href: '/admin/tenants', label: 'Tenants' } : undefined,
	);

	const prices = $derived(data.prices.ok ? data.prices.value : null);

	const RESOURCE_LABEL: Record<ResourceType, string> = {
		database: 'Database',
		storage: 'Storage',
		bandwidth: 'Bandwidth',
		compute: 'Compute',
		ai: 'AI',
	};
	const UNIT_LABEL: Record<ResourceType, string> = {
		database: 'units',
		storage: 'bytes held, per month',
		bandwidth: 'bytes transferred',
		compute: 'requests',
		ai: 'tokens',
	};

	let failure = $derived(
		form && 'error' in form && typeof form.error === 'string' && form.error
			? { form: String(form.form ?? ''), message: form.error, locked: form.locked === true }
			: null,
	);
	let saved = $derived(form && 'saved' in form && form.saved === true ? String(form.form ?? '') : '');
	let submitting = $state<string | null>(null);

	// The price rows are edited in place, seeded from what the engine holds
	// and reseeded when a save comes back with new rows.
	type PriceRow = { unit_price: string; per_units: number; currency: string };
	function seed(): Record<ResourceType, PriceRow> {
		const rows = {} as Record<ResourceType, PriceRow>;
		for (const r of RESOURCE_TYPES) {
			const p = prices?.find((x) => x.resource_type === r);
			rows[r] = { unit_price: p?.unit_price ?? '0', per_units: p?.per_units ?? 1, currency: p?.currency ?? 'USD' };
		}
		return rows;
	}
	// svelte-ignore state_referenced_locally
	let priceRows = $state<Record<ResourceType, PriceRow>>(seed());
	// svelte-ignore state_referenced_locally
	let seededVersion = version();
	function version(): string {
		return (prices ?? []).map((p) => `${p.resource_type}:${p.unit_price}:${p.per_units}:${p.currency}:${p.source}`).join('|');
	}
	$effect(() => {
		const v = version();
		if (v === seededVersion) return;
		seededVersion = v;
		priceRows = seed();
	});

	function priceOf(r: ResourceType): Price | undefined {
		return prices?.find((p) => p.resource_type === r);
	}

	function track(name: string) {
		return () => {
			submitting = name;
			return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
				submitting = null;
				await update({ reset: false });
			};
		};
	}
</script>

<PageShell
	title="Tenant costs"
	documentTitle="Prices - Tenant costs"
	description="Set the price this tenant pays for each resource."
	width="wide"
	{back}
>
	{#snippet actions()}
		{#if data.enabled}
			<Badge tone="violet" size="sm">Beta</Badge>
		{/if}
	{/snippet}

	<CostTabs active="prices" />

	{#if !data.enabled}
		<NotEnabled
			level={2}
			title="Tenant costs"
			description="See what each tenant's usage costs, set prices and track budgets."
			url={data.upgradeUrl}
		/>
	{:else}
		<section class="flex flex-col gap-4" aria-label="Prices">
			<SectionHeading level={2}>Prices</SectionHeading>
			<p class="text-sm text-muted">
				Set what a block of units costs for each resource type. The built-in figures are placeholders,
				not real prices, so replace them. A price of zero for AI uses the AI plugin's own per-call estimate.
			</p>
			{#if failure?.form === 'price'}
				<Alert tone={failure.locked ? 'warn' : 'danger'}>{failure.message}</Alert>
			{:else if saved === 'price'}
				<Alert tone="success" autoDismiss>Price saved.</Alert>
			{/if}
			{#if !data.prices.ok}
				<GateNotice gate={data.prices.gate} title="the prices" absent="Cost prices are not included in this build." />
			{:else}
			<div class="grid gap-3 xl:grid-cols-2" data-testid="cost-prices">
				{#each RESOURCE_TYPES as resource (resource)}
					{@const current = priceOf(resource)}
					<Card>
						{#snippet header()}
							<div class="flex items-center justify-between gap-3">
								<SectionHeading level={3}>{RESOURCE_LABEL[resource]}</SectionHeading>
								<!-- The plugin answers every resource type, with its default
								     where the tenant set none, so a read list has no gap. -->
								<Badge tone={current?.source === 'tenant' ? 'brand' : 'neutral'} size="sm">
									{current?.source === 'tenant' ? 'Set by this tenant' : 'Default'}
								</Badge>
							</div>
						{/snippet}
						<form
							method="POST"
							action="?/putPrice"
							use:enhance={track(`price-${resource}`)}
							class="flex flex-col gap-3"
							aria-label="Price for {RESOURCE_LABEL[resource]}"
						>
							<input type="hidden" name="resource_type" value={resource} />
							<fieldset class="flex flex-col gap-3">
								<div class="grid gap-3 sm:grid-cols-[1fr_minmax(9rem,1.4fr)_1fr]">
									<Input
										id="price-{resource}-unit"
										name="unit_price"
										label="Price"
										bind:value={priceRows[resource].unit_price}
										autocomplete="off"
										mono
									/>
									<NumberInput
										id="price-{resource}-per"
										name="per_units"
										label="Per units"
										hint={UNIT_LABEL[resource]}
										min={1}
										step={1}
										bind:value={priceRows[resource].per_units}
									/>
									<Input
										id="price-{resource}-currency"
										name="currency"
										label="Currency"
										bind:value={priceRows[resource].currency}
										autocomplete="off"
										mono
									/>
								</div>
								<div class="flex items-center gap-2">
									<Button type="submit" variant="primary" size="sm" loading={submitting === `price-${resource}`}>Save</Button>
									{#if current?.source === 'tenant'}
										<Button
											type="submit"
											variant="ghost"
											size="sm"
											formaction="?/resetPrice"
											title="Remove this tenant's price and use the default"
										>
											<RotateCcw size={ICON.sm} /> Use default
										</Button>
										{#if current.updated_at}
											<span class="text-xs text-faint">Set {formatDateTime(current.updated_at)}</span>
										{/if}
									{/if}
								</div>
							</fieldset>
						</form>
					</Card>
				{/each}
			</div>
			{/if}
		</section>
	{/if}
</PageShell>
