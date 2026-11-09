<script lang="ts">
	import {
		Alert,
		Badge,
		EmptyState,
		FilterChips,
		PageShell,
		SectionHeading,
		Pagination,
		Table,
		type StatusTone,
	} from '@lyeve-labs/ui-kit';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ReviewTabs from '$lib/components/ReviewTabs.svelte';
	import { ClipboardCheck } from '@lucide/svelte';
	import type { PageData } from './$types';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { REVIEW_STATUSES, type ReviewStatus } from '$lib/api/review';
	import { formatDateTime, NO_VALUE } from '$lib/format';
	import { couldNotLoad } from '$lib/outage';
	import { shortId } from '$lib/utils/entry-identity';
	import { pageNumber, pageOffset } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data }: { data: PageData } = $props();

	const STATUS_LABEL: Record<ReviewStatus, string> = {
		draft: 'Draft',
		pending_review: 'Pending review',
		in_review: 'In review',
		changes_requested: 'Changes requested',
		approved: 'Approved',
		rejected: 'Rejected',
		published: 'Published',
	};
	const STATUS_TONE: Record<ReviewStatus, StatusTone> = {
		draft: 'neutral',
		pending_review: 'brand',
		in_review: 'brand',
		changes_requested: 'warn',
		approved: 'success',
		rejected: 'danger',
		published: 'success',
	};

	// Link chips: the filter is the engine's, so the page reloads with it in
	// the URL and the choice survives a refresh and a share.
	const statusOptions = [
		{ value: '', label: 'All', href: '/admin/reviews' },
		...REVIEW_STATUSES.filter((s) => s !== 'draft').map((s) => ({
			value: s,
			label: STATUS_LABEL[s],
			href: `/admin/reviews?status=${s}`,
		})),
	];

	// Only rows the engine answered with. A failed definitions read leaves the
	// names to their short ids, and a note under the filter says why.
	let definitionRows = $derived(data.definitions.ok ? data.definitions.value : []);
	let assignmentRows = $derived(data.assignments.ok ? data.assignments.value : []);

	let byDefinition = $derived(new Map(definitionRows.map((row) => [row.definition.id, row])));

	function stageName(definitionId: string, stageId: string): string {
		const row = byDefinition.get(definitionId);
		return row?.stages?.find((s) => s.id === stageId)?.name ?? shortId(stageId);
	}

	function definitionName(definitionId: string): string {
		return byDefinition.get(definitionId)?.definition.name ?? shortId(definitionId);
	}

	/** The entry's title, or its short id when the page could not read one. */
	function entryName(entryId: string): string {
		return data.entries[entryId] ?? shortId(entryId);
	}

	/** The account's email, or its short id when the page could not read one. */
	function personName(userId: string): string {
		if (!userId || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(userId)) return 'Nobody';
		return data.people[userId] ?? shortId(userId);
	}

	function entryHref(definitionId: string, entryId: string): string | null {
		const schema = byDefinition.get(definitionId)?.definition.content_schema;
		return schema ? `/admin/content/${encodeURIComponent(schema)}/${encodeURIComponent(entryId)}` : null;
	}

	function overdue(a: { status: ReviewStatus; overdue: boolean; due_at: string | null }): boolean {
		if (a.status === 'approved' || a.status === 'published') return false;
		return a.overdue || (!!a.due_at && new Date(a.due_at).getTime() < Date.now());
	}

	const pageHref = (offset: number) =>
		`/admin/reviews?${new URLSearchParams({ ...(data.status ? { status: data.status } : {}), ...(offset ? { offset: String(offset) } : {}) }).toString()}`.replace(/\?$/, '');
</script>

<PageShell
	title="Reviews"
	description="See where each entry under review stands."
	width="wide"
>
	{#snippet actions()}
		<Badge tone="violet" size="sm">Beta</Badge>
	{/snippet}

	<ReviewTabs active="assignments" operator={data.operator} />

	<section class="flex flex-col gap-4" aria-label="Assignments">
		<SectionHeading level={2}>Assignments</SectionHeading>
		<ListToolbar label="Filter assignments">
			{#snippet filters()}
				<FilterChips label="Status" value={data.status} options={statusOptions} />
			{/snippet}
		</ListToolbar>
		{#if !data.assignments.ok && data.assignments.gate.state === 'forbidden'}
			<!-- The rules decide this, not the role, so the notice names them. -->
			<Alert tone="warn" title="You cannot see reviews">
				Your roles have no read permission on <span class="font-mono">reviews</span>.
			</Alert>
		{:else if !data.assignments.ok}
			<GateNotice
				gate={data.assignments.gate}
				title="Review assignments"
				absent="Review assignments are not included in this build."
			/>
		{:else if assignmentRows.length === 0}
			<EmptyState
				title="Nothing under review"
				description={data.status
					? 'No assignments have this status. Choose another status to see the rest.'
					: 'Entries appear here when you start a review from the entry editor.'}
			>
				{#snippet iconSnippet()}<ClipboardCheck size={ICON.lg} />{/snippet}
			</EmptyState>
		{:else}
			{#if !data.entriesNamed}
				<p class="text-xs text-muted">
					Entries, definitions and stages are shown by ID, because only an administrator can see their names.
				</p>
			{/if}
			{#if data.operator && !data.definitions.ok}
				<p class="text-xs text-warn">{couldNotLoad('the definition and stage names', { reload: true })}</p>
			{/if}
			<Table label="Review assignments">
				<thead>
					<tr>
						<th scope="col">Entry</th>
						<th scope="col">Definition</th>
						<th scope="col">Stage</th>
						<th scope="col">Status</th>
						<th scope="col">Assignee</th>
						<th scope="col">Due</th>
					</tr>
				</thead>
				<tbody>
					{#each assignmentRows as a (a.id)}
						{@const href = entryHref(a.definition_id, a.entry_id)}
						{@const late = overdue(a)}
						<tr data-testid="assignment-row" data-status={a.status}>
							<td data-cell="nowrap" class={a.entry_id in data.entries ? '' : 'font-mono text-xs'}>
								{#if href}
									<a {href} class="text-brand underline-offset-2 hover:underline">{entryName(a.entry_id)}</a>
								{:else}
									{entryName(a.entry_id)}
								{/if}
							</td>
							<td data-cell="nowrap">{definitionName(a.definition_id)}</td>
							<td data-cell="nowrap">
								{stageName(a.definition_id, a.current_stage_id)}
								{#if a.required_approvals > 1}
									<Badge tone="neutral" size="sm">
										{a.approvals.length} of {a.required_approvals} approvals
									</Badge>
								{/if}
							</td>
							<td data-cell="nowrap">
								<Badge tone={STATUS_TONE[a.status]} dot>{STATUS_LABEL[a.status]}</Badge>
							</td>
							<td data-cell="nowrap" class={a.assignee_id in data.people ? '' : 'font-mono text-xs'}>
								{personName(a.assignee_id)}
								{#if a.assignee_ids.length > 1}
									<span class="font-sans text-muted">and {a.assignee_ids.length - 1} more</span>
								{/if}
							</td>
							<td data-cell="nowrap" class={late ? 'text-danger' : ''} data-overdue={late}>
								{a.due_at ? formatDateTime(a.due_at) : NO_VALUE}
								{#if late}
									<Badge tone="danger" size="sm">Overdue</Badge>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
			<Pagination
				page={pageNumber(data.offset, data.limit)}
				perPage={data.limit}
				count={assignmentRows.length}
				total={data.total}
				noun="assignments"
				href={(page) => pageHref(pageOffset(page, data.limit))}
			/>
		{/if}
	</section>
</PageShell>
