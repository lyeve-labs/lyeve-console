<script lang="ts">
	import type { PageData } from './$types';
	import type { Schema } from '@lyeve-labs/client';
	import {
		Badge,
		Button,
		EmptyState,
		FilterChips,
		PageShell,
		Pagination,
		SearchInput,
		SectionHeading,
		Table,
	} from '@lyeve-labs/ui-kit';
	import { ArrowDown, ArrowUp, CalendarClock, Database, History, Inbox, LayoutGrid, Plus } from '@lucide/svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { planSchemaRelations } from '$lib/relations';
	import { pageHref, pageNumber } from '$lib/api/list';
	import {
		COLLECTION_FILTERS,
		COLLECTION_SORTS,
		filterCountsRows,
		type CollectionFilter,
		type CollectionSort,
	} from '$lib/api/collections';
	import { NO_VALUE, formatCount, formatDateTime, plural } from '$lib/format';
	import { ICON } from '$lib/icon';
	import { liveFilter } from '$lib/live-filter.svelte';

	let { data }: { data: PageData } = $props();

	// Seeded from the load so a no-JavaScript search comes back with the box
	// still holding what was typed.
	const live = liveFilter(() => data.query ?? '');

	/**
	 * Matching covers the machine name as well as the display name. An operator
	 * arriving from a log line, an API response or a webhook payload has the
	 * machine name and nothing else.
	 */
	function matches(schema: Schema, needle: string): boolean {
		if (!needle) return true;
		return (
			schema.name.toLowerCase().includes(needle) ||
			(schema.display_name || '').toLowerCase().includes(needle)
		);
	}

	// A failed read draws its gate instead of the list, so the rows are only
	// ever the ones the engine answered with.
	const rows = $derived(data.schemas.ok ? data.schemas.value : []);

	let filtered = $derived(
		rows.filter((s: Schema) => matches(s, live.value.trim().toLowerCase())),
	);

	/**
	 * What a row says before the collection is opened.
	 *
	 * A name and a field count alone are nothing an operator chooses by. Rows,
	 * relations and the system columns in force are what the schema page
	 * already knows, said once here.
	 */
	function facts(schema: Schema): {
		rows: number | null;
		updated: string | null;
		fields: number;
		relations: number;
	} {
		const fields = (schema.fields ?? []).filter((f) => !f.system);
		const st = data.stats?.[schema.name];
		return {
			rows: st?.rows ?? null,
			updated: st?.last_updated ?? null,
			fields: fields.length,
			relations: planSchemaRelations(schema, rows).length,
		};
	}

	function flags(schema: Schema): string[] {
		const out: string[] = [];
		if (schema.with_draft_publish) out.push('draft and publish');
		if (schema.with_soft_delete) out.push('soft delete');
		if (schema.with_localization) out.push('localized');
		return out;
	}

	// The parameters a sort link has to keep. The offset is dropped on purpose:
	// page three of one order is nobody's page three in another.
	const kept = $derived({
		...(data.query ? { q: data.query } : {}),
		...(data.filter !== 'all' ? { filter: data.filter } : {}),
		limit: String(data.limit),
	});

	/** A chip narrows the set and keeps the order. It drops the offset for the same reason a sort does. */
	function filterHref(filter: CollectionFilter): string {
		const params = new URLSearchParams({
			...(data.query ? { q: data.query } : {}),
			limit: String(data.limit),
			sort: data.sort,
			dir: data.dir,
		});
		if (filter !== 'all') params.set('filter', filter);
		return `/admin/content?${params}`;
	}

	const filterLabel = $derived(COLLECTION_FILTERS[data.filter].toLowerCase());

	// A chip carries its name and nothing else. Only the two rows chips can
	// be counted, and only once a rows filter or sort has read every
	// collection, so counts would come and go as the reader moves between
	// chips and the control would change width under the pointer. The number
	// for the chosen chip is the heading's, where it is always known.
	const filterOptions = $derived(
		(Object.entries(COLLECTION_FILTERS) as [CollectionFilter, string][]).map(([filter, label]) => ({
			value: filter,
			label,
			href: filterHref(filter),
		})),
	);

	/**
	 * A header link sorts by its column, and a second click on the active one
	 * turns it around. An inactive column starts the way its key reads first.
	 */
	function sortHref(key: CollectionSort): string {
		const dir =
			data.sort === key ? (data.dir === 'asc' ? 'desc' : 'asc') : COLLECTION_SORTS[key];
		return `/admin/content?${new URLSearchParams({ ...kept, sort: key, dir })}`;
	}

	function ariaSort(key: CollectionSort): 'ascending' | 'descending' | undefined {
		if (data.sort !== key) return undefined;
		return data.dir === 'asc' ? 'ascending' : 'descending';
	}

	const empties = $derived(
		filtered.filter((s: Schema) => data.stats?.[s.name]?.rows === 0).length,
	);
