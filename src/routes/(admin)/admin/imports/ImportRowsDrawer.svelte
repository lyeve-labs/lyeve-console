<script lang="ts">
	import { Button, DescriptionList, Drawer, SectionHeading, Table } from '@lyeve-labs/ui-kit';
	import { Download } from '@lucide/svelte';
	import GateNotice from '#lib/components/GateNotice.svelte';
	import { OUTCOME_LABELS, outcome, rejectedHref } from '#lib/api/bulk-import.ts';
	import { formatCount } from '#lib/format.ts';
	import { ICON } from '#lib/icon.ts';
	import type { PageData } from './$types';

	/**
	 * The rows of one import: its counts, the rows it rejected with their
	 * reasons, and the rows it skipped.
	 *
	 * The job lives in the address, so the page owns closing it. The drawer
	 * calls back and the page drops the job from the query.
	 */
	let {
		open = $bindable(false),
		detail: read,
		onclose,
	}: {
		open?: boolean;
		/** The job the address names, or null when it names none. */
		detail: PageData['detail'];
		onclose: () => void;
	} = $props();

	const detail = $derived(read?.ok ? read.value : null);

	const detailItems = $derived(
		detail
			? [
					{ term: 'Content type', value: detail.job.content_type },
					{
						term: 'Source',
						value: `${detail.job.source_kind === 'url' ? 'Web address' : 'Upload'}, ${detail.job.source_format}`,
					},
					{
						term: 'When an entry exists',
						value: detail.job.mode === 'upsert' ? 'Update it' : 'Leave it alone',
					},
					{
						term: 'Key field',
						value: detail.job.upsert_key === 'entry.slug' ? 'Entry slug' : detail.job.upsert_key || 'None',
					},
					{ term: 'Created', value: formatCount(detail.job.inserted_rows) },
					{ term: 'Updated', value: formatCount(detail.job.updated_rows) },
					{ term: 'Skipped', value: formatCount(detail.job.skipped_rows) },
					{ term: 'Rejected', value: formatCount(detail.job.errored_rows) },
				]
			: [],
	);
</script>

<Drawer
	bind:open
	title={detail ? `Import of ${detail.job.source_name}` : 'Import'}
	description={detail ? OUTCOME_LABELS[outcome(detail.job)] : ''}
	{onclose}
>
	{#if read && !read.ok}
		<GateNotice
			gate={read.gate}
			title="this import"
			absent="This import no longer exists. Reload the page."
		/>
	{:else if detail}
		<div class="flex flex-col gap-5">
			<DescriptionList items={detailItems} />
			<div class="flex flex-col gap-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<SectionHeading level={3}>Rejected rows</SectionHeading>
					{#if detail.rejectedTotal > 0}
						<Button variant="secondary" size="sm" href={rejectedHref(detail.job.id)}>
							<Download size={ICON.sm} /> Download all {formatCount(detail.rejectedTotal)} as CSV
						</Button>
					{/if}
				</div>
				{#if detail.rejected.length === 0}
					<p class="text-sm text-muted">No row was rejected.</p>
				{:else}
					<Table label="Rejected rows of this import">
						<thead>
							<tr>
								<th scope="col">Row</th>
								<th scope="col">Why</th>
							</tr>
						</thead>
						<tbody>
							{#each detail.rejected as r (r.id)}
								<tr>
									<td data-cell="nowrap" class="font-mono text-xs">{r.row_index + 1}</td>
									<td class="text-xs">
										{r.error_message || r.error_code}
										{#if r.error_code}<span class="text-faint"> ({r.error_code})</span>{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</Table>
					{#if detail.rejectedTotal > detail.rejected.length}
						<p class="text-xs text-muted">
							Showing the first {formatCount(detail.rejected.length)} of {formatCount(detail.rejectedTotal)}.
							Download all to see every row.
						</p>
					{/if}
				{/if}
			</div>
			{#if detail.skipped.length > 0}
				<div class="flex flex-col gap-3">
					<SectionHeading level={3}>Skipped rows</SectionHeading>
					<Table label="Skipped rows of this import">
						<thead>
							<tr>
								<th scope="col">Row</th>
								<th scope="col">Why</th>
							</tr>
						</thead>
						<tbody>
							{#each detail.skipped as r (r.id)}
								<tr>
									<td data-cell="nowrap" class="font-mono text-xs">{r.row_index + 1}</td>
									<td class="text-xs">{r.error_message || 'Skipped'}</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				</div>
			{/if}
		</div>
	{/if}
	{#snippet footer()}
		<Button variant="secondary" onclick={onclose}>Close</Button>
	{/snippet}
</Drawer>
