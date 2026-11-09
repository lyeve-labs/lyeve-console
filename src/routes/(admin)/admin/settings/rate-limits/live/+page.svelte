<script lang="ts">
	import { Badge, EmptyState, PageShell, SectionHeading, Stat, Table } from '@lyeve-labs/ui-kit';
	import { Gauge } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import RateLimitTabs from '$lib/components/RateLimitTabs.svelte';
	import { exhausted, resetsIn, type LimiterState } from '$lib/api/rate-limit';
	import type { PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data }: { data: PageData } = $props();

	const live = $derived(data.status.ok ? data.status.value : []);
	const spent = $derived(exhausted(live));
	/*
	 * A bucket is one rule, tenant, caller and endpoint, so the row key names
	 * all four. The engine masks the end of each address, so two callers on one
	 * network can still share all four. A repeat then takes a counter, which
	 * keeps both rows on the page.
	 */
	const liveRows = $derived.by(() => {
		const seen = new Map<string, number>();
		return live.map((s) => {
			const key = [s.rule_id, s.tenant_id ?? '', s.client_ip, s.endpoint].join('\u001f');
			const n = seen.get(key) ?? 0;
			seen.set(key, n + 1);
			return { s, key: n === 0 ? key : `${key}\u001f${n}` };
		});
	});
	/*
	 * A bucket with no tenant means one of two things. The global limit counts
	 * one address across every tenant. Any other rule without a tenant counts
	 * only the requests that resolved none.
	 */
	const countedBy = (s: LimiterState & { kind?: string }) =>
		s.tenant_id ? `Tenant ${s.tenant_id}` : s.kind === 'global' ? 'Every tenant' : 'No tenant';
</script>

<PageShell
	title="Rate limits"
	documentTitle="Right now - Rate limits"
	description="See who is close to reaching a rate limit."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	<RateLimitTabs active="live" />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Rate limits"
			absent="Rate limiting is not included in this build."
		/>
	{:else}
		<div class="grid gap-4 sm:grid-cols-3">
			<Stat
				size="sm"
				mono
				label="Callers at their limit"
				value={data.status.ok ? spent.length : '?'}
				tone={spent.length > 0 ? 'warn' : 'neutral'}
			/>
		</div>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Right now</SectionHeading>
			{#if !data.status.ok}
				<GateNotice gate={data.status.gate} title="Live counters" absent="Rate limiting is not included in this build." />
			{:else if live.length === 0}
				<EmptyState
					title="Nobody is near a limit"
					description="A caller appears here once they use enough of a window to be tracked."
				>
					{#snippet iconSnippet()}
						<Gauge size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Right now">
					<thead>
						<tr>
							<th scope="col">Caller</th>
							<th scope="col">Endpoint</th>
							<th scope="col">Left</th>
							<th scope="col">Resets in</th>
						</tr>
					</thead>
					<tbody>
						{#each liveRows as { s, key } (key)}
							<tr>
								<td data-cell="nowrap" class="text-xs">
									<span class="block font-mono">{s.client_ip}</span>
									<span class="block text-faint">{countedBy(s)}</span>
								</td>
								<td data-cell="nowrap" class="font-mono text-xs text-faint">{s.endpoint}</td>
								<td data-cell="nowrap">
									<Badge tone={s.remaining <= 0 ? 'danger' : 'neutral'}>
										{s.remaining} of {s.burst}
									</Badge>
								</td>
								<td data-cell="nowrap" class="text-xs text-faint">{resetsIn(s.reset_at)}</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<p class="text-xs text-muted">
					This is a snapshot from one engine process. With more than one node, each node counts on its own unless the distributed store is configured.
				</p>
			{/if}
		</section>
	{/if}
</PageShell>
