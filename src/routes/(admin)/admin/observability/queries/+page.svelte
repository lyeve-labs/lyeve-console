<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Card,
		EmptyState,
		PageShell,
		SearchInput,
		SectionHeading,
		Stat,
		Table,
		Pagination,
	} from '@lyeve-labs/ui-kit';
	import RefreshButton from '#lib/components/RefreshButton.svelte';
	import { goto } from '$app/navigation';
	import { Lightbulb, RefreshCw, Timer } from '@lucide/svelte';
	import GateNotice from '#lib/components/GateNotice.svelte';
	import { page } from '$app/state';
	import { OUTAGE } from '#lib/outage.ts';
	import ListToolbar from '#lib/components/ListToolbar.svelte';
	import {
		ANALYZABLE,
		callerOf,
		durationTone,
		noSuggestionText,
		oneLine,
		type Dialect,
		type QueryLogEntry,
	} from '#lib/api/query-monitor.ts';
	import { NO_VALUE, formatDateTime, formatMillis } from '#lib/format.ts';
	import type { PageData } from './$types';
	import { pageHref, pageNumber } from '#lib/api/list.ts';
	import { ICON } from '#lib/icon.ts';
	import { liveFilter } from '#lib/live-filter.svelte.ts';

	let { data }: { data: PageData } = $props();

	const here = $derived(`${page.url.pathname}${page.url.search}`);

	// The plugin searches the whole capture table, so a match past the first
	// page shows on the first. The search lives in the URL, so the pager, a
	// reload and a shared link keep it.
	const live = liveFilter(() => data.q);

	const slowest = $derived(
		data.entries.reduce((worst, e) => (e.duration_ms > worst ? e.duration_ms : worst), 0),
	);
	const median = $derived(medianOf(data.entries.map((e) => e.duration_ms)));

	function medianOf(values: number[]): number {
		if (values.length === 0) return 0;
		const sorted = [...values].sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
	}

	/**
	 * Every suggestion the analyzer made, flattened with the query it came
	 * from. SQL Server's come from its own views and name no captured query.
	 */
	const suggestions = $derived([
		...(data.analysis?.entries ?? []).flatMap((entry) =>
			(entry.analysis?.index_suggestions ?? []).map((s) => ({ key: entry.id, suggestion: s })),
		),
		...(data.analysis?.missingIndexes ?? []).map((s) => ({ key: 'mssql', suggestion: s })),
	]);

	function analyze(dialect: Dialect | null) {
		const url = new URL(window.location.href);
		if (dialect) url.searchParams.set('dialect', dialect);
		else url.searchParams.delete('dialect');
		void goto(`${url.pathname}${url.search}`, { reset: false });
	}

	function planFlags(entry: QueryLogEntry): string[] {
		const a = entry.analysis;
		if (!a) return [];
		const out: string[] = [];
		if (a.has_seq_scan) out.push('sequential scan');
		if (a.has_nested_loop) out.push('nested loop');
		if (a.has_hash_join) out.push('hash join');
		return out;
	}
</script>