</script>

{#snippet sortHeader(key: CollectionSort, label: string, align: 'left' | 'right')}
	<th scope="col" aria-sort={ariaSort(key)} class={align === 'right' ? 'text-right' : undefined}>
		<!-- The header row is 40px tall and the scroll box clips the link's 44px
		     hit area to it. Under a finger the link gives back 4px of its negative
		     margin, so the row grows to 44px and holds the whole area. -->
		<a
			href={sortHref(key)}
			class="relative -my-1 coarse:-my-0.5 py-1 inline-flex items-center gap-1 hit-area outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-focus"
		>
			{label}
			{#if data.sort === key}
				{#if data.dir === 'asc'}<ArrowUp size={ICON.xs} />{:else}<ArrowDown size={ICON.xs} />{/if}
			{/if}
		</a>
	</th>
{/snippet}

<PageShell
	title="Content"
	description="Open a content type to see and edit its entries."
	width="wide"
>
	{#snippet actions()}
		<!-- Releases and activity are served by the same plugin, so a role it
		     refuses here is refused there too. -->
		{#if data.schemas.ok || data.schemas.gate.state !== 'forbidden'}
			<Button variant="ghost" size="sm" href="/admin/releases">
				<CalendarClock size={ICON.sm} /> Releases
			</Button>
			<Button variant="ghost" size="sm" href="/admin/content-activity">
				<History size={ICON.sm} /> Activity
			</Button>
		{/if}
		<Button variant="secondary" size="sm" href="/admin/schema">
			<LayoutGrid size={ICON.sm} /> Schema builder
		</Button>
	{/snippet}

	{#if !data.schemas.ok}
		<GateNotice
			level={2}
			gate={data.schemas.gate}
			title="Content"
			absent="Content is not included in this build."
		/>
	{:else if rows.length === 0 && data.filter === 'all' && !data.query}
		<EmptyState
			level={2}
			title="No content types yet"
			description="Create a content type to start adding content."
		>
			{#snippet iconSnippet()}
				<Database size={ICON.lg} />
			{/snippet}
			{#snippet action()}
				<Button href="/admin/schema" variant="secondary">Go to the schema builder</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<!-- A GET form, so Enter still searches without JavaScript. The search
		     narrows the list as you type and never opens a content type: only the
		     picker on a content type's page does that by name. The
		     order rides along as hidden fields so a search does not reset it, and
		     the chips are links: the subset lives in the URL beside the sort, so it
		     survives a reload and a page turn. A rows chip carries its count only
		     when the rows were already read for the set. -->
		<form method="GET" {@attach live.form}>
			<ListToolbar label="Filter content types">
				{#snippet search()}
					<div class="flex items-center gap-2">
						<label for="collection-search" class="sr-only">Find a content type</label>
						<SearchInput
							id="collection-search"
							name="q"
							placeholder="Search by name or machine name"
							bind:value={live.value}
							oninput={live.input}
							class="min-w-0 flex-1"
						/>
						<input type="hidden" name="sort" value={data.sort} />
						<input type="hidden" name="dir" value={data.dir} />
						{#if data.filter !== 'all'}<input type="hidden" name="filter" value={data.filter} />{/if}
					</div>
				{/snippet}
				{#snippet filters()}
					<nav aria-label="Narrow the content types">
						<FilterChips label="Narrow the content types" value={data.filter} options={filterOptions} />
					</nav>
				{/snippet}
			</ListToolbar>
		</form>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>
				Content types
				<span class="ml-2 text-sm font-normal tabular-nums text-faint">
					{data.total ?? rows.length}
					{#if data.filter !== 'all'}{filterLabel}{/if}
				</span>
			</SectionHeading>

			{#if filtered.length === 0}
				<EmptyState
					title={data.filter === 'all'
						? 'No content types match this search'
						: `No ${filterLabel} content types${data.query ? ' match this search' : ''}`}
					description={data.filter === 'all'
						? 'Clear the search to see every content type.'
						: 'Choose another filter, or All to see every content type.'}
				>
					{#snippet iconSnippet()}
						<Inbox size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						<Button variant="secondary" href="/admin/content">Show every content type</Button>
					{/snippet}
				</EmptyState>
			{:else}
				{#if empties > 0 && !filterCountsRows(data.filter)}
					<p class="text-xs text-faint">
						{empties} of {filtered.length} on this page {plural(empties, 'has', 'have')} no entries.
						<a href={filterHref('with-rows')} class="underline hover:text-fg">Hide them</a>.
					</p>
				{/if}

				<Table label="Content types" hoverable cell="truncate">
					<thead>
						<tr>
							{@render sortHeader('name', 'Content type', 'left')}
							{@render sortHeader('rows', 'Rows', 'right')}
							{@render sortHeader('fields', 'Fields', 'right')}
							<th scope="col" class="text-right">Relations</th>
							{@render sortHeader('updated', 'Last change', 'left')}
							<th scope="col">Options</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each filtered as schema (schema.name)}
							{@const f = facts(schema)}
							<!-- An empty collection is dimmed, not hidden: it is still a
							     destination, and it is where the first entry gets made. -->
							<tr class={f.rows === 0 ? 'text-faint' : ''}>
								<td>
									<!-- The name truncates in a span of its own: the hit box the link
									     grows under a finger is clipped by an overflow the link carries. -->
									<a
										href="/admin/content/{schema.name}"
										class="relative -my-1 py-1 hit-area block font-medium outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-focus {f.rows ===
										0
											? 'text-muted'
											: 'text-fg'}"
									>
										<span class="block truncate">{schema.display_name || schema.name}</span>
									</a>
									<span class="block truncate font-mono text-xs text-faint">{schema.name}</span>
								</td>
								<td data-cell="nowrap" class="text-right tabular-nums">{f.rows === null ? 'unknown' : formatCount(f.rows)}</td>
								<td data-cell="nowrap" class="text-right tabular-nums">{f.fields}</td>
								<td data-cell="nowrap" class="text-right tabular-nums">{f.relations}</td>
								<td class="whitespace-nowrap text-xs">
									{f.updated ? formatDateTime(f.updated, f.updated) : NO_VALUE}
								</td>
								<td>
									<div class="flex flex-wrap gap-1">
										{#each flags(schema) as flag (flag)}
											<Badge tone="neutral" size="sm">{flag}</Badge>
										{/each}
									</div>
								</td>
								<td class="text-right">
									<Button
										variant="ghost"
										size="sm"
										href="/admin/content/{schema.name}/new"
										aria-label="New entry in {schema.display_name || schema.name}"
									>
										<Plus size={ICON.sm} />
									</Button>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>

				<!-- The pager pages what the server matched. The list above narrows the
				     page again as the box is typed into, which is why the two counts can
				     differ for as long as the search has not been submitted. -->
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={rows.length}
					total={data.total ?? undefined}
					hasNext={data.hasMore}
					noun="collections"
					href={pageHref('/admin/content', data.limit, {
						...(data.query ? { q: data.query } : {}),
						...(data.filter !== 'all' ? { filter: data.filter } : {}),
						sort: data.sort,
						dir: data.dir,
					})}
				/>
			{/if}
		</section>
	{/if}
</PageShell>
