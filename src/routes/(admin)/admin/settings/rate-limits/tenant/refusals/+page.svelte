<script lang="ts">
	import { EmptyState, PageShell, SectionHeading, SegmentedControl, Table } from '@lyeve-labs/ui-kit';
	import { ShieldBan } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import RateLimitTabs from '$lib/components/RateLimitTabs.svelte';
	import { HISTORY_WINDOWS, refusalKindLabel, refusalTotals } from '$lib/api/rate-limit';
	import { formatCount, formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const history = $derived(data.history.ok ? data.history.value : null);
	const totals = $derived(refusalTotals(history?.minutes ?? []));
	const entryCidr = $derived(new Map((data.addresses.ok ? (data.addresses.value.rules ?? []) : []).map((e) => [e.id, e.cidr])));

	// The window is the address, so the server render already marks the one
	// it read, the links work before the page hydrates, and going back shows
	// the window that address named.
	const windows = HISTORY_WINDOWS.map((w) => ({ value: w.value, label: w.label, href: `?hours=${w.value}` }));
</script>

<PageShell
	title="Tenant rate limits"
	documentTitle="Refusal history - Tenant rate limits"
	description="See what this tenant's limit and address lists refused."
	width="wide"
	back={{ href: '/admin/settings/rate-limits', label: 'Rate limits' }}
>
	<RateLimitTabs active="refusals" />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Rate limits"
			absent="Rate limiting is not included in this build."
		/>
	{:else}
		<section class="flex flex-col gap-4" aria-label="Refusal history">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<SectionHeading level={2}>Refusal history</SectionHeading>
				<SegmentedControl label="Window" labelHidden value={String(data.hours)} options={windows} />
			</div>
			{#if !data.history.ok}
				<GateNotice
					gate={data.history.gate}
					title="Refusal history"
					absent="Refusal history needs a newer version of the rate limit plugin."
				/>
			{:else if history}
				{#if totals.length === 0}
					<EmptyState title="No refused requests" description="No rule or list entry refused a request in this window.">
						{#snippet iconSnippet()}
							<ShieldBan size={ICON.lg} />
						{/snippet}
					</EmptyState>
				{:else}
					<p class="text-sm text-muted">{formatCount(history.total_refused)} requests refused.</p>
					<Table label="Refusals by rule">
						<thead>
							<tr>
								<th scope="col">Refused by</th>
								<th scope="col">Route or address</th>
								<th scope="col">Requests</th>
								<th scope="col">Last</th>
							</tr>
						</thead>
						<tbody>
							{#each totals as t (`${t.rule_id}-${t.kind}-${t.endpoint}`)}
								<tr>
									<td data-cell="nowrap" class="text-xs">{refusalKindLabel(t.kind)}</td>
									<td class="max-w-md truncate font-mono text-xs" title={t.endpoint}>
										{t.kind === 'deny' ? (entryCidr.get(t.rule_id) ?? t.endpoint) : t.endpoint}
									</td>
									<td data-cell="nowrap" class="font-mono text-xs">{formatCount(t.refused)}</td>
									<td data-cell="nowrap" class="text-xs text-faint">{formatDateTime(t.last)}</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				{/if}
			{/if}
		</section>
	{/if}
</PageShell>
