<script lang="ts">
	import {
		Alert,
		Badge,
		CopyButton,
		EmptyState,
		PageShell,
		SectionHeading,
		Table,
	} from '@lyeve-labs/ui-kit';
	import RefreshButton from '$lib/components/RefreshButton.svelte';
	import { Network } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import {
		HEALTH_LABELS,
		grpcHealth,
		healthTone,
		loopbackOnly,
		reflectionNote,
		serviceStatusLabel,
		serviceTone,
		undeclared,
	} from '$lib/api/grpc';
	import { NO_VALUE, plural } from '$lib/format';
	import type { PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data }: { data: PageData } = $props();

	const health = $derived(grpcHealth(data.status));
	const gaps = $derived(undeclared(data.status));
	const note = $derived(reflectionNote(data.status));
</script>

<PageShell
	title="gRPC"
	description="See where the gRPC listener runs and which services it serves."
	width="wide"
>
	{#snippet actions()}
		{#if data.permitted && data.gate.state === 'ok'}
			<RefreshButton />
		{/if}
	{/snippet}

	{#if !data.permitted}
		<Alert tone="brand">
			Only a super admin can see the gRPC status, because it shows the addresses the engine listens on.
		</Alert>
	{:else if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="gRPC"
			absent="gRPC is not included in this build."
		/>
	{:else if data.status}
		<div class="flex items-center gap-2">
			<Badge tone={healthTone(health)} dot>{HEALTH_LABELS[health]}</Badge>
		</div>

		{#if data.status.degraded}
			<!-- No listener was bound on purpose. Calling it a bind failure
			     sends somebody to look at ports. -->
			<Alert tone="warn">
				The gRPC plugin is not enabled on this engine, so no listener was started.
			</Alert>
		{:else if !data.status.listening}
			<Alert tone="danger">
				The gRPC plugin is enabled, but no listener is running. Check the engine's start-up log for a bind failure on the configured address.
			</Alert>
		{/if}

		{#if gaps.length > 0}
			<!-- A service registered on the server and never declared to the
			     health server answers calls while a client that health checks
			     first is told it does not exist. -->
			<Alert tone="warn">
				{gaps.length}
				{plural(gaps.length, 'service is', 'services are')} registered on the server but missing from the health service. They accept calls, but a client that runs a health check first is told they do not exist.
			</Alert>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Listeners</SectionHeading>
			<Table label="Listeners">
				<tbody>
					<tr>
						<th scope="row">gRPC</th>
						<td>
							<div class="flex items-center gap-2">
								<code class="font-mono text-xs">{data.status.address || NO_VALUE}</code>
								{#if data.status.address}
									<CopyButton value={data.status.address} label="Copy the gRPC address" />
								{/if}
							</div>
							{#if loopbackOnly(data.status.address)}
								<!-- The right default, and also the reason a client on
								     another machine cannot connect. -->
								<div class="text-xs text-faint">
									Loopback only, so nothing outside this host can reach it.
								</div>
							{/if}
						</td>
					</tr>
					<tr>
						<th scope="row">Health and REST</th>
						<td>
							<code class="font-mono text-xs">{data.status.health_address || NO_VALUE}</code>
							{#if loopbackOnly(data.status.health_address)}
								<div class="text-xs text-faint">
									Loopback only, so nothing outside this host can reach it.
								</div>
							{/if}
						</td>
					</tr>
					<tr>
						<th scope="row">Reflection</th>
						<td>
							<Badge tone={data.status.reflection ? 'warn' : 'neutral'}>
								{data.status.reflection ? 'On' : 'Off'}
							</Badge>
						</td>
					</tr>
				</tbody>
			</Table>
			{#if note}
				<p class="text-xs text-muted">{note}</p>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Services</SectionHeading>
			{#if data.status.services.length === 0}
				<EmptyState
					title="No services registered"
					description="The listener is running with no services on it."
				>
					{#snippet iconSnippet()}
						<Network size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Services">
					<thead>
						<tr>
							<th scope="col">Service</th>
							<th scope="col">Health status</th>
						</tr>
					</thead>
					<tbody>
						{#each data.status.services as svc (svc.name)}
							<tr>
								<td data-cell="nowrap" class="font-mono text-xs">{svc.name}</td>
								<td data-cell="nowrap">
									<Badge tone={serviceTone(svc.status)} dot>
										{serviceStatusLabel(svc.status)}
									</Badge>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>

		{#if data.status.transcoded_routes.length > 0}
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>REST, without a gRPC client</SectionHeading>
				<p class="text-xs text-muted">
					These routes run on the health listener above and call the same services. Use them from a client without generated stubs.
				</p>
				<ul class="flex flex-col gap-1">
					{#each data.status.transcoded_routes as route (route)}
						<li class="font-mono text-xs text-faint">{route}</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</PageShell>
