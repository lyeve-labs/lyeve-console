<script lang="ts">
	import {
		Badge,
		Breadcrumb,
		Button,
		DescriptionList,
		EmptyState,
		PageShell,
		SectionHeading,
		Stat,
		Table
	} from '@lyeve-labs/ui-kit';
	import type { PageData } from './$types';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { crumbsAfter } from '$lib/breadcrumb';
	import { Activity, ExternalLink, Route, Settings } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { methodTone } from '$lib/tones';
	import { isExternalHref } from '$lib/links';
	import { formatCount, formatBytes, formatDateTime, plural, relativeTime } from '$lib/format';
	import { couldNotLoad } from '$lib/outage';
	import { formatNs } from '$lib/api/profiler';
	import { CATEGORY_LABEL } from '$lib/plugin-categories';
	import { ROUTE_GROUP_LABEL, STATE_LABEL, STATE_TONE, groupRoutes } from '$lib/plugin-rows';

	let { data }: { data: PageData } = $props();

	let pluginName = $derived(data.pluginName);
	// What the plugin says about itself, and the state the engine reports.
	// Null for a reader the status report is refused to.
	let plugin = $derived(data.plugin ?? null);
	let title = $derived(plugin?.label ?? pluginName);
	let isSuperAdmin = $derived(data.userRoles.includes('super_admin'));
	let routeCount = $derived(plugin?.routes.length ?? 0);
	let routeGroups = $derived(groupRoutes(plugin?.routes ?? []));

	const back = { href: '/admin/plugins', label: 'Plugins' };
</script>

{#snippet stateDetail()}
	{#if plugin}
		<span class="flex flex-col items-start gap-1">
			<Badge tone={STATE_TONE[plugin.state]}>{STATE_LABEL[plugin.state]}</Badge>
			{#if plugin.reason}
				<span class="text-xs {plugin.state === 'failed' ? 'text-danger' : 'text-muted'}">{plugin.reason}</span>
			{/if}
			{#if plugin.upgradeUrl}
				<a
					href={plugin.upgradeUrl}
					target={isExternalHref(plugin.upgradeUrl) ? '_blank' : undefined}
					rel={isExternalHref(plugin.upgradeUrl) ? 'noopener noreferrer' : undefined}
					class="inline-flex items-center gap-1 text-xs text-brand transition-colors hover:text-brand-light"
				>
					How to enable it
					{#if isExternalHref(plugin.upgradeUrl)}
						<ExternalLink size={ICON.xs} />
						<span class="sr-only">, opens in a new tab</span>
					{/if}
				</a>
			{/if}
		</span>
	{/if}
{/snippet}

{#snippet startedDetail()}
	{#if plugin?.startedAt}
		<span class="flex flex-col items-start gap-0.5">
			<span>{formatDateTime(plugin.startedAt)}</span>
			<span class="text-xs text-faint">{relativeTime(plugin.startedAt)}</span>
		</span>
	{/if}
{/snippet}

{#snippet noRoutes()}
	<Route size={ICON.lg} />
{/snippet}

{#snippet noTraffic()}
	<Activity size={ICON.lg} />
{/snippet}

<PageShell
	{title}
	documentTitle={`${title} - Plugins`}
	description={plugin?.description || 'See what this plugin does and the routes it serves on this engine.'}
	width="wide"
	{back}
>
	{#snippet breadcrumb()}
		<Breadcrumb
			items={crumbsAfter(back, [{ label: 'Plugins', href: '/admin/plugins' }, { label: title }])}
		/>
	{/snippet}

	{#snippet actions()}
		{#if plugin?.beta}
			<Badge tone="violet" size="sm">Beta</Badge>
		{/if}
		<!-- The settings page is a super admin's alone. -->
		{#if isSuperAdmin}
			<Button variant="secondary" size="sm" href="/admin/settings/configuration?plugin={encodeURIComponent(pluginName)}">
				<Settings size={ICON.sm} />
				Settings
			</Button>
		{/if}
	{/snippet}

	{#if data.statusGate}
		<GateNotice level={2} gate={data.statusGate} {title} absent="" />
	{/if}

	{#if plugin}
		<DescriptionList
			items={[
				{ term: 'Name', value: plugin.name },
				{ term: 'Category', value: CATEGORY_LABEL[plugin.category] },
				{ term: 'State', value: STATE_LABEL[plugin.state], detail: stateDetail },
				...(plugin.version ? [{ term: 'Version', value: plugin.version }] : []),
				...(plugin.startedAt
					? [{ term: 'Running since', value: formatDateTime(plugin.startedAt), detail: startedDetail }]
					: []),
			]}
		/>

		<section class="flex flex-col gap-4">
			<SectionHeading>
				What it serves
				{#snippet actions()}
					{#if routeCount > 0}
						<span class="text-sm text-muted">{routeCount} {plural(routeCount, 'route')}</span>
					{/if}
				{/snippet}
			</SectionHeading>

			{#if plugin.state !== 'running'}
				<EmptyState
					iconSnippet={noRoutes}
					title="Not running"
					description="This plugin is not running, so its routes are not available."
				/>
			{:else if routeCount === 0}
				<EmptyState
					iconSnippet={noRoutes}
					title="No routes of its own"
					description="This plugin works through hooks, flows or the engine's own routes."
				/>
			{:else}
				<Table label="Routes {title} serves">
					<thead>
						<tr>
							<th scope="col">Method</th>
							<th scope="col">Path</th>
							<th scope="col">Who can call it</th>
						</tr>
					</thead>
					<tbody>
						{#each routeGroups as [group, routes] (group)}
							{#each routes as route (route.method + ' ' + route.pattern)}
								<tr>
									<td data-cell="nowrap"><Badge tone={methodTone(route.method)} size="sm">{route.method}</Badge></td>
									<td data-cell="nowrap" class="font-mono text-xs">{route.pattern}</td>
									<td data-cell="nowrap" class="text-sm text-muted">{ROUTE_GROUP_LABEL[group]}</td>
								</tr>
							{/each}
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>
	{/if}

	{#if isSuperAdmin}
		<section class="flex flex-col gap-4">
			<SectionHeading>
				Requests
				{#snippet actions()}
					<Button variant="ghost" size="sm" href="/admin/observability/profiler">Open the profiler</Button>
				{/snippet}
			</SectionHeading>

			{#if !data.trafficRead}
				<EmptyState
					iconSnippet={noTraffic}
					title="Request statistics unavailable"
					description={`${couldNotLoad('statistics from the profiler plugin')} Check that it is running.`}
				/>
			{:else if !data.traffic}
				<EmptyState
					iconSnippet={noTraffic}
					title="No requests sampled yet"
					description="The profiler has not sampled a request to this plugin since it started."
				/>
			{:else}
				<div class="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="traffic-stats">
					<Stat size="sm" label="Requests sampled" mono value={formatCount(data.traffic.count)} />
					<Stat size="sm" label="Average" mono value={formatNs(data.traffic.avg_duration_ns)} />
					<Stat size="sm" label="Slowest" mono value={formatNs(data.traffic.max_duration_ns)} />
					<Stat size="sm" label="Allocated" mono value={formatBytes(data.traffic.total_alloc_bytes)} />
				</div>
				<p class="text-xs text-faint">
					Across every tenant, from the profiler's recent sample. Resetting the profiler restarts the count.
				</p>
			{/if}
		</section>
	{/if}
</PageShell>
