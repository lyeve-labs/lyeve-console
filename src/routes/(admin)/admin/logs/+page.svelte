<script lang="ts">
	import {
		Badge,
		Button,
		EmptyState,
		PageShell,
		Pagination,
		SearchInput,
		SectionHeading,
		SegmentedControl,
		Select,
		Stat,
		Table,
	} from '@lyeve-labs/ui-kit';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import type { PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { LOG_PAGE_SIZES } from '$lib/api/logs';
	import { LOG_LEVELS, NO_VALUE, formatCount, formatDateTime, hasTrace, logLevelLabel, logLevelTone, plural } from '$lib/format';
	import { FileText, AlertTriangle, BellRing } from '@lucide/svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { ICON } from '$lib/icon';
	import { liveFilter } from '$lib/live-filter.svelte';

	let { data }: { data: PageData } = $props();
	const live = liveFilter(() => data.q);

	const volume = $derived(data.volume.ok ? data.volume.value : null);
	const levels = $derived(data.levels.ok ? data.levels.value : null);
	const sinks = $derived(data.config.ok ? (data.config.value.sinks ?? []) : null);
	const byLevel = $derived(volume?.by_level ?? {});
	const overrideCount = $derived(
		levels ? Object.keys(levels.tenants ?? {}).length + Object.keys(levels.plugins ?? {}).length : null
	);
	const entries = $derived(data.search.ok ? (data.search.value.results ?? []) : []);

	const ABSENT = 'Logs are not included in this build.';

	// The first figure that could not be read, which speaks for the row. The
	// three reads go to one plugin, so they fail for one reason.
	const figuresGate = $derived(
		[data.volume, data.levels, data.config].find((read) => !read.ok)?.gate ?? null
	);

	// A missing plugin, a license without it or a role that may not read it
	// refuses every read here alike, so one notice says so for the page.
	const whole = $derived(
		!data.search.ok && ['absent', 'locked', 'forbidden'].includes(data.search.gate.state)
			? data.search.gate
			: null
	);

	// With no search and no level, an empty answer is a log that holds nothing
	// yet. Telling that reader to widen a filter sends them looking for one.
	const filtered = $derived(data.q !== '' || data.level !== '');

	// The filter that every link on this page has to carry. An entry position
	// is left out on purpose: a level chip starts from the first page, because
	// an offset into one level's list means nothing in another.
	const filter = $derived({ ...(data.q ? { q: data.q } : {}), ...(data.level ? { level: data.level } : {}) });
	const page = $derived(pageHref('/admin/logs', data.limit, filter));

	// The active chip links to the same view without the level, so a second
	// click clears the filter it set.
	function levelHref(lv: string): string {
		const params = { ...(data.q ? { q: data.q } : {}), ...(lv === data.level ? {} : { level: lv }) };
		return pageHref('/admin/logs', data.limit, params)(1);
	}
</script>

{#snippet emptyIcon()}
	<FileText size={ICON.lg} />
{/snippet}

<PageShell
	title="Logs"
	description="Search log entries and see log volume by level."
	width="wide"
>
	{#snippet actions()}
		<Button variant="secondary" size="sm" href="/admin/logs/alerts">
			<BellRing size={ICON.sm} /> Volume alerts
		</Button>
	{/snippet}

	{#if whole}
		<GateNotice level={2} gate={whole} title="Logs" absent={ABSENT} />
	{:else}
		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Volume and levels</SectionHeading>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<Stat
					label="Volume (24h)"
					value={volume ? formatCount(volume.total) : NO_VALUE}
					sub={volume ? undefined : 'Could not load'}
					accent="brand"
					mono
				/>
				<Stat
					label="Default level"
					value={(levels && logLevelLabel(levels.default_level)) || NO_VALUE}
					sub={overrideCount === null
						? 'Could not load'
						: `${overrideCount} tenant and plugin ${plural(overrideCount, 'override')}`}
					accent="brand"
				/>
				<Stat
					label="Sinks"
					value={sinks === null ? NO_VALUE : sinks.length > 0 ? sinks.map((sink) => sink.driver).join(', ') : 'None'}
					sub={sinks === null ? 'Could not load' : undefined}
					accent="brand"
				/>
			</div>

			{#if figuresGate}
				<GateNotice gate={figuresGate} title="the log volume and levels" absent={ABSENT} />
			{/if}

			{#if Object.keys(byLevel).length > 0 || volume?.alerts?.length}
				<div class="flex flex-wrap items-center gap-1.5">
					{#each LOG_LEVELS as lv (lv)}
						{#if byLevel[lv]}
							<a
								href={levelHref(lv)}
								aria-current={lv === data.level ? 'true' : undefined}
								aria-label={lv === data.level ? 'Show all levels' : `Show only ${lv} entries`}
								class={`relative -my-0.5 py-0.5 hit-area inline-flex rounded-full ring-offset-1 hover:opacity-80 ${lv === data.level ? 'ring-2 ring-brand' : ''}`}
							>
								<Badge tone={logLevelTone(lv)}>{lv} {byLevel[lv]}</Badge>
							</a>
						{/if}
					{/each}
					{#if volume?.alerts?.length}
						<span class="ml-2 flex items-center gap-1 text-xs text-warn">
							<AlertTriangle size={ICON.xs} aria-hidden="true" />
							{volume.alerts.length} volume {plural(volume.alerts.length, 'alert')}
						</span>
					{/if}
				</div>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Entries</SectionHeading>

			<!-- A GET form: the filter lives in the URL, so a filtered view is a link
			     someone can keep and the results still render without hydration. -->
			<form method="GET" {@attach live.form}>
				<ListToolbar label="Filter log entries">
					{#snippet search()}
						<div class="flex items-center gap-2">
							<label for="log-search" class="sr-only">Search</label>
							<SearchInput
								id="log-search"
								name="q"
								bind:value={live.value}
								oninput={live.input}
								placeholder="Message words, a request ID or a trace ID"
								class="min-w-0 flex-1"
							/>
						</div>
					{/snippet}
					{#snippet filters()}
						<label for="log-level" class="sr-only">Level</label>
						<Select
							id="log-level"
							name="level"
							options={[{ value: '', label: 'All levels' }, ...LOG_LEVELS.map((lv) => ({ value: lv, label: lv }))]}
							value={data.level}
							onvaluechange={live.apply}
							class="w-40"
						/>
						<SegmentedControl
							label="Per page"
							labelHidden
							name="limit"
							size="sm"
							options={LOG_PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
							value={String(data.limit)}
							onchange={live.apply}
						/>
					{/snippet}
				</ListToolbar>
			</form>

			{#if !data.search.ok}
				<GateNotice gate={data.search.gate} title="the log entries" absent={ABSENT} />
			{:else if entries.length === 0 && filtered}
				<EmptyState
					iconSnippet={emptyIcon}
					title="No log entries match these filters"
					description="Choose All levels or clear the search to see more."
				>
					{#snippet action()}
						<Button variant="secondary" href="/admin/logs">Clear filters</Button>
					{/snippet}
				</EmptyState>
			{:else if entries.length === 0}
				<EmptyState
					iconSnippet={emptyIcon}
					title="No log entries yet"
					description="Entries appear here for each request and each logged event."
				/>
			{:else}
				<div class="flex flex-col gap-2">
					<Table label="Entries">
						<thead>
							<tr>
								<th scope="col">Time</th>
								<th scope="col">Level</th>
								<th scope="col">Plugin</th>
								<th scope="col">Message</th>
							</tr>
						</thead>
						<tbody>
							{#each entries as entry, i (entry.timestamp + i)}
								<tr class="align-top">
									<td class="whitespace-nowrap text-xs">
										<!-- A timestamp that will not parse shows as it arrived, never as "Invalid Date". -->
										<span class="text-faint">{formatDateTime(entry.timestamp, entry.timestamp)}</span>
									</td>
									<td>
										<Badge tone={logLevelTone(entry.level)}>{entry.level}</Badge>
									</td>
									<td class="whitespace-nowrap text-xs">
										<span class="text-muted">{entry.plugin ?? NO_VALUE}</span>
									</td>
									<td>
										{entry.message}
										{#if hasTrace(entry.trace_id)}
											<span class="ml-2 text-xs text-faint">trace={entry.trace_id}</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</Table>
					<Pagination
						page={pageNumber(data.offset, data.limit)}
						perPage={data.limit}
						count={entries.length}
						total={data.search.value.total ?? undefined}
						noun="entries"
						href={page}
					/>
				</div>
			{/if}
		</section>
	{/if}
</PageShell>
