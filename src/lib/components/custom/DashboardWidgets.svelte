<script lang="ts">
	import { Alert, Badge, Card, SectionHeading, Stat } from '@lyeve-labs/ui-kit';
	import { ExternalLink } from '@lucide/svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import TrafficBars from '$lib/components/TrafficBars.svelte';
	import TrendBars from '$lib/components/custom/TrendBars.svelte';
	import { ICON } from '$lib/icon';
	import { isExternal } from '$lib/api/customization';
	import { WIDTH_SPAN } from '$lib/api/custom-dashboard';
	import { mediaKindLabel } from '$lib/api/media';
	import { WINDOW_LABEL, trafficTone } from '$lib/dashboard';
	import { formatBytes, formatCount, formatDate, formatDateTime, formatPercent } from '$lib/format';
	import { entryTone } from '$lib/tones';
	import type { ResolvedWidget } from '$lib/api/custom-dashboard';
	import { couldNotLoad } from '$lib/outage';

	/**
	 * Draws a tenant's composed dashboard. Every number was read with the
	 * viewer's own session. A read that failed says so rather than showing
	 * zero, and a widget whose plugin this instance does not serve says that.
	 * Text is rendered as elements, never as HTML, and links leave as plain
	 * anchors, so a widget can say anything and run nothing.
	 */
	let { widgets, now = new Date() }: { widgets: ResolvedWidget[]; now?: Date } = $props();

</script>

