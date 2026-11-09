<script lang="ts">
	import { page } from '$app/state';
	import CustomBlocks from '$lib/components/custom/CustomBlocks.svelte';
	import DashboardWidgets from '$lib/components/custom/DashboardWidgets.svelte';
	import {
		Badge,
		Button,
		Card,
		EmptyState,
		PageShell,
		SectionHeading,
		SegmentedControl,
		Stat,
	} from '@lyeve-labs/ui-kit';
	import type { ActionData, PageData } from './$types';
	import { ArrowRight, CircleCheck, OctagonAlert, Pencil, Plus, TriangleAlert } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import TrafficBars from '$lib/components/TrafficBars.svelte';
	import { NO_VALUE, formatCount, formatDateTime, formatPercent, logLevelTone, plural } from '$lib/format';
	import { couldNotLoad } from '$lib/outage';
	import { entryTone } from '$lib/tones';
	import { WINDOWS, WINDOW_LABEL, trafficTone, type Window } from '$lib/dashboard';
	import { ICON } from '$lib/icon';
	import { licenseStateLabel, licenseTone } from '$lib/license-state';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const windowOptions = (Object.keys(WINDOWS) as Window[]).map((w) => ({
		value: w,
		label: w,
		href: `/admin?window=${w}`,
	}));

	const errorRate = $derived(data.requests ? data.requests.errorRate : 0);

	const ms = (n: number) => `${formatCount(Math.round(n))} ms`;
	const whenever = (ts: string | null | undefined) => (ts ? formatDateTime(ts, ts) : NO_VALUE);

	const schemas = $derived(data.schemas?.ok ? data.schemas.value : null);

	/** What the collections carry, from the list already in hand. */
	const collectionsSub = $derived.by(() => {
		if (!schemas) return 'content types unavailable';
		const staged = schemas.filter((s) => s.with_draft_publish).length;
		return staged > 0
			? `${formatCount(staged)} with draft and publish`
			: 'none with draft and publish';
	});

	/*
	 * Whether a tile drawn above could not be read. Nothing needing attention
	 * then covers only what was read, and the line says so.
	 */
	const unread = $derived(
		(data.offers.analytics && !data.requests) ||
			(data.superAdmin && data.offers.jobs && !data.jobs) ||
			(data.offers.logs && data.errorsLogged === null) ||
			(data.offers.webhooks && !data.webhooks) ||
			(data.superAdmin && data.controlFailures === null)
	);

	const entriesSub = $derived(
		data.entriesByStatus
			? `${formatCount(data.entriesByStatus.published)} published, ${formatCount(data.entriesByStatus.drafts)} draft`
			: undefined
	);
</script>

<PageShell
	title="Dashboard"
	description="See what changed and what needs attention."
	width="wide"
