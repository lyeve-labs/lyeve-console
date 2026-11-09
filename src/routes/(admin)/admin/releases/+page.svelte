<script lang="ts">
	import { Badge, Button, Drawer, EmptyState, FilterChips, Input, PageShell, Pagination, Table, Textarea } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { CalendarClock, Plus } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { fieldErrors, submitter } from '$lib/forms.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { STATUS_LABELS, statusTone } from '$lib/api/content-releases';
	import { formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let open = $state(false);
	let name = $state('');
	let description = $state('');
	const create = submitter();

	const errors = $derived(fieldErrors(form));
	const formError = $derived(form && 'error' in form ? String(form.error) : undefined);
	const refused = $derived(formRefusal(form));

	function openCreate() {
		name = '';
		description = '';
		open = true;
	}

	// Each chip is a link, so a filtered list is a URL somebody can keep.
	const FILTERS = [
		{ value: '', label: 'All', href: '/admin/releases' },
		{ value: 'draft', label: 'Draft', href: '/admin/releases?status=draft' },
		{ value: 'scheduled', label: 'Scheduled', href: '/admin/releases?status=scheduled' },
		{ value: 'published', label: 'Published', href: '/admin/releases?status=published' },
		{ value: 'failed', label: 'Failed', href: '/admin/releases?status=failed' },
		{ value: 'canceled', label: 'Canceled', href: '/admin/releases?status=canceled' },
	];
</script>

<PageShell
	title="Releases"
	description="Group entries to publish or unpublish them together, now or at a scheduled time."
	width="wide"
>
	{#snippet actions()}
		{#if data.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New release
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Releases"
			absent="Releases are not included in this build."
		/>
	{:else}
		{#if !open}
			<FormErrors message={formError} fields={errors} {refused} />
		{/if}
		<ListToolbar label="Filter releases">
			{#snippet filters()}
				<FilterChips label="Status" value={data.status} options={FILTERS} />
			{/snippet}
		</ListToolbar>

		{#if data.releases.length === 0}
			<EmptyState
				level={2}
				title={data.status ? 'No releases with this status' : 'No releases yet'}
				description={data.status
					? 'Choose another status to see the rest.'
					: 'Create a release to publish several entries together.'}
			>
				{#snippet iconSnippet()}<CalendarClock size={ICON.lg} />{/snippet}
				{#snippet action()}
					{#if !data.status}
						<Button variant="secondary" onclick={openCreate}><Plus size={ICON.sm} /> New release</Button>
					{/if}
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Releases">
				<thead>
					<tr>
						<th scope="col">Name</th>
						<th scope="col">Status</th>
						<th scope="col" class="text-right">Entries</th>
						<th scope="col">Goes out</th>
						<th scope="col">Updated</th>
					</tr>
				</thead>
				<tbody>
					{#each data.releases as r (r.id)}
						<tr>
							<td>
								<a href="/admin/releases/{r.id}" class="relative hit-area font-medium text-fg transition-colors hover:text-brand">{r.name}</a>
								{#if r.failure_reason}
									<span class="block text-xs text-danger">{r.failure_reason}</span>
								{/if}
							</td>
							<td><Badge tone={statusTone(r.status)}>{STATUS_LABELS[r.status] ?? r.status}</Badge></td>
							<td class="text-right font-mono text-xs">{r.item_count}</td>
							<td class="text-xs text-muted">
								{r.published_at ? formatDateTime(r.published_at) : r.scheduled_at ? formatDateTime(r.scheduled_at) : 'Not scheduled'}
							</td>
							<td class="text-xs text-faint">{formatDateTime(r.updated_at)}</td>
						</tr>
					{/each}
				</tbody>
			</Table>
			{#if data.total > data.limit}
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.releases.length}
					total={data.total}
					noun="releases"
					href={pageHref('/admin/releases', data.limit, data.status ? { status: data.status } : {})}
				/>
			{/if}
		{/if}
	{/if}
</PageShell>

<Drawer bind:open title="New release">
	<form method="POST" action="?/create" id="release-form" use:enhance={create.enhance} class="flex flex-col gap-4">
		<FormErrors message={formError} fields={errors} {refused} />
		<Input id="release-name" name="name" label="Name" required bind:value={name} error={errors.name} placeholder="Spring launch" />
		<Textarea id="release-description" name="description" label="Description" rows={3} bind:value={description} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="release-form" disabled={!name.trim()} loading={create.pending}>Create</Button>
	{/snippet}
</Drawer>
