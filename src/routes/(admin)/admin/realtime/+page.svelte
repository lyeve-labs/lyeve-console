<script lang="ts">
	import {
		Badge,
		Card,
		EmptyState,
		PageShell,
		SectionHeading,
		Stat,
		Table,
	} from '@lyeve-labs/ui-kit';
	import RefreshButton from '$lib/components/RefreshButton.svelte';
	import { Radio, Satellite, Users } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { inUse, tenantLoad, uptimeSince, type StreamMetrics } from '$lib/api/realtime';
	import { NO_VALUE, formatCount } from '$lib/format';
	import type { PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data }: { data: PageData } = $props();

	const streamUsed = $derived(inUse(data.stream));
	const socketUsed = $derived(inUse(data.socket));
	const loads = $derived(tenantLoad(data.platform?.connections_by_tenant));
	// The plugin's tenant view hard-codes the idle count to zero, so it is no
	// measurement and is not shown.
	const socketStates = $derived(
		Object.entries(data.socket?.connections_by_state ?? {}).filter(([state]) => state !== 'idle'),
	);

	function pct(share: number): string {
		return `${Math.round(share * 100)}%`;
	}

	/** The window the cumulative counters cover, so a total means something. */
	function window_(m: StreamMetrics | null): string {
		return m ? uptimeSince(m.since) : NO_VALUE;
	}
</script>

<PageShell
	title="Realtime"
	description="See who is connected over server-sent events and WebSocket, and what has been pushed to them."
	width="wide"
>
	{#snippet actions()}
		<RefreshButton />
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Realtime"
			absent="Realtime is not included in this build."
		/>
	{:else}
		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Server-sent events</SectionHeading>
			{#if data.streamGate}
				<GateNotice gate={data.streamGate} title="the server-sent events counters" absent="Server-sent events are not included in this build." />
			{:else if !streamUsed}
				<p class="text-sm text-muted">
					No connections over this transport yet.
				</p>
			{/if}
			{#if !data.streamGate}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					<Stat size="sm" mono label="Open now" value={formatCount(data.stream?.active_connections)} />
					<Stat
						size="sm"
						mono
						label="Accepted in {window_(data.stream)}"
						value={formatCount(data.stream?.total_connections)}
					/>
					<Stat size="sm" mono label="Events pushed, whole engine" value={formatCount(data.stream?.events_dispatched)} />
					<Stat
						size="sm"
						mono
						label="Rejected, whole engine"
						value={formatCount(data.stream?.connections_rejected)}
						tone={(data.stream?.connections_rejected ?? 0) > 0 ? 'warn' : undefined}
					/>
				</div>
				<p class="text-xs text-faint">
					Open now and Accepted count this tenant's connections. The other counters cover every tenant on
					the engine.
				</p>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>WebSocket</SectionHeading>
			{#if data.socketGate}
				<GateNotice gate={data.socketGate} title="the WebSocket counters" absent="WebSocket connections are not included in this build." />
			{:else if !socketUsed}
				<p class="text-sm text-muted">
					No connections over this transport yet.
				</p>
			{/if}
			{#if !data.socketGate}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<Stat size="sm" mono label="Open now" value={formatCount(data.socket?.active_connections)} />
					<Stat size="sm" mono label="Broadcasts, whole engine" value={formatCount(data.socket?.broadcasts_sent)} />
					<Stat size="sm" mono label="Reconnections, whole engine" value={formatCount(data.socket?.reconnections)} />
				</div>
				<p class="text-xs text-faint">
					Open now counts this tenant's sockets. Broadcasts and reconnections cover every tenant on the
					engine.
				</p>
			{/if}

			{#if socketStates.length > 0}
				<Card>
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-xs text-muted">Sockets by state</span>
						{#each socketStates as [state, count] (state)}
							<Badge tone="neutral">{state} {count}</Badge>
						{/each}
					</div>
				</Card>
			{/if}
		</section>

		{#if data.superAdmin}
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Connections by tenant</SectionHeading>
				{#if data.platformGate}
					<GateNotice
						gate={data.platformGate}
						title="the per-tenant roster"
						absent="Connections by tenant need a newer version of the realtime plugin."
					/>
				{:else if loads.length === 0}
					<EmptyState
						title="No open connections"
						description="A tenant appears here while it has a stream open."
					>
						{#snippet iconSnippet()}
							<Users size={ICON.lg} />
						{/snippet}
					</EmptyState>
				{:else}
					<Table label="Connections by tenant">
						<thead>
							<tr>
								<th scope="col">Tenant</th>
								<th scope="col">Open now</th>
								<th scope="col">Share</th>
							</tr>
						</thead>
						<tbody>
							{#each loads as load (load.tenant)}
								<tr>
									<td data-cell="nowrap" class="font-mono text-xs">{load.tenant}</td>
									<td data-cell="nowrap">{load.connections}</td>
									<td data-cell="nowrap" class="text-xs text-faint">{pct(load.share)}</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				{/if}
			</section>
		{/if}

		{#if !data.streamGate && !data.socketGate && !streamUsed && !socketUsed}
			<EmptyState
				title="No connections yet"
				description="Open a stream from a client to see it here."
			>
				{#snippet iconSnippet()}
					<Satellite size={ICON.lg} />
				{/snippet}
			</EmptyState>
		{/if}
	{/if}
</PageShell>
