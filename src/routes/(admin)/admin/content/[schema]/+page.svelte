<script lang="ts">
	import { couldNotLoad } from '$lib/outage';
	import {
		Alert,
		Autocomplete,
		Badge,
		Breadcrumb,
		Button,
		EmptyState,
		PageShell,
		Pagination,
		SectionHeading,
		SegmentedControl,
		Table,
	} from '@lyeve-labs/ui-kit';
	import type { PageData, ActionData } from './$types';
	import type { Schema, SchemaField } from '@lyeve-labs/client';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { confirmed } from '$lib/forms.svelte';
	import { listQuery } from '$lib/back';
	import { pageHref, pageNumber } from '$lib/api/list';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { Plus, Trash2, Inbox } from '@lucide/svelte';
	import { crumbsAfter } from '$lib/breadcrumb';
	import FieldCell from '$lib/components/FieldCell.svelte';
	import { entryTitle, humanizeFieldName, shortId } from '$lib/utils/entry-identity';
	import { formatDate } from '$lib/format';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// A failed read draws its gate instead of the table, so these are only
	// ever rows the engine answered with.
	const entries = $derived(data.items.ok ? data.items.value : []);
	type EntryItem = (typeof entries)[number];

	let userFields = $derived((data.schemaDef?.fields ?? []).filter((f: SchemaField) => !f.system));

	// The Entry cell already names the row from title, or from slug when there
	// is no title. Printing that same field again as a column would show every
	// row's headline twice and push the fields a reader came for off the right
	// edge.
	const labelField = $derived(
		['title', 'slug'].find((name) => userFields.some((f: SchemaField) => f.name === name)),
	);
	let columnFields = $derived(userFields.filter((f: SchemaField) => f.name !== labelField));

	/**
	 * The collection picker's options.
	 *
	 * The label carries the machine name alongside the display name, because
	 * that is what the combobox matches on and an operator reading a log line,
	 * an API response or a webhook payload has the machine name and nothing
	 * else. A collection whose display name is already its machine name is
	 * labeled once.
	 */
	let schemaOptions = $derived(
		(data.schemas.ok ? data.schemas.value : []).map((s: Schema) => ({
			value: s.name,
			label: s.display_name && s.display_name !== s.name ? `${s.display_name} (${s.name})` : s.name,
		})),
	);

	// An offset need not sit on a page boundary: it arrives in the URL and a
	// delete can leave a hand-edited one behind. pageNumber floors it onto the
	// page that contains it rather than assuming offset / limit divides evenly.
	let currentPage = $derived(pageNumber(data.offset, data.limit));
	// A row link carries the page it was opened from, so the entry's back link
	// can return to it. The first page at the default size stays a clean path.
	let rowQuery = $derived(listQuery(data.offset > 0 ? { limit: data.limit, offset: data.offset } : {}));

	// Page links rather than a callback, so a page turn works before the page
	// hydrates. The status filter rides along, or a page turn would drop it.
	const pageLink = $derived(
		pageHref(`/admin/content/${data.activeSchema}`, data.limit, data.status ? { status: data.status } : {}),
	);

	type StatusChoice = 'all' | 'draft' | 'published' | 'archived';
	const STATUS_LABELS: Record<StatusChoice, string> = {
		all: 'All',
		draft: 'Draft',
		published: 'Published',
		archived: 'Archived',
	};

	/** A status link keeps the page size and drops the offset: page three of one subset is nobody's page three in another. */
	function statusHref(choice: StatusChoice): string {
		const params = new URLSearchParams({ limit: String(data.limit) });
		if (choice !== 'all') params.set('status', choice);
		return `/admin/content/${data.activeSchema}?${params}`;
	}

	const statusOptions = $derived(
		(Object.keys(STATUS_LABELS) as StatusChoice[]).map((value) => ({
			value,
			label: STATUS_LABELS[value],
			href: statusHref(value),
		})),
	);

	function openCollection(name: string) {
		if (!name || name === data.activeSchema) return;
		goto(`/admin/content/${name}`);
	}

	/**
	 * The confirmation names the entry, not its id. A destructive action that
	 * cannot be undone has to name what it is about to destroy, and eight
	 * characters of a UUID name nothing an author would recognize. The full id
	 * goes on the dialog's detail line, set apart in monospace, where it does
	 * not wrap inside the sentence and is there for whoever needs to find the
	 * entry again.
	 *
	 * enhance awaits this before it sends anything, so canceling here means the
	 * request is never made.
	 */
	function deleteEntry(item: EntryItem): SubmitFunction {
		return (input) => {
			const title = entryTitle(item, userFields);
			const named =
				title.source === 'none' ? `the untitled entry ${shortId(item.id)}` : title.label;
			const done =
				title.source === 'none' ? `Untitled entry ${shortId(item.id)} deleted.` : `${title.label} deleted.`;
			return confirmed(`Delete ${named}?`, 'Its revisions and translations are deleted too.', {
				confirmLabel: 'Delete',
				detail: item.id,
				success: done
			})(input);
		};
	}

	const back = { href: '/admin/content', label: 'Content' };
</script>

<PageShell
	title={data.schemaDef.display_name || data.activeSchema}
	width="wide"
	{back}
