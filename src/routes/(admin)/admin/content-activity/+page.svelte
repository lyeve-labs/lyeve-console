<script lang="ts">
	import { Badge, Button, DatePicker, EmptyState, PageShell, Pagination, Select, Table, type StatusTone } from '@lyeve-labs/ui-kit';
	import { History } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { ACTIVITY_ACTIONS, actionLabel } from '$lib/api/content-history';
	import { pageNumber, pageOffset } from '$lib/api/list';
	import { listQuery } from '$lib/back';
	import { NO_VALUE, formatCount, formatDateTime, plural } from '$lib/format';
	import { couldNotLoad } from '$lib/outage';
	import { ICON } from '$lib/icon';
	import { shortId } from '$lib/utils/entry-identity';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Written by the controls, re-derived when a navigation changes the URL.
	let tenant = $derived(data.tenant ?? '');
	let schema = $derived(data.filter.schema);
	let action = $derived(data.filter.action);
	let source = $derived(data.filter.source);
	let from = $derived(data.filter.from);
	let to = $derived(data.filter.to);

	const filtered = $derived(Object.values(data.filter).some(Boolean) || Boolean(data.tenant));
	const query = $derived({ ...data.filter, ...(data.superAdmin ? { tenant_id: data.tenant } : {}) });
	const pageHref = (offset: number) => `/admin/content-activity${listQuery({ ...query, offset: offset || null })}`;
	const narrowHref = (key: 'entry_id' | 'actor', value: string) =>
		`/admin/content-activity${listQuery({ ...query, [key]: value })}`;

	const rows = $derived(data.activity.ok ? data.activity.value : []);
	const typeLabels = $derived(new Map((data.schemas.ok ? data.schemas.value : []).map((s) => [s.name, s.label])));
	const tenantLabels = $derived(new Map((data.tenants.ok ? data.tenants.value : []).map((t) => [t.slug, t.label])));

	/** The values on the page, the one in force and any the caller always offers, sorted. */
	function choices(all: string, known: readonly string[], seen: string[], current: string, label = (v: string) => v) {
		const values = [...new Set([...known, ...seen, current].filter(Boolean))].sort();
		return [{ value: '', label: all }, ...values.map((v) => ({ value: v, label: label(v) }))];
	}
	const tenantOptions = $derived([
		{ value: '', label: 'All tenants' },
		...(data.tenants.ok ? data.tenants.value : []).map((t) => ({ value: t.slug, label: t.label })),
		...(data.tenant && !tenantLabels.has(data.tenant) ? [{ value: data.tenant, label: data.tenant }] : []),
	]);
	const typeOptions = $derived([
		{ value: '', label: 'All types' },
		...(data.schemas.ok ? data.schemas.value : []).map((s) => ({ value: s.name, label: s.label })),
		...(data.filter.schema && !typeLabels.has(data.filter.schema) ? [{ value: data.filter.schema, label: data.filter.schema }] : []),
	]);
	const actionOptions = $derived(choices('All actions', ACTIVITY_ACTIONS, rows.map((r) => r.action), data.filter.action, actionLabel));
	const sourceOptions = $derived(choices('All sources', [], rows.map((r) => r.source), data.filter.source));

	/**
	 * The editor of the entry a row changed, when the row names a version and
	 * the plugin says the entry is there to open. A super admin reads every
	 * tenant, and the editor opens the session's own, so their rows link
	 * nowhere.
	 */
	function editorHref(row: (typeof rows)[number]): string | null {
		if (data.superAdmin || typeof row.revision_num !== 'number' || row.entry_exists !== true) return null;
		return `/admin/content/${encodeURIComponent(row.schema_name)}/${encodeURIComponent(row.entry_id)}`;
	}

	function actionTone(value: string): StatusTone {
		if (value === 'created' || value === 'published') return 'success';
		if (value === 'deleted' || value === 'archived') return 'danger';
		if (value === 'updated' || value === 'rollback') return 'warn';
		return 'neutral';
	}
</script>

