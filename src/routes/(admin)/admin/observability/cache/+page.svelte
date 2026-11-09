<script lang="ts">
	import { Alert, Badge, Button, EmptyState, PageShell, SectionHeading, Stat, Table, toast } from '@lyeve-labs/ui-kit';
	import CacheTabs from '$lib/components/CacheTabs.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Database, RotateCcw } from '@lucide/svelte';
	import {
		CIRCUIT_LABELS,
		inactiveReason,
		circuitState,
		circuitTone,
		fullness,
		hitRate,
		trippedProviders,
		underPressure,
		type CacheProvider,
	} from '$lib/api/cache';
	import { plural } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const rate = $derived(hitRate(data.stats));
	const full = $derived(fullness(data.stats));
	const tripped = $derived(trippedProviders(data.providers));
	const refusal = $derived(formRefusal(form));

	function reset(p: CacheProvider): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`Circuit reset for ${p.name}.`);
			};
	}
</script>

<PageShell
	title="Cache"
	description="See how the cache is doing and the state of each provider."
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	<CacheTabs active="overview" />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Cache"
			absent="The cache is not included in this build."
		/>
	{:else}
		<FormErrors message={formError} refused={refusal} />

		{#if tripped.length > 0}
			<!-- The reading the stats hide. A lower-priority provider picks up
			     when one trips, so the hit rate stays plausible while a backend
			     is entirely out of service. -->
			<Alert tone="danger">
				{tripped.length}
				{plural(tripped.length, 'provider is', 'providers are')} switched off by their circuit
				breaker. Another provider is taking over, so the hit rate above stays normal.
			</Alert>
		{/if}

		{#if data.stats}
			<div class="grid gap-4 sm:grid-cols-4">
				<Stat
					size="sm"
					mono
					label="Hit rate"
					value={rate === null ? 'No requests yet' : `${rate}%`}
				/>
				<Stat size="sm" mono label="Entries" value={data.stats.entries} />
				<Stat
					size="sm"
					mono
					label="Evicted"
					value={data.stats.evictions}
					tone={underPressure(data.stats) ? 'warn' : 'neutral'}
				/>
				<Stat size="sm" mono label="Misses" value={data.stats.misses} />
			</div>

			{#if underPressure(data.stats)}
				<!-- Evictions mean entries left before their TTL because the
				     store was full. A capacity problem dressed as a working
				     cache: the hit rate falls and nothing errors. -->
				<Alert tone="warn">
					{data.stats.evictions}
					{plural(data.stats.evictions, 'entry was', 'entries were')} removed before they expired
					because the store is full.
					{#if full !== null}
						The store is at {Math.round(full * 100)}% of its limit.
					{/if}
				</Alert>
			{/if}
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Providers</SectionHeading>
			{#if data.providersRead && data.providersLicensed !== null}
				<p class="text-sm text-muted" data-testid="provider-tier">
					{#if data.providersLicensed}
						Every configured provider runs, in priority order, with failover and a circuit breaker on each.
					{:else}
						Only one provider runs on this engine: the highest-priority one that starts. Other configured
						providers are listed below as left out.
					{/if}
				</p>
			{/if}
			{#if !data.providersRead}
				{#if data.providersGate}
					<GateNotice gate={data.providersGate} title="the providers" absent="The provider list needs a newer version of the cache plugin." />
				{:else}
					<Alert tone="danger">
						Could not load providers. Reload the page to try again.
					</Alert>
				{/if}
			{:else if data.providers.length === 0}
				<EmptyState
					title="No providers configured"
					description="Nothing can be cached until a provider is configured."
				>
					{#snippet iconSnippet()}
						<Database size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Providers">
					<thead>
						<tr>
							<th scope="col">Provider</th>
							<th scope="col">Circuit</th>
							<th scope="col">Priority</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.providers as p (p.name)}
							<tr>
								<td data-cell="nowrap">
									<span class="font-medium text-fg">{p.name}</span>
									<div class="text-xs text-faint">{p.kind}</div>
								</td>
								<td data-cell="nowrap">
									<Badge tone={circuitTone(circuitState(p))} dot>
										{CIRCUIT_LABELS[circuitState(p)]}
									</Badge>
								</td>
								<td data-cell="nowrap" class="font-mono text-xs">{p.priority}</td>
								<td data-cell="nowrap">
									<div class="flex justify-end">
										{#if data.superAdmin && circuitState(p) === 'open'}
											<form method="POST" action="?/resetCircuit" use:enhance={reset(p)}>
												<input type="hidden" name="name" value={p.name} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													aria-label="Reset the circuit for {p.name}"
													title="Try this provider again"
												>
													<RotateCcw size={ICON.sm} />
												</Button>
											</form>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
			{#if data.inactive.length > 0}
				<Table label="Configured providers that are not running">
					<thead>
						<tr>
							<th scope="col">Not running</th>
							<th scope="col">Priority</th>
							<th scope="col">Why</th>
						</tr>
					</thead>
					<tbody>
						{#each data.inactive as p (p.name)}
							<tr>
								<td data-cell="nowrap">
									<span class="font-medium text-fg">{p.name}</span>
									<div class="text-xs text-faint">{p.kind}</div>
								</td>
								<td data-cell="nowrap" class="font-mono text-xs">{p.priority}</td>
								<td class="text-xs text-muted">{inactiveReason(p.reason)}</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>
	{/if}
</PageShell>