>
	<!-- No description. The length of the page is not the size of the
	     collection. Pagination below states the real total and the slice on
	     screen, so the count belongs there and nowhere else. -->
	{#snippet breadcrumb()}
		<!-- An author walking in from Content needs something on screen naming
		     where they are and a route back other than the browser. The sidebar
		     cannot stand in for it: it marks Content, and Content is the
		     collection index rather than this page. -->
		<Breadcrumb
			items={crumbsAfter(back, [
				{ label: 'Content', href: '/admin/content' },
				{ label: data.schemaDef.display_name || data.activeSchema },
			])}
		/>
	{/snippet}

	{#snippet actions()}
		{#if data.items.ok}
			<Button size="sm" href="/admin/content/{data.activeSchema}/new">
				<Plus size={ICON.sm} /> New entry
			</Button>
		{/if}
	{/snippet}

	{#if data.schemas.ok && data.schemas.value.length > 1}
		<!-- A GET form, so submitting opens the collection without JavaScript.
		     A search scales to any number of schemas, where a tab strip in one
		     horizontal scroller stops being usable at a few dozen. -->
		<form method="GET" action="/admin/content" class="max-w-sm">
			<Autocomplete
				id="collection-picker"
				name="q"
				label="Content type"
				placeholder="Search content types"
				value={data.activeSchema}
				options={schemaOptions}
				allowClear={false}
				onchange={openCollection}
			/>
		</form>
	{:else if !data.schemas.ok}
		<p class="text-sm text-muted">{couldNotLoad('the other content types', { reload: true })}</p>
	{/if}

	{#if form?.error}
		<Alert tone="danger">{form.error}</Alert>
	{/if}

	<!-- The collection picker above is its own region, so without this the table
	     and the picker sit under the page title with nothing separating them. -->
	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>Entries</SectionHeading>

		<!-- The listing route filters by status and by nothing else, so the
		     toolbar offers no search: a box that narrowed only the rows on
		     screen would read as a search of the collection. -->
		{#if data.schemaDef.with_draft_publish && data.items.ok}
			<ListToolbar label="Filter entries">
				{#snippet filters()}
					<SegmentedControl
						label="Status"
						labelHidden
						size="sm"
						value={data.status ?? 'all'}
						options={statusOptions}
					/>
				{/snippet}
			</ListToolbar>
		{/if}

		{#if !data.items.ok}
			<GateNotice
				gate={data.items.gate}
				title="Entries"
				absent="Content entries are not included in this build."
			/>
		{:else if entries.length === 0 && data.status}
			<EmptyState
				title="No {STATUS_LABELS[data.status].toLowerCase()} entries"
				description="Choose another status, or All to see every entry."
			>
				{#snippet iconSnippet()}
					<Inbox size={ICON.lg} />
				{/snippet}
				{#snippet action()}
					<Button href={statusHref('all')} variant="secondary">Show every entry</Button>
				{/snippet}
			</EmptyState>
		{:else if entries.length === 0}
			<EmptyState title="No entries yet" description="Add the first entry to this content type.">
				{#snippet iconSnippet()}
					<Inbox size={ICON.lg} />
				{/snippet}
				{#snippet action()}
					<Button href="/admin/content/{data.activeSchema}/new" variant="secondary">
						<Plus size={ICON.sm} /> New entry
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Entries">
				<thead>
					<tr>
						<th scope="col">Entry</th>
						{#each columnFields as field (field.name)}
							<th scope="col">{humanizeFieldName(field.name)}</th>
						{/each}
						{#if data.schemaDef.with_draft_publish}
							<th scope="col">Status</th>
						{/if}
						<th scope="col">Created</th>
						{#if data.schemaDef.with_updated_at}
							<th scope="col">Updated</th>
						{/if}
						<th scope="col" class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each entries as item (item.id)}
						{@const title = entryTitle(item, userFields)}
						<tr>
							<!-- Truncate rather than wrap: the kit's default breaks a cell
							     at any character, and a schema wide enough to overflow the
							     table would squeeze this column to one letter per line. -->
							<td data-cell="truncate">
								<!-- The name the author gave the thing, with the id under it.
								     The id is what an operator copies into a query. It is
								     not what they scan a page of rows by. -->
								<a
									href="/admin/content/{data.activeSchema}/{item.id}{rowQuery}"
									class="relative hit-area font-medium text-fg transition-colors hover:text-brand"
								>
									{#if title.source === 'none'}
										<span class="font-mono">{shortId(item.id)}</span>
									{:else}
										{title.label}
									{/if}
								</a>
								<span class="block text-xs text-faint">
									{#if title.source === 'none'}
										Untitled entry
									{:else}
										<span class="font-mono">{shortId(item.id)}</span>
									{/if}
								</span>
							</td>
							{#each columnFields as field (field.name)}
								<td class="max-w-50 truncate">
									<FieldCell {field} value={item.data[field.name]} />
								</td>
							{/each}
							{#if data.schemaDef.with_draft_publish}
								{@const status = item.data._status ?? 'published'}
								<td>
									<Badge
										tone={status === 'published'
											? 'success'
											: status === 'archived'
												? 'neutral'
												: 'warn'}
									>
										{status}
									</Badge>
								</td>
							{/if}
							<td class="text-xs whitespace-nowrap text-faint">{formatDate(item.created_at)}</td>
							{#if data.schemaDef.with_updated_at}
								<td class="text-xs whitespace-nowrap text-faint">{formatDate(item.updated_at)}</td>
							{/if}
							<td class="text-right">
								<form
									method="POST"
									action="?/delete"
									class="inline-flex"
									use:enhance={deleteEntry(item)}
								>
									<input type="hidden" name="id" value={item.id} />
									<!-- On screen for every row. Revealed on hover, it would leave
									     the ACTIONS header over a column of blank cells for anyone
									     reading the table, printing it or arriving without a
									     pointer. The control is the same ghost Button every other
									     list row uses. -->
									<Button
										variant="ghost"
										size="sm"
										type="submit"
										aria-label="Delete {title.label || shortId(item.id)}"
									>
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>

			<Pagination
				page={currentPage}
				total={data.total}
				perPage={data.limit}
				href={pageLink}
			/>
		{/if}
	</section>
</PageShell>