{#snippet emptyIcon()}
	<History size={ICON.lg} />
{/snippet}

<PageShell
	title="Content activity"
	description={data.total === null
		? 'See who changed which entry, when and from where.'
		: `${formatCount(data.total)} ${plural(data.total, 'change')}`}
	width="wide"
	back={{ href: '/admin/content', label: 'Content' }}
>
	{#if data.activity.ok || data.activity.gate.state !== 'absent'}
		<!-- A GET form: the filter lives in the URL, so a filtered view is a link
		     someone can keep. -->
		<form method="GET">
			{#if data.filter.entry_id}<input type="hidden" name="entry_id" value={data.filter.entry_id} />{/if}
			{#if data.filter.actor}<input type="hidden" name="actor" value={data.filter.actor} />{/if}
			<ListToolbar label="Filter content activity">
				{#snippet filters()}
					{#if data.superAdmin}
						<label for="activity-tenant" class="sr-only">Tenant</label>
						<Select id="activity-tenant" name="tenant_id" options={tenantOptions} bind:value={tenant} searchable class="w-44" />
					{/if}
					<label for="activity-type" class="sr-only">Content type</label>
					<Select id="activity-type" name="schema" options={typeOptions} bind:value={schema} searchable class="w-44" />
					<label for="activity-action" class="sr-only">Action</label>
					<Select id="activity-action" name="action" options={actionOptions} bind:value={action} class="w-44" />
					<label for="activity-source" class="sr-only">Source</label>
					<Select id="activity-source" name="source" options={sourceOptions} bind:value={source} class="w-36" />
					<label for="activity-from" class="sr-only">From</label>
					<DatePicker id="activity-from" placeholder="From" bind:value={from} class="w-36" />
					<input type="hidden" name="from" value={from} />
					<label for="activity-to" class="sr-only">To</label>
					<DatePicker id="activity-to" placeholder="To" bind:value={to} class="w-36" />
					<input type="hidden" name="to" value={to} />
					<Button type="submit" variant="secondary">Apply</Button>
					{#if filtered}
						<Button variant="ghost" href="/admin/content-activity">Clear filters</Button>
					{/if}
				{/snippet}
			</ListToolbar>
		</form>
		{#if data.filter.entry_id || data.filter.actor}
			<p class="text-xs text-muted" data-testid="activity-narrowed">
				{#if data.filter.entry_id}Changes to entry <span class="font-mono">{shortId(data.filter.entry_id)}</span>.{/if}
				{#if data.filter.actor}Changes by <span class="font-mono">{shortId(data.filter.actor)}</span>.{/if}
			</p>
		{/if}
		{#if data.superAdmin && !data.tenants.ok}
			<p class="text-xs text-muted">{couldNotLoad('the tenants for the filter', { reload: true })}</p>
		{/if}
	{/if}

	{#if !data.activity.ok}
		<GateNotice
			level={2}
			gate={data.activity.gate}
			title="Content activity"
			absent="Content activity needs a newer version of the engine."
		/>
	{:else if rows.length === 0 && (data.total ?? 0) > 0}
		<EmptyState
			iconSnippet={emptyIcon}
			title="Nothing on this page"
			description={`There are ${formatCount(data.total)} changes, but none on this page. Retention may have removed some since the count was taken.`}
		>
			{#snippet action()}
				<Button variant="secondary" href={pageHref(0)}>Go to the first page</Button>
			{/snippet}
		</EmptyState>
	{:else if rows.length === 0 && filtered}
		<EmptyState iconSnippet={emptyIcon} title="No changes match" description="Widen the dates or clear a filter." />
	{:else if rows.length === 0}
		<EmptyState
			iconSnippet={emptyIcon}
			title="No content changes yet"
			description="Each time someone creates, changes, publishes or deletes an entry, it appears here while activity is on."
		/>
	{:else}
		<div class="flex flex-col gap-4">
			<Table label="Content activity">
				<thead>
					<tr>
						<th scope="col">When</th>
						{#if data.superAdmin}<th scope="col">Tenant</th>{/if}
						<th scope="col">Who</th>
						<th scope="col">Entry</th>
						<th scope="col">Type</th>
						<th scope="col">Action</th>
						<th scope="col">Source</th>
						<th scope="col">Changed fields</th>
						<th scope="col">Version</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.id)}
						<tr>
							<td data-cell="nowrap" class="text-xs text-faint">{formatDateTime(row.created_at)}</td>
							{#if data.superAdmin}
								<td data-cell="nowrap" class="text-xs">{tenantLabels.get(row.tenant_id ?? '') ?? row.tenant_id ?? NO_VALUE}</td>
							{/if}
							<td data-cell="nowrap" class="text-xs" data-testid="activity-actor">
								<!-- Only a missing actor id is unknown. A row written before the kind
								     existed carries it null or not at all, and names a person. -->
								{#if !row.actor_id}
									{NO_VALUE}
								{:else if row.actor_kind === 'api_key'}
									<a href={narrowHref('actor', row.actor_id)} class="underline hover:text-fg" title="Show changes by this API key">
										API key <span class="font-mono">{shortId(row.actor_id)}</span>
									</a>
								{:else}
									<a
										href={narrowHref('actor', row.actor_id)}
										class="underline hover:text-fg {row.actor_email ? '' : 'font-mono'}"
										title="Show changes by this person"
									>
										{row.actor_email || shortId(row.actor_id)}
									</a>
									{#if row.actor_kind === 'admin_token'}
										<span class="block text-faint">through an admin token</span>
									{/if}
								{/if}
							</td>
							<td data-cell="nowrap" class="text-xs {row.entry_title ? '' : 'font-mono'}">
								<a href={narrowHref('entry_id', row.entry_id)} class="underline hover:text-fg" title="Show changes to this entry">
									{row.entry_title || shortId(row.entry_id)}
								</a>
							</td>
							<td data-cell="nowrap" class="text-xs">{typeLabels.get(row.schema_name) ?? (row.schema_name || NO_VALUE)}</td>
							<td><Badge tone={actionTone(row.action)}>{actionLabel(row.action)}</Badge></td>
							<td data-cell="nowrap" class="text-xs text-muted">{row.source || NO_VALUE}</td>
							<td class="text-xs text-muted">{row.fields && row.fields.length > 0 ? row.fields.join(', ') : NO_VALUE}</td>
							<td data-cell="nowrap" class="text-xs">
								{#if typeof row.revision_num === 'number'}
									{@const href = editorHref(row)}
									{#if href}
										<a {href} class="underline hover:text-fg" title="Open the entry">Version {row.revision_num}</a>
									{:else}
										<span class="text-muted">Version {row.revision_num}</span>
									{/if}
								{:else}
									<span class="text-faint">{NO_VALUE}</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
			<Pagination
				page={pageNumber(data.offset, data.limit)}
				perPage={data.limit}
				count={rows.length}
				total={data.total ?? undefined}
				noun="changes"
				href={(page) => pageHref(pageOffset(page, data.limit))}
			/>
		</div>
	{/if}
</PageShell>