<PageShell
	title="Slow queries"
	description="Review slow SQL statements and their query plans."
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	{#snippet actions()}
		<RefreshButton />
	{/snippet}

	{#if data.gate.state === 'capture_store'}
		<Alert tone="warn">
			<p>Could not load the slow query log.</p>
			<!-- A plain link to this address asks for a fresh document, as the
			     shared notice's retry does, so it works before hydration. -->
			<div class="mt-3">
				<Button variant="secondary" size="sm" href={here} data-sveltekit-reload>
					<RefreshCw size={ICON.sm} aria-hidden="true" /> {OUTAGE.action}
				</Button>
			</div>
		</Alert>
	{:else if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Slow queries"
			absent="The query monitor is not included in this build."
		/>
	{:else}
		<div class="grid gap-4 sm:grid-cols-3">
			<Stat size="sm" mono label="Sampled" value={data.total} />
			<Stat
				size="sm"
				mono
				label="Slowest on this page"
				value={slowest ? formatMillis(slowest) : NO_VALUE}
				tone={slowest >= 1000 ? 'danger' : undefined}
			/>
			<Stat size="sm" mono label="Median on this page" value={median ? formatMillis(median) : NO_VALUE} />
		</div>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Index suggestions</SectionHeading>
			<p class="text-xs text-muted">
				Analysis runs EXPLAIN against the live database, so it only runs when you ask.
			</p>
			<Card>
				<div class="flex flex-wrap items-center gap-2">
					{#each ANALYZABLE as dialect (dialect)}
						<Button
							variant={data.dialect === dialect ? 'primary' : 'secondary'}
							size="sm"
							onclick={() => analyze(dialect)}
						>
							<Lightbulb size={ICON.sm} /> Analyze {dialect}
						</Button>
					{/each}
					{#if data.dialect}
						<Button variant="ghost" size="sm" onclick={() => analyze(null)}>Clear</Button>
					{/if}
				</div>

				{#if data.analyzeFailed}
					<Alert tone="warn">
						Could not explain these statements as {data.dialect}. Choose the dialect this
						engine's database uses.
					</Alert>
				{:else if data.dialect && data.analysis && suggestions.length === 0}
					<p class="text-sm text-muted">{noSuggestionText(data.dialect, data.analysis)}</p>
				{:else if suggestions.length > 0}
					<Table label="Index suggestions">
						<thead>
							<tr>
								<th scope="col">Table</th>
								<th scope="col">Columns</th>
								<th scope="col">Why</th>
								<th scope="col">DDL</th>
							</tr>
						</thead>
						<tbody>
							{#each suggestions as { key, suggestion }, i (`${key}-${i}`)}
								<tr>
									<td data-cell="nowrap" class="font-mono text-xs">{suggestion.table}</td>
									<td data-cell="nowrap" class="font-mono text-xs"
										>{suggestion.columns.join(', ')}</td
									>
									<td class="text-sm">
										{suggestion.reason}
										{#if suggestion.estimated_benefit}
											<Badge tone="success">{suggestion.estimated_benefit}</Badge>
										{/if}
									</td>
									<td class="font-mono text-xs">{suggestion.ddl ?? NO_VALUE}</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				{/if}
			</Card>
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Captured statements</SectionHeading>

			{#if data.entries.length > 0 || data.q}
				<form method="GET" {@attach live.form}>
					{#if data.dialect}<input type="hidden" name="dialect" value={data.dialect} />{/if}
					<ListToolbar label="Filter captured statements">
						{#snippet search()}
							<label for="query-search" class="sr-only">Search captured statements</label>
							<SearchInput
								id="query-search"
								name="q"
								bind:value={live.value}
								oninput={live.input}
								placeholder="Statement, caller or tenant"
							/>
						{/snippet}
					</ListToolbar>
				</form>
			{/if}

			{#if data.entries.length === 0 && data.q}
				<EmptyState title="No statements match this search" description="Clear the search to see every statement.">
					{#snippet action()}
						<Button variant="secondary" href="/admin/observability/queries">Clear filters</Button>
					{/snippet}
				</EmptyState>
			{:else if data.entries.length === 0}
				<EmptyState
					title="No slow queries yet"
					description="Statements appear here when they take longer than the slow query threshold."
				>
					{#snippet iconSnippet()}
						<Timer size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Captured statements">
					<thead>
						<tr>
							<th scope="col">Statement</th>
							<th scope="col">Took</th>
							<th scope="col">Rows</th>
							<th scope="col">Caller</th>
							<th scope="col">Captured</th>
						</tr>
					</thead>
					<tbody>
						{#each data.entries as entry (entry.id)}
							<tr>
								<td>
									<code class="text-xs">{oneLine(entry.query_text)}</code>
									{#if planFlags(entry).length > 0}
										<div class="mt-1 flex flex-wrap gap-1">
											{#each planFlags(entry) as flag (flag)}
												<Badge tone="warn">{flag}</Badge>
											{/each}
										</div>
									{/if}
								</td>
								<td data-cell="nowrap">
									<Badge tone={durationTone(entry.duration_ms)}>{formatMillis(entry.duration_ms)}</Badge>
								</td>
								<td data-cell="nowrap" class="text-xs">{entry.rows_returned ?? NO_VALUE}</td>
								<td data-cell="nowrap" class="font-mono text-xs text-faint"
									>{callerOf(entry) ?? NO_VALUE}</td
								>
								<td data-cell="nowrap" class="text-xs text-faint"
									>{formatDateTime(entry.captured_at)}</td
								>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.entries.length}
					total={data.total ?? undefined}
					noun="queries"
					href={pageHref('/admin/observability/queries', data.limit, data.q ? { q: data.q } : {})}
				/>
			{/if}
		</section>
	{/if}
</PageShell>