>
	{#snippet actions()}
		{#if data.composed}
			<!-- The tenant's own layout: marked beta with the rest of
			     customization, and one click from its editor for an admin. -->
			<Badge tone="violet" size="sm">Beta</Badge>
			{#if data.isAdmin}
				<Button variant="secondary" size="sm" href="/admin/settings/customization/dashboard">
					<Pencil size={ICON.sm} /> Edit dashboard
				</Button>
			{/if}
		{:else if data.isAdmin}
			<!-- Link segments, so the window survives a reload, can be bookmarked,
			     and works with no JavaScript. -->
			<SegmentedControl
				label="Window"
				labelHidden
				size="sm"
				value={data.window}
				options={windowOptions}
			/>
		{/if}
	{/snippet}

	<!-- The migration control lives in the shell header on every screen, and its
	     action is this page's. A reader whose JavaScript never ran arrives here
	     with the refusal, so this is where it is announced. -->
	<FormErrors message={form?.error} />

	{#if data.layoutUnread}
		<p class="flex flex-wrap items-center gap-2 text-sm text-muted">
			<TriangleAlert size={ICON.md} class="shrink-0 text-warn" aria-hidden="true" />
			{couldNotLoad("this tenant's own dashboard")} Showing the standard one.
			<a class="relative hit-area underline hover:text-fg" href="{page.url.pathname}{page.url.search}" data-sveltekit-reload>Try again</a>
		</p>
	{/if}
	{#if data.welcome}
		<p class="text-base text-fg" data-testid="tenant-welcome">{data.welcome}</p>
	{/if}
	<!-- The plugin answers 404 for a page hidden from the reader's role as well
	     as for a missing one. Only an admin, who sees every page, reads a 404
	     as missing, and a reader outside the page's roles is told nothing. -->
	{#if data.home && (data.home.gate.state !== 'absent' || data.isAdmin)}
		<GateNotice
			level={2}
			gate={data.home.gate}
			title="The home page"
			absent="The home page set in Customization, {data.home.slug}, no longer exists. Choose another one in Customization."
		/>
	{:else if data.homePage}
		<section class="flex flex-col gap-4" aria-label={data.homePage.title}>
			<CustomBlocks blocks={data.homeBlocks} roles={data.user.roles} />
		</section>
	{/if}

	{#if data.composed}
		{#if data.composed.length === 0}
			<p class="text-sm text-muted">This dashboard has no widgets for your role yet.</p>
		{:else}
			<DashboardWidgets widgets={data.composed} now={new Date(data.now)} />
		{/if}
	{:else if schemas && schemas.length === 0}
		{#if data.isAdmin}
			<EmptyState level={2} title="No content types yet" description="Create a content type to start adding content.">
				{#snippet action()}
					<Button variant="secondary" href="/admin/schema">
						<Plus size={ICON.sm} /> New content type
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<!-- The engine admits a new schema only from an admin. -->
			<EmptyState level={2} title="No content types yet" description="Ask an administrator to create one." />
		{/if}
	{:else}
		{#if data.isAdmin}
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Needs attention</SectionHeading>

				<!-- The tiles say how many. This says which, and where to fix it. -->
				<Card pad="none">
					{#if data.attention.length === 0 && unread}
						<p class="flex items-center gap-2 px-card py-card-sm text-sm text-muted">
							<TriangleAlert size={ICON.md} class="shrink-0 text-warn" aria-hidden="true" />
							No problems in the tiles that loaded. Tiles marked unknown did not load.
						</p>
					{:else if data.attention.length === 0}
						<p class="flex items-center gap-2 px-card py-card-sm text-sm text-muted">
							<CircleCheck size={ICON.md} class="shrink-0 text-success" aria-hidden="true" />
							Nothing needs attention in the last {WINDOW_LABEL[data.window]}.
						</p>
					{:else}
						<ul class="divide-y divide-line">
							{#each data.attention as item (item.text)}
								<li class="flex items-center justify-between gap-3 px-card py-card-sm">
									<span class="flex min-w-0 items-center gap-2 text-sm text-fg">
										{#if item.tone === 'danger'}
											<OctagonAlert size={ICON.md} class="shrink-0 text-danger" aria-label="Failing" />
										{:else}
											<TriangleAlert size={ICON.md} class="shrink-0 text-warn" aria-label="Warning" />
										{/if}
										<span class="truncate">{item.text}</span>
									</span>
									<Button size="sm" variant="ghost" href={item.href} class="shrink-0">
										{item.action} <ArrowRight size={ICON.sm} />
									</Button>
								</li>
							{/each}
						</ul>
					{/if}
				</Card>
			</section>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Right now</SectionHeading>

			<!-- Each tile is a link to the page that explains its number, and is
			     drawn only while the plugin behind it runs. A tile whose read
			     failed says unknown rather than zero: a read nobody answered is
			     not a quiet instance. -->
			<div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
				{#if data.offers.schema}
					<a href="/admin/content" class="block h-full rounded-card outline-none transition-shadow hover:ring-1 hover:ring-brand/40 focus-visible:ring-2 focus-visible:ring-brand">
						<Stat
							class="h-full"
							label="Content types"
							accent="neutral"
							value={schemas ? formatCount(schemas.length) : 'unknown'}
							sub={collectionsSub}
						/>
					</a>
				{/if}
				<!-- The entry counts are read from a route the engine admits only
				     from an admin, so no other role is shown a count. -->
				{#if data.isAdmin && data.offers.content}
					<a href="/admin/content" class="block h-full rounded-card outline-none transition-shadow hover:ring-1 hover:ring-brand/40 focus-visible:ring-2 focus-visible:ring-brand">
						<Stat class="h-full"
							label="Entries"
							accent="neutral"
							value={data.entryTotal === null ? 'unknown' : formatCount(data.entryTotal)}
							sub={data.entryTotal === null ? 'entries unavailable' : (entriesSub ?? 'across every content type')}
						/>
					</a>
				{/if}
				{#if data.isAdmin}
					{#if data.offers.analytics}
						<a href="/admin/analytics" class="block h-full rounded-card outline-none transition-shadow hover:ring-1 hover:ring-brand/40 focus-visible:ring-2 focus-visible:ring-brand">
							<Stat class="h-full"
								label="Requests, {data.window}"
								value={data.requests ? formatCount(data.requests.total) : 'unknown'}
								sub={data.requests ? `${formatPercent(errorRate)} failed` : 'analytics unavailable'}
								tone={data.requests ? trafficTone(errorRate) : 'neutral'}
							/>
						</a>
						<a href="/admin/analytics" class="block h-full rounded-card outline-none transition-shadow hover:ring-1 hover:ring-brand/40 focus-visible:ring-2 focus-visible:ring-brand">
							<Stat class="h-full"
								label="P95 latency, {data.window}"
								accent="neutral"
								value={data.requests ? ms(data.requests.p95) : 'unknown'}
								sub={data.requests ? 'average across endpoints' : 'analytics unavailable'}
							/>
						</a>
					{/if}
					<!-- The scheduler lists its jobs to a super admin only. -->
					{#if data.superAdmin && data.offers.jobs}
						<a href="/admin/jobs" class="block h-full rounded-card outline-none transition-shadow hover:ring-1 hover:ring-brand/40 focus-visible:ring-2 focus-visible:ring-brand">
							<Stat class="h-full"
								label="Failed jobs"
								value={data.jobs ? formatCount(data.jobs.failed.length) : 'unknown'}
								sub={data.jobs ? `of ${formatCount(data.jobs.enabled)} enabled` : 'jobs unavailable'}
								tone={data.jobs && data.jobs.failed.length > 0 ? 'danger' : 'neutral'}
							/>
						</a>
					{/if}
					{#if data.offers.logs}
						<a href="/admin/logs?level=ERROR" class="block h-full rounded-card outline-none transition-shadow hover:ring-1 hover:ring-brand/40 focus-visible:ring-2 focus-visible:ring-brand">
							<Stat class="h-full"
								label="Errors logged, {data.window}"
								value={data.errorsLogged === null ? 'unknown' : formatCount(data.errorsLogged)}
								sub={data.errorsLogged === null ? 'log unavailable' : 'at level ERROR'}
								tone={data.errorsLogged ? 'danger' : 'neutral'}
							/>
						</a>
					{/if}
					{#if data.offers.webhooks}
						<a href="/admin/webhooks" class="block h-full rounded-card outline-none transition-shadow hover:ring-1 hover:ring-brand/40 focus-visible:ring-2 focus-visible:ring-brand">
							<Stat class="h-full"
								label="Webhooks failing"
								value={data.webhooks ? formatCount(data.webhooks.unhealthy) : 'unknown'}
								sub={data.webhooks
									? `of ${formatCount(data.webhooks.total)}, ${formatCount(data.webhooks.pendingDlq)} dead-lettered`
									: 'webhooks unavailable'}
								tone={data.webhooks && data.webhooks.unhealthy > 0 ? 'warn' : 'neutral'}
							/>
						</a>
					{/if}
				{/if}
				{#if data.license}
					<a href="/admin/settings/license" class="block h-full rounded-card outline-none transition-shadow hover:ring-1 hover:ring-brand/40 focus-visible:ring-2 focus-visible:ring-brand">
						<Stat class="h-full"
							label="License"
							value={data.license.plan || NO_VALUE}
							sub={licenseStateLabel(data.license.state)}
							tone={licenseTone(data.license.state)}
						/>
					</a>
				{/if}
			</div>
		</section>

		{#if data.isAdmin && (data.traffic || data.endpoints)}
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Traffic, last {WINDOW_LABEL[data.window]}</SectionHeading>

				<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
					<Card class="lg:col-span-2">
						<SectionHeading level={3}>
							Requests per hour
							{#snippet actions()}
								<a href="/admin/analytics" class="relative -my-1 py-1 hit-area text-xs text-muted hover:text-brand">Analytics</a>
							{/snippet}
						</SectionHeading>
						<div class="mt-3">
							{#if data.traffic}
								<TrafficBars hours={data.traffic} />
							{:else}
								<p class="text-sm text-faint">{couldNotLoad('the trend', { reload: true })}</p>
							{/if}
						</div>
					</Card>

					<Card>
						<SectionHeading level={3}>Busiest endpoints</SectionHeading>
						{#if !data.endpoints}
							<p class="mt-3 text-sm text-faint">{couldNotLoad('the busiest endpoints', { reload: true })}</p>
						{:else if data.endpoints.length === 0}
							<p class="mt-3 text-sm text-muted">No requests in this window.</p>
						{:else}
							<ul class="mt-3 divide-y divide-line">
								{#each data.endpoints as e (e.key)}
									<li class="flex items-center justify-between gap-3 py-2">
										<span class="min-w-0 truncate font-mono text-xs text-fg" title={e.key}>{e.key}</span>
										<span class="flex shrink-0 items-center gap-2">
											<span class="text-xs tabular-nums text-muted">{formatCount(e.requests)}</span>
											<Badge tone={trafficTone(e.errorRate)} size="sm">{formatPercent(e.errorRate)}</Badge>
										</span>
									</li>
								{/each}
							</ul>
						{/if}
					</Card>
				</div>
			</section>
		{/if}

		{#if data.isAdmin && (data.offers.content || data.offers.audit || data.offers.webhooks || data.offers.logs)}
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>What changed</SectionHeading>

				<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
					{#if data.offers.content}
						<Card>
							<SectionHeading level={3}>
								Recent entries
								{#snippet actions()}
									<a href="/admin/content" class="relative -my-1 py-1 hit-area text-xs text-muted hover:text-brand">All content types</a>
								{/snippet}
							</SectionHeading>
							{#if !data.entries}
								<p class="mt-3 text-sm text-faint">{couldNotLoad('recent entries', { reload: true })}</p>
							{:else if data.entries.length === 0}
								<p class="mt-3 text-sm text-muted">No entries yet.</p>
							{:else}
								<ul class="mt-3 divide-y divide-line">
									{#each data.entries as entry (entry.id)}
										<li class="flex items-center justify-between gap-3 py-2">
											<div class="min-w-0">
												<a
													href="/admin/content/{entry.schema}/{entry.id}"
													class="relative -my-1 py-1 hit-area block text-sm font-medium text-fg hover:text-brand"
												>
													<span class="block truncate">{entry.title || entry.slug || entry.id}</span>
												</a>
												<span class="block truncate font-mono text-xs text-faint">{entry.schema}</span>
											</div>
											<div class="flex shrink-0 items-center gap-2">
												<Badge tone={entryTone(entry.status)} size="sm">{entry.status}</Badge>
												<span class="text-xs text-faint">{whenever(entry.updated_at)}</span>
											</div>
										</li>
									{/each}
								</ul>
							{/if}
						</Card>
					{/if}

					{#if data.isAdmin && data.offers.audit}
						<Card>
							<SectionHeading level={3}>
								Recent audit entries
								{#snippet actions()}
									<a href="/admin/audit-log" class="relative -my-1 py-1 hit-area text-xs text-muted hover:text-brand">Audit log</a>
								{/snippet}
							</SectionHeading>
							{#if !data.audit}
								<p class="mt-3 text-sm text-faint">{couldNotLoad('the audit log', { reload: true })}</p>
							{:else if data.audit.length === 0}
								<p class="mt-3 text-sm text-muted">No audit entries yet.</p>
							{:else}
								<ul class="mt-3 divide-y divide-line">
									{#each data.audit as entry (entry.id)}
										<li class="flex items-center justify-between gap-3 py-2">
											<div class="min-w-0">
												<span class="block truncate text-sm text-fg">{entry.action}</span>
												<span class="block truncate font-mono text-xs text-faint">
													{entry.resource_type}{entry.resource_id ? ` ${entry.resource_id}` : ''}
												</span>
											</div>
											<span class="shrink-0 text-xs text-faint">{whenever(entry.created_at)}</span>
										</li>
									{/each}
								</ul>
							{/if}
						</Card>
					{/if}

					{#if data.isAdmin && data.offers.webhooks}
						<Card>
							<SectionHeading level={3}>
								Dead-lettered deliveries
								{#snippet actions()}
									<a href="/admin/webhooks" class="relative -my-1 py-1 hit-area text-xs text-muted hover:text-brand">Webhooks</a>
								{/snippet}
							</SectionHeading>
							{#if !data.deadLetters}
								<p class="mt-3 text-sm text-faint">{couldNotLoad('the dead letter queue', { reload: true })}</p>
							{:else if data.deadLetters.length === 0}
								<p class="mt-3 text-sm text-muted">No deliveries are waiting in the dead letter queue.</p>
							{:else}
								<ul class="mt-3 divide-y divide-line">
									{#each data.deadLetters as letter (letter.id)}
										<li class="flex items-center justify-between gap-3 py-2">
											<div class="min-w-0">
												<span class="block truncate text-sm text-fg">{letter.webhook_name}</span>
												<span class="block truncate text-xs text-faint">
													{letter.event_type}
													{#if letter.last_error}, {letter.last_error}{/if}
												</span>
											</div>
											<span class="shrink-0 text-xs text-faint">
												{letter.total_attempts}
												{plural(letter.total_attempts, 'attempt')}
											</span>
										</li>
									{/each}
								</ul>
							{/if}
						</Card>
					{/if}

					{#if data.isAdmin && data.offers.logs}
						<Card>
							<SectionHeading level={3}>
								Recent errors, last {WINDOW_LABEL[data.window]}
								{#snippet actions()}
									<a href="/admin/logs?level=ERROR" class="relative -my-1 py-1 hit-area text-xs text-muted hover:text-brand">Logs</a>
								{/snippet}
							</SectionHeading>
							{#if !data.errors}
								<p class="mt-3 text-sm text-faint">{couldNotLoad('the log', { reload: true })}</p>
							{:else if data.errors.length === 0}
								<p class="mt-3 text-sm text-muted">No errors logged in the last {WINDOW_LABEL[data.window]}.</p>
							{:else}
								<ul class="mt-3 divide-y divide-line">
									{#each data.errors as entry, i (entry.timestamp + i)}
										<li class="flex items-start justify-between gap-3 py-2">
											<div class="min-w-0">
												<span class="block truncate text-sm text-fg">{entry.message}</span>
												<span class="block truncate font-mono text-xs text-faint">
													{entry.plugin ?? 'engine'}
												</span>
											</div>
											<div class="flex shrink-0 items-center gap-2">
												<Badge tone={logLevelTone(entry.level)} size="sm">{entry.level}</Badge>
												<span class="text-xs text-faint">{whenever(entry.timestamp)}</span>
											</div>
										</li>
									{/each}
								</ul>
							{/if}
						</Card>
					{/if}
				</div>
			</section>
		{/if}
	{/if}
</PageShell>
