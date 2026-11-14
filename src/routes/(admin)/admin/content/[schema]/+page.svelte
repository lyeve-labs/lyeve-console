<script lang="ts">
	import { couldNotLoad } from '$lib/outage';
	import {
		Alert,
		Autocomplete,
		Badge,
		Breadcrumb,
		Button,
		DatePicker,
		DateTimePicker,
		EmptyState,
		Input,
		MultiSelect,
		PageShell,
		Pagination,
		SearchInput,
		SectionHeading,
		SegmentedControl,
		Select,
		Table,
	} from '@lyeve-labs/ui-kit';
	import type { PageData, ActionData } from './$types';
	import type { Schema, SchemaField } from '@lyeve-labs/client';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { RelationChoices } from '$lib/components/content/relation-choices';
	import { tick, untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import { confirmed } from '$lib/forms.svelte';
	import { pageNumber, pageOffset } from '$lib/api/list';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2, Inbox, X } from '@lucide/svelte';
	import { crumbsAfter } from '$lib/breadcrumb';
	import FieldCell from '$lib/components/FieldCell.svelte';
	import { entryTitle, humanizeFieldName, shortId } from '$lib/utils/entry-identity';
	import { formatCount, formatDate, plural } from '$lib/format';
	import { ICON } from '$lib/icon';
	import { SEARCH_DELAY, liveFilter } from '$lib/live-filter.svelte';
	import {
		FAMILY_OPS,
		columnChoices,
		columnFieldsOf,
		filterKeys,
		forgetView,
		hasViewParam,
		isListOp,
		listPath,
		rememberView,
		sortKeys,
		sortsByStatus,
		statusLabel,
		STATUS_COLUMN,
		validValue,
		viewQuery,
		type Condition,
		type FilterKey,
		type FilterOp,
		type Match,
		type View,
	} from '$lib/utils/entry-view';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Seeded from the load so a search without JavaScript comes back with the
	// box still holding what was typed.
	const live = liveFilter(() => data.q ?? '');

	// A failed read draws its gate instead of the table, so these are only
	// ever rows the engine answered with.
	const entries = $derived(data.items.ok ? data.items.value : []);
	type EntryItem = (typeof entries)[number];

	let userFields = $derived((data.schemaDef?.fields ?? []).filter((f: SchemaField) => !f.system));

	const view = $derived(data.view);
	const shown = $derived(new Set(view.columns));
	// The Entry cell already names the row by its title or slug, so that field
	// is never a column of its own.
	let columnFields = $derived(columnFieldsOf(data.schemaDef).filter((f) => shown.has(f.name)));
	const showStatus = $derived(!!data.schemaDef.with_draft_publish && shown.has(STATUS_COLUMN));
	const showCreated = $derived(shown.has('created_at'));
	const showUpdated = $derived(!!data.schemaDef.with_updated_at && shown.has('updated_at'));
	const columnOptions = $derived(columnChoices(data.schemaDef).map((c) => ({ value: c.key, label: c.label })));

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

	const path = $derived(listPath(data.activeSchema));

	/**
	 * A link inside the page. It always names the page size, so the load
	 * never swaps the remembered view in for it: a person who clears the
	 * filters gets the list without them, not the saved ones back.
	 */
	function viewHref(next: View, { q = data.q, offset = 0 }: { q?: string; offset?: number } = {}): string {
		return `${path}${viewQuery(next, data.schemaDef, { explicit: true, q, offset })}`;
	}

	// An offset need not sit on a page boundary: it arrives in the URL and a
	// delete can leave a hand-edited one behind. pageNumber floors it onto the
	// page that contains it rather than assuming offset / limit divides evenly.
	let currentPage = $derived(pageNumber(data.offset, data.limit));
	// A row link carries the view and page it was opened from, so the entry's
	// back link can return to them. The first page of the default view stays a
	// clean path.
	let rowQuery = $derived(viewQuery(view, data.schemaDef, { q: data.q, offset: data.offset }));

	// Page links rather than a callback, so a page turn works before the page
	// hydrates. The whole view rides along, or a page turn would drop it.
	const pageLink = $derived((page: number) => viewHref(view, { offset: pageOffset(page, data.limit) }));

	type StatusChoice = 'all' | 'draft' | 'published' | 'archived';
	const STATUS_LABELS: Record<StatusChoice, string> = {
		all: 'All',
		draft: 'Draft',
		published: 'Published',
		archived: 'Archived',
	};

	/** A status link keeps the view and drops the offset: page three of one subset is nobody's page three in another. */
	function statusHref(choice: StatusChoice): string {
		return viewHref({ ...view, status: choice === 'all' ? null : choice });
	}

	const statusOptions = $derived(
		(Object.keys(STATUS_LABELS) as StatusChoice[]).map((value) => ({
			value,
			label: STATUS_LABELS[value],
			href: statusHref(value),
		})),
	);

	const sortable = $derived(sortKeys(data.schemaDef));
	const sortKey = $derived(view.sort.replace(/^-/, ''));
	const sortDesc = $derived(view.sort.startsWith('-'));

	/**
	 * A header link sorts by its column, and a second click on the active one
	 * turns it around. An inactive column starts the way its key reads first.
	 * The offset is dropped for the same reason a status link drops it.
	 */
	function sortHref(key: string): string {
		const desc = sortKey === key ? !sortDesc : sortable.get(key) === 'desc';
		return viewHref({ ...view, sort: desc ? `-${key}` : key });
	}

	function ariaSort(key: string): 'ascending' | 'descending' | undefined {
		if (sortKey !== key) return undefined;
		return sortDesc ? 'descending' : 'ascending';
	}

	/** What an operator choice reads as. `filled` is `empty=false`. */
	type Choice = FilterOp | 'filled';

	const OP_WORDS: Record<Choice, string> = {
		eq: 'is',
		ne: 'is not',
		gt: 'is greater than',
		gte: 'is at least',
		lt: 'is less than',
		lte: 'is at most',
		contains: 'contains',
		ncontains: 'does not contain',
		in: 'is any of',
		nin: 'is none of',
		empty: 'is empty',
		filled: 'is not empty',
	};
	const DATE_WORDS: Partial<Record<Choice, string>> = {
		gt: 'is after',
		gte: 'is on or after',
		lt: 'is before',
		lte: 'is on or before',
	};

	const keys = $derived(filterKeys(data.schemaDef));
	const keyOf = $derived(new Map(keys.map((k) => [k.key, k])));
	const keyOptions = $derived(keys.map((k) => ({ value: k.key, label: k.label })));

	// The entries each related content type offers, streamed from the layout.
	// Undefined while they load, null when they could not be read.
	let relationChoices = $state<Record<string, RelationChoices> | null | undefined>(undefined);
	let choicesFrom: unknown = null;
	$effect(() => {
		// The layout's load does not run again for a new filter, sort or page,
		// so the same promise arrives with every navigation inside the list.
		const pending = data.relationChoices;
		if (pending === choicesFrom) return;
		choicesFrom = pending;
		relationChoices = undefined;
		void Promise.resolve(pending).then((read) => {
			if (choicesFrom === pending) relationChoices = read ?? null;
		});
	});

	/** What a relation key's content type offers: undefined while loading, null when the read failed. */
	function choicesOf(key: FilterKey): RelationChoices | null | undefined {
		if (relationChoices === undefined) return undefined;
		const target = key.field?.relation_to;
		const read = target ? relationChoices?.[target] : undefined;
		return read && !read.failed ? read : null;
	}

	/** The entries a relation row chooses from, with any value it already holds that the read did not reach. */
	function relationOptions(key: FilterKey, row: Row): { value: string; label: string }[] {
		const known = (choicesOf(key)?.items ?? []).map((e) => ({
			value: e.id,
			label: String(e.data.title ?? '') || shortId(e.id),
		}));
		const held = [...row.values, row.value].filter((v) => v !== '' && !known.some((o) => o.value === v));
		return [...known, ...held.map((v) => ({ value: v, label: v }))];
	}

	/** Says when a relation's entries are cut, missing or could not be read, the way the entry editor's picker does. */
	function relationHint(key: FilterKey): string | undefined {
		const target = key.field?.relation_to ?? '';
		const read = choicesOf(key);
		if (read === undefined) return undefined;
		if (read === null) return `Could not load the entries in ${target}. Enter an ID by hand, or reload the page to try again.`;
		if (read.total === 0) return `${target} has no entries yet. Enter an ID by hand.`;
		if (read.total > read.items.length) {
			return `Showing the first ${formatCount(read.items.length)} of ${formatCount(read.total)} entries in ${target}.`;
		}
		return undefined;
	}

	/** Whether a relation row chooses from a list: while the entries load, and once some arrived. */
	function listsEntries(key: FilterKey): boolean {
		const read = choicesOf(key);
		return read === undefined || (read?.items.length ?? 0) > 0;
	}

	/**
	 * Whether a relation row also takes an ID typed by hand: the list it shows
	 * is cut, empty or could not be read, so an entry may be missing from it.
	 */
	function takesTypedId(key: FilterKey): boolean {
		const read = choicesOf(key);
		return read !== undefined && (read === null || read.items.length === 0 || read.total > read.items.length);
	}

	/** Adds the ID typed into an "is any of" relation row to its values. */
	function addTypedId(row: Row) {
		const id = row.typed.trim();
		if (id && !row.values.includes(id)) row.values = [...row.values, id];
		row.typed = '';
		changed();
	}

	/**
	 * The operators a row offers. "Is any of" and "is none of" need a list to
	 * choose from, and only a relation whose entries loaded has one. A link
	 * that arrives with one on another field keeps it, so the row can show
	 * and change it.
	 */
	function choicesFor(key: FilterKey, current: Choice | ''): { value: Choice; label: string }[] {
		const family = key.family;
		const listed = family === 'relation' && (choicesOf(key)?.items.length ?? 0) > 0;
		const words = family === 'date' || family === 'datetime' ? { ...OP_WORDS, ...DATE_WORDS } : OP_WORDS;
		const out: Choice[] = [];
		for (const op of FAMILY_OPS[family]) {
			if (op === 'empty') out.push('empty', 'filled');
			else if (!isListOp(op) || listed || op === current) out.push(op);
		}
		return out.map((value) => ({ value, label: words[value] }));
	}

	const BOOLEAN_OPTIONS = [
		{ value: 'true', label: 'True' },
		{ value: 'false', label: 'False' },
	];
	const MATCH_OPTIONS: { value: Match; label: string }[] = [
		{ value: 'all', label: 'All filters' },
		{ value: 'any', label: 'Any filter' },
	];

	// The console shows every time in UTC, so the picker's wall clock is UTC
	// too and the URL carries the instant with its zone.
	const PICKER_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
	function toPicker(value: string): string {
		const at = new Date(value);
		return Number.isNaN(at.getTime()) ? '' : at.toISOString().slice(0, 16);
	}
	function fromPicker(value: string): string {
		return PICKER_MINUTE.test(value) ? `${value}:00Z` : value;
	}

	/** One filter row as it is edited. A row applies once it states a whole condition. */
	/** `typed` is an entry ID being written for an "is any of" relation row, before it joins `values`. */
	type Row = { id: number; key: string; choice: Choice | ''; value: string; values: string[]; typed: string };

	let nextRow = 0;
	function rowsFrom(filters: Condition[]): Row[] {
		return filters.map((c) => {
			const list = isListOp(c.op);
			const choice: Choice = c.op === 'empty' && c.values[0] === 'false' ? 'filled' : c.op;
			const scalar = list || c.op === 'empty' ? '' : c.values[0];
			const value = keyOf.get(c.key)?.family === 'datetime' ? toPicker(scalar) : scalar;
			return { id: nextRow++, key: c.key, choice, value, values: list ? [...c.values] : [], typed: '' };
		});
	}

	function conditionOf(row: Row): Condition | null {
		const key = keyOf.get(row.key);
		if (!key || !row.choice) return null;
		if (row.choice === 'empty' || row.choice === 'filled') {
			return { key: row.key, op: 'empty', values: [row.choice === 'empty' ? 'true' : 'false'] };
		}
		if (isListOp(row.choice)) return row.values.length > 0 ? { key: row.key, op: row.choice, values: [...row.values] } : null;
		// Text is sent as typed. A search for " a" is not a search for "a".
		const value =
			key.family === 'text' ? row.value : key.family === 'datetime' ? fromPicker(row.value.trim()) : row.value.trim();
		return validValue(key.family, row.choice, value) ? { key: row.key, op: row.choice, values: [value] } : null;
	}

	let rows = $state<Row[]>(untrack(() => rowsFrom(data.view.filters)));
	let match = $state<Match>(untrack(() => data.view.match));
	let columns = $state<string[]>(untrack(() => [...data.view.columns]));

	// The view the form submits: the rows that state a whole condition, and
	// the columns in the table's order rather than the order they were chosen.
	const pending = $derived<View>({
		...view,
		filters: rows.map(conditionOf).filter((c): c is Condition => c !== null),
		match,
		columns: columnOptions.map((o) => o.value).filter((key) => columns.includes(key)),
	});
	const pendingQuery = $derived(viewQuery(pending, data.schemaDef, { explicit: true }));
	const hiddenFields = $derived([...new URLSearchParams(pendingQuery.slice(1))]);
	const loadedQuery = $derived(viewQuery(view, data.schemaDef, { explicit: true }));

	// The view of the load in flight, until it lands.
	let sent: string | null = null;

	let timer: ReturnType<typeof setTimeout> | undefined;

	// A navigation this form did not ask for, such as the back button or a
	// link to another view, replaces the rows. A load this form asked for
	// leaves them alone, so a row still being written survives it, and so
	// does a value typed while that load ran. A change still waiting for a
	// pause in typing counts as asked for: a sort or status link clicked in
	// that pause keeps the row, and the change then applies on the new view.
	$effect.pre(() => {
		const loaded = loadedQuery;
		untrack(() => {
			if (loaded !== pendingQuery && loaded !== sent && timer === undefined) {
				rows = rowsFrom(view.filters);
				match = view.match;
				columns = [...view.columns];
			}
			sent = null;
		});
	});

	// Back and Forward go to the view they name. A change still waiting for a
	// pause in typing is dropped, or it would replace the entry Back just
	// opened with the view the person was leaving.
	beforeNavigate(({ type }) => {
		if (type !== 'popstate') return;
		clearTimeout(timer);
		timer = undefined;
	});

	/** Applies the edited view once it differs from the loaded one. Typing waits for a pause first. */
	function changed(typing = false) {
		clearTimeout(timer);
		timer = undefined;
		if (typing) {
			timer = setTimeout(() => {
				timer = undefined;
				apply();
			}, SEARCH_DELAY);
		} else {
			void tick().then(apply);
		}
	}

	function apply() {
		if (pendingQuery !== loadedQuery) live.apply();
	}

	function addRow() {
		rows.push({ id: nextRow++, key: '', choice: '', value: '', values: [], typed: '' });
	}

	/**
	 * Focus moves to the remove button of the row before, or of the row that
	 * moved up into its place, and to Add filter once no row is left, so a
	 * keyboard is never dropped at the top of the page.
	 */
	async function removeRow(row: Row) {
		const at = rows.findIndex((r) => r.id === row.id);
		rows = rows.filter((r) => r.id !== row.id);
		changed();
		const next = rows[Math.max(0, at - 1)];
		await tick();
		document.getElementById(next ? `remove-filter-${next.id}` : 'add-filter')?.focus();
	}

	function setKey(row: Row, key: string) {
		const family = keyOf.get(key)?.family;
		row.key = key;
		const next = keyOf.get(key);
		row.choice = next ? choicesFor(next, '')[0].value : '';
		row.value = family === 'boolean' ? 'true' : '';
		row.values = [];
		changed();
	}

	function setChoice(row: Row, choice: Choice) {
		const was = row.choice;
		row.choice = choice;
		if (isListOp(choice) && !isListOp(was)) row.values = row.value ? [row.value] : [];
		if (!isListOp(choice) && isListOp(was)) row.value = row.values[0] ?? '';
		if (keyOf.get(row.key)?.family === 'boolean' && !row.value) row.value = 'true';
		changed();
	}

	const clearFiltersHref = $derived(viewHref({ ...view, filters: [], match: 'all' }));
	const clearEverythingHref = $derived(viewHref({ ...view, filters: [], match: 'all', status: null }, { q: '' }));
	const isDefaultView = $derived(viewQuery(view, data.schemaDef) === '');

	// Read out once a filter, search, sort or page change has drawn its rows.
	// The region is mounted empty and emptied before each message, so a
	// screen reader hears the same count again after another change.
	let announcement = $state('');

	async function announce() {
		announcement = '';
		await tick();
		if (!data.items.ok) {
			announcement = 'Could not load entries.';
		} else if (data.total === 0) {
			// The same words the empty state on screen uses.
			announcement =
				view.filters.length > 0 || data.q
					? 'No entries match these filters.'
					: view.status
						? `No ${STATUS_LABELS[view.status].toLowerCase()} entries.`
						: 'No entries yet.';
		} else {
			announcement = `${formatCount(data.total)} ${plural(data.total, 'entry', 'entries')}.`;
		}
	}

	// The view is remembered after a navigation the person made, never in the
	// load, because hover preloading runs the load for links nobody opens. A
	// URL with no view part is the plain list or the saved view about to be
	// applied, and neither is written. A view whose entries failed to load is
	// not written either, or every later visit to the plain list would open
	// on the failure.
	afterNavigate(({ from, to }) => {
		if (!to?.url) return;
		if (from?.url.pathname === to.url.pathname) void announce();
		if (!hasViewParam(to.url.searchParams) || !data.items.ok) return;
		rememberView(data.activeSchema, viewQuery(data.view, data.schemaDef, { explicit: true }));
	});

	async function resetView() {
		forgetView(data.activeSchema);
		rows = [];
		await goto(path);
	}

	// The failures a filter cannot cause hide the controls with the table.
	const filterable = $derived(
		data.items.ok || !['absent', 'forbidden', 'locked', 'full'].includes(data.items.gate.state),
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

{#snippet sortHeader(key: string, label: string)}
	<th scope="col" aria-sort={ariaSort(key)}>
		<!-- The header row is 40px tall and the scroll box clips the link's 44px
		     hit area to it. Under a finger the link gives back 4px of its negative
		     margin, so the row grows to 44px and holds the whole area. -->
		<a
			href={sortHref(key)}
			class="relative -my-1 coarse:-my-0.5 py-1 inline-flex items-center gap-1 hit-area outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-focus"
		>
			{label}
			{#if sortKey === key}
				{#if sortDesc}<ArrowDown size={ICON.xs} />{:else}<ArrowUp size={ICON.xs} />{/if}
			{/if}
		</a>
	</th>
{/snippet}

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
				name="schema"
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

		<!-- A div with no role: Orca reads nothing from role="status" and drops
		     a live paragraph. It is always mounted, so text written into it
		     after a change is read, where a region created holding its text is
		     not. -->
		<div class="sr-only" aria-live="polite" aria-atomic="true" data-testid="entry-count">{announcement}</div>

		{#if filterable}
			<!-- A GET form, so Enter still searches without JavaScript. The view
			     rides along as hidden fields, so a search keeps the filters, the
			     order and the columns. Every change applies as soon as it states a
			     whole condition, the way the other lists filter: no Apply button
			     to forget, and the URL always shows what the table shows. A row
			     still being written stays on this page until it has a value. -->
			<!-- A blank search leaves the address, so an in-page link never
			     carries an empty q. The form data is trimmed rather than the field
			     renamed, so the field keeps its focus while the list reloads. -->
			<form
				method="GET"
				class="flex flex-col gap-4"
				{@attach live.form}
				onsubmit={() => (sent = pendingQuery)}
				onformdata={(e) => {
					if (String(e.formData.get('q') ?? '').trim() === '') e.formData.delete('q');
				}}
			>
				<ListToolbar label="Filter entries">
					{#snippet search()}
						<label for="entry-search" class="sr-only">Search entries</label>
						<SearchInput
							id="entry-search"
							name="q"
							bind:value={live.value}
							oninput={live.input}
						/>
						{#each hiddenFields as [name, value], i (i)}
							<input type="hidden" {name} {value} />
						{/each}
					{/snippet}
					{#snippet filters()}
						{#if data.schemaDef.with_draft_publish}
							<SegmentedControl
								label="Status"
								labelHidden
								value={view.status ?? 'all'}
								options={statusOptions}
							/>
						{/if}
						<Button id="add-filter" variant="secondary" onclick={addRow}>
							<Plus size={ICON.sm} /> Add filter
						</Button>
						{#if !isDefaultView}
							<Button variant="ghost" onclick={resetView}>
								<RotateCcw size={ICON.sm} /> Reset view
							</Button>
						{/if}
					{/snippet}
				</ListToolbar>

				{#if rows.length > 0}
					<div class="flex flex-col gap-3" role="group" aria-label="Filters">
						{#each rows as row, i (row.id)}
							{@const key = keyOf.get(row.key)}
							<!-- On a phone the field and the remove button share the first
							     line, and the condition and the value take a line each under
							     them, so each row starts with its own way out. From sm up the
							     four sit on one line, and the remove button keeps the last
							     column even while the row has no value. -->
							<fieldset
								class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,12rem)_minmax(0,1fr)_auto]"
							>
								<legend class="sr-only">Filter {i + 1}</legend>
								<Select
									label="Field"
									value={row.key || null}
									options={keyOptions}
									searchable={keyOptions.length > 10}
									placeholder="Choose a field"
									class="col-start-1 row-start-1"
									onvaluechange={(v) => setKey(row, v)}
								/>
								{#if key}
									<Select
										label="Condition"
										value={row.choice || null}
										options={choicesFor(key, row.choice)}
										class="col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-1"
										onvaluechange={(v) => setChoice(row, v as Choice)}
									/>
									{#if row.choice && row.choice !== 'empty' && row.choice !== 'filled'}
									<div class="col-span-2 min-w-0 sm:col-span-1 sm:col-start-3 sm:row-start-1" data-slot="value">
									{#if isListOp(row.choice)}
										{@const listed =
											key.family === 'relation'
												? relationOptions(key, row)
												: row.values.map((v) => ({ value: v, label: v }))}
										<div class="flex min-w-0 flex-col gap-2">
											<MultiSelect
												label="Values"
												value={row.values}
												options={listed}
												searchable={listed.length > 10}
												hint={key.family === 'relation' ? relationHint(key) : undefined}
												placeholder="Choose values"
												onchange={(v) => {
													row.values = v;
													changed(true);
												}}
											/>
											{#if key.family === 'relation' && takesTypedId(key)}
												<!-- Enter adds the ID rather than submitting the filters
												     without it. -->
												<div class="flex min-w-0 items-end gap-2">
													<Input
														label="Entry ID"
														hint="For an entry not in the list."
														class="min-w-0 flex-1"
														bind:value={row.typed}
														onkeydown={(e: KeyboardEvent) => {
															if (e.key !== 'Enter') return;
															e.preventDefault();
															addTypedId(row);
														}}
													/>
													<Button variant="secondary" onclick={() => addTypedId(row)}>Add ID</Button>
												</div>
											{/if}
										</div>
									{:else if key.family === 'boolean'}
										<SegmentedControl
											label="Value"
											value={row.value === 'false' ? 'false' : 'true'}
											options={BOOLEAN_OPTIONS}
											onchange={(v) => {
												row.value = v;
												changed();
											}}
										/>
									{:else if key.family === 'date'}
										<DatePicker
											label="Value"
											value={row.value}
											onchange={(v) => {
												row.value = v;
												changed();
											}}
										/>
									{:else if key.family === 'datetime'}
										<DateTimePicker
											label="Value (UTC)"
											value={row.value}
											onchange={(v) => {
												row.value = v;
												changed();
											}}
										/>
									{:else if key.family === 'number'}
										<!-- A text field holding the digits as typed: a number control
										     hands back a double, which writes 1e21 for a long value and
										     rounds past 2^53. A value that is not a number says so. -->
										<Input
											label="Value"
											bind:value={row.value}
											error={row.value.trim() !== '' && !validValue('number', 'eq', row.value.trim())
												? 'Enter a number, such as 12 or -4.5.'
												: undefined}
											oninput={() => changed(true)}
										/>
									{:else if key.family === 'relation' && listsEntries(key)}
										{@const entries = relationOptions(key, row)}
										<div class="flex min-w-0 flex-col gap-2">
											<Select
												label="Value"
												value={row.value || null}
												options={entries}
												searchable={entries.length > 10}
												disabled={choicesOf(key) === undefined}
												hint={relationHint(key)}
												placeholder={choicesOf(key) === undefined ? 'Loading entries' : 'Choose an entry'}
												onvaluechange={(v) => {
													row.value = v;
													changed();
												}}
											/>
											{#if takesTypedId(key)}
												<Input
													label="Entry ID"
													hint="For an entry not in the list."
													bind:value={row.value}
													oninput={() => changed(true)}
												/>
											{/if}
										</div>
									{:else if key.family === 'relation'}
										<Input
											label="Value"
											hint={relationHint(key)}
											bind:value={row.value}
											oninput={() => changed(true)}
										/>
									{:else}
										<Input label="Value" bind:value={row.value} oninput={() => changed(true)} />
									{/if}
									</div>
									{/if}
								{/if}
								<Button
									id="remove-filter-{row.id}"
									variant="ghost"
									aria-label="Remove filter {i + 1}"
									class="col-start-2 row-start-1 justify-self-end sm:col-start-4 sm:justify-self-start"
									onclick={() => removeRow(row)}
								>
									<X size={ICON.sm} />
								</Button>
							</fieldset>
						{/each}
						<div class="flex flex-wrap items-end gap-3">
							{#if rows.length > 1}
								<SegmentedControl
									label="Show entries that match"
									value={match}
									options={MATCH_OPTIONS}
									onchange={(v) => {
										match = v;
										changed();
									}}
								/>
							{/if}
							<Button variant="ghost" href={clearFiltersHref} onclick={() => (rows = [])}>
								Clear filters
							</Button>
						</div>
					</div>
				{/if}

				<MultiSelect
					label="Columns"
					value={columns}
					options={columnOptions}
					searchable={columnOptions.length > 10}
					placeholder="Choose columns"
					class="w-full lg:max-w-3xl"
					onchange={(v) => {
						columns = v;
						changed(true);
					}}
				/>
			</form>
		{/if}

		{#if !data.items.ok}
			<GateNotice
				gate={data.items.gate}
				title="Entries"
				absent="Content entries are not included in this build."
			/>
		{:else if entries.length === 0 && (view.filters.length > 0 || data.q)}
			<EmptyState title="No entries match these filters">
				{#snippet iconSnippet()}
					<Inbox size={ICON.lg} />
				{/snippet}
				{#snippet action()}
					<Button href={clearEverythingHref} variant="secondary" onclick={() => (rows = [])}>Clear filters</Button>
				{/snippet}
			</EmptyState>
		{:else if entries.length === 0 && view.status}
			<EmptyState
				title="No {STATUS_LABELS[view.status].toLowerCase()} entries"
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
						{#if sortable.has('title')}
							{@render sortHeader('title', 'Entry')}
						{:else}
							<!-- A declared title of a type with no order takes the key, so
							     the Entry column has nothing to sort by. -->
							<th scope="col">Entry</th>
						{/if}
						{#each columnFields as field (field.name)}
							{#if sortable.has(field.name)}
								{@render sortHeader(field.name, humanizeFieldName(field.name))}
							{:else}
								<th scope="col">{humanizeFieldName(field.name)}</th>
							{/if}
						{/each}
						{#if showStatus && sortsByStatus(data.schemaDef)}
							{@render sortHeader('status', 'Status')}
						{:else if showStatus}
							<!-- A field named status takes the sort key, so the entry's own
							     status has no order to offer. -->
							<th scope="col">{statusLabel(data.schemaDef)}</th>
						{/if}
						{#if showCreated}
							{@render sortHeader('created_at', 'Created')}
						{/if}
						{#if showUpdated}
							{@render sortHeader('updated_at', 'Updated')}
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
									href="{path}/{item.id}{rowQuery}"
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
							{#if showStatus}
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
							{#if showCreated}
								<td class="text-xs whitespace-nowrap text-faint">{formatDate(item.created_at)}</td>
							{/if}
							{#if showUpdated}
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