{#snippet unreadable(what: string)}
	<p class="text-sm text-muted">{couldNotLoad(what, { reload: true })}</p>
{/snippet}

<div class="grid grid-cols-1 gap-4 lg:grid-cols-6" data-testid="dashboard-widgets">
	{#each widgets as w (w.id)}
		<div class="min-w-0 {WIDTH_SPAN[w.width ?? 'half']}" data-widget={w.type}>
			{#if w.type === 'text'}
				{#if w.tone}
					<Alert tone={w.tone} title={w.heading || undefined}><Markdown source={w.body ?? ''} /></Alert>
				{:else}
					<Card class="h-full">
						<div class="flex flex-col gap-2">
							{#if w.heading}<SectionHeading level={3}>{w.heading}</SectionHeading>{/if}
							<Markdown source={w.body ?? ''} />
						</div>
					</Card>
				{/if}
			{:else}
				<Card class="h-full">
					<div class="flex flex-col gap-3">
						<SectionHeading level={3}>{w.heading}</SectionHeading>
						{#if w.unavailable}
							<p class="text-sm text-muted">This widget needs a plugin that is not running on this engine.</p>
						{:else if w.type === 'entry_counts'}
							<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
								{#each w.counts ?? [] as c (c.schema)}
									<div class="flex flex-col gap-2">
										<a href="/admin/content/{c.schema}" class="block rounded-card outline-none transition-shadow hover:ring-1 hover:ring-brand/40 focus-visible:ring-2 focus-visible:ring-brand">
											<Stat
												size="sm"
												mono
												label={c.schema}
												value={c.rows === null ? 'unknown' : formatCount(c.rows)}
												sub={c.days ? `${formatCount(c.days.reduce((a, b) => a + b, 0))} changed in 14 days${c.partial ? ', from the latest 200' : ''}` : undefined}
											/>
										</a>
										{#if c.days}
											<TrendBars days={c.days} label={c.schema} until={now} />
										{/if}
									</div>
								{/each}
							</div>
						{:else if w.type === 'latest_entries'}
							{#if w.entries === null}
								{@render unreadable('these entries')}
							{:else if (w.entries ?? []).length === 0}
								<p class="text-sm text-muted">No entries yet.</p>
							{:else}
								<ul class="divide-y divide-line">
									{#each w.entries ?? [] as e (e.id)}
										<li class="flex items-center justify-between gap-3 py-2">
											<div class="min-w-0">
												<a href="/admin/content/{e.schema}/{e.id}" class="block truncate text-sm text-fg transition-colors hover:text-brand">{e.title}</a>
												<span class="block truncate font-mono text-xs text-faint">{e.schema}</span>
											</div>
											<span class="flex shrink-0 items-center gap-2">
												{#if e.status}<Badge tone={entryTone(e.status)} size="sm">{e.status}</Badge>{/if}
												{#if e.updated_at}<span class="text-xs text-faint">{formatDate(e.updated_at)}</span>{/if}
											</span>
										</li>
									{/each}
								</ul>
							{/if}
						{:else if w.type === 'status_breakdown'}
							{#if !w.statuses}
								{@render unreadable('the counts')}
							{:else}
								<div class="grid grid-cols-3 gap-3">
									<Stat size="sm" label="Published" value={formatCount(w.statuses.published)} tone="success" />
									<Stat size="sm" label="Draft" value={formatCount(w.statuses.draft)} tone="warn" />
									<Stat size="sm" label="Archived" value={formatCount(w.statuses.archived)} />
								</div>
								{#if w.schema}<span class="font-mono text-xs text-faint">{w.schema}</span>{/if}
							{/if}
						{:else if w.type === 'recent_activity'}
							{#if w.audit === null}
								{@render unreadable('the audit log')}
							{:else if (w.audit ?? []).length === 0}
								<p class="text-sm text-muted">No activity yet.</p>
							{:else}
								<ul class="divide-y divide-line">
									{#each w.audit ?? [] as a (a.id)}
										<li class="flex items-center justify-between gap-3 py-2">
											<div class="min-w-0">
												<span class="block truncate text-sm text-fg">{a.action}</span>
												<span class="block truncate font-mono text-xs text-faint">{a.resource_type}{a.resource_id ? ` ${a.resource_id}` : ''}</span>
											</div>
											<span class="shrink-0 text-xs text-faint">{formatDateTime(a.created_at)}</span>
										</li>
									{/each}
								</ul>
							{/if}
						{:else if w.type === 'media_usage'}
							{#if !w.media}
								{@render unreadable('the media library')}
							{:else}
								<div class="grid grid-cols-2 gap-3">
									<Stat size="sm" label="Files" value={formatCount(w.media.files)} />
									<Stat size="sm" label="Space" value={formatBytes(w.media.bytes, 'MB')} sub={w.media.sampled < w.media.files ? `the newest ${formatCount(w.media.sampled)}` : undefined} />
								</div>
								{#if w.media.kinds.length > 0}
									<ul class="flex flex-wrap gap-2">
										{#each w.media.kinds as k (k.kind)}
											<li><Badge size="sm">{mediaKindLabel(k.kind)} {formatCount(k.count)}</Badge></li>
										{/each}
									</ul>
								{/if}
							{/if}
						{:else if w.type === 'api_usage'}
							{#if !w.api}
								{@render unreadable('API usage')}
							{:else}
								<div class="grid grid-cols-3 gap-3">
									<Stat size="sm" label="Requests, {w.window}" value={formatCount(w.api.total)} />
									<Stat size="sm" label="Failed" value={formatPercent(w.api.errorRate)} tone={trafficTone(w.api.errorRate)} />
									<Stat size="sm" label="P95" value="{formatCount(Math.round(w.api.p95))} ms" />
								</div>
								{#if w.api.hours.length > 0 && w.width !== 'third'}
									<TrafficBars hours={w.api.hours} />
								{:else if w.api.hours.length === 0}
									<p class="text-xs text-faint">No requests per hour in the last {WINDOW_LABEL[w.window ?? '24h']}.</p>
								{/if}
							{/if}
						{:else if w.type === 'links'}
							{#if (w.links ?? []).length === 0}
								<p class="text-sm text-muted">No links for your role.</p>
							{:else}
								<ul class="flex flex-col gap-2">
									{#each w.links ?? [] as link (link.url + link.label)}
										<li>
											{#if isExternal(link.url)}
												<a href={link.url} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-sm text-fg transition-colors hover:text-brand">
													{link.label} <ExternalLink size={ICON.sm} aria-hidden="true" />
												</a>
											{:else}
												<a href={link.url} class="text-sm text-fg transition-colors hover:text-brand">{link.label}</a>
											{/if}
										</li>
									{/each}
								</ul>
							{/if}
						{/if}
					</div>
				</Card>
			{/if}
		</div>
	{/each}
</div>
