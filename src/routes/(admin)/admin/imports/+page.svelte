<script lang="ts">
	import {
		Badge,
		Button,
		Card,
		EmptyState,
		PageShell,
		Pagination,
		Progress,
		SectionHeading,
		Spinner,
		Stat,
		Table,
		toast,
	} from '@lyeve-labs/ui-kit';
	import RefreshButton from '$lib/components/RefreshButton.svelte';
	import { enhance } from '$app/forms';
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Ban, Download, FileText, Link, ListChecks, Plus, Undo2, Upload } from '@lucide/svelte';
	import ImportWizard from '$lib/components/ImportWizard.svelte';
	import ImportTabs from '$lib/components/ImportTabs.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { confirmed } from '$lib/forms.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import {
		OUTCOME_LABELS,
		cancelable,
		outcome,
		outcomeTone,
		progress,
		rejectedHref,
		rejectionRate,
		rollbackable,
		type ImportJob,
	} from '$lib/api/bulk-import';
	import { NO_VALUE, formatCount, formatDateTime, plural } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';
	import ImportRowsDrawer from './ImportRowsDrawer.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/** How often the history re-reads while an import is still going. */
	const POLL_MS = 2000;

	// A failed cancel or rollback is reported above the history.
	const formError = $derived(form && 'error' in form ? String(form.error ?? '') : '');
	const refusal = $derived(formRefusal(form));
	// Null while the content types are unread, so each place that offers one
	// says why it offers none.
	const schemaList = $derived(data.schemas.ok ? data.schemas.value : null);
	const running = $derived(data.jobs.filter(cancelable));
	const rejecting = $derived(data.jobs.filter((j) => outcome(j) === 'partial' || outcome(j) === 'nothing'));

	// An import runs on the server. The history re-reads until none is left
	// running and then stops asking.
	$effect(() => {
		if (running.length === 0) return;
		const id = setInterval(() => void invalidate('app:imports'), POLL_MS);
		return () => clearInterval(id);
	});

	let wizardOpen = $state(false);
	async function started(job: ImportJob) {
		toast.success(`Import of ${job.source_name} started`);
		await invalidate('app:imports');
	}

	function detailHref(id: string): string {
		const q = new URLSearchParams(page.url.searchParams);
		q.set('job', id);
		return `?${q}`;
	}
	let detailOpen = $state(false);
	$effect(() => {
		detailOpen = data.detail !== null;
	});
	function closeDetail() {
		const q = new URLSearchParams(page.url.searchParams);
		q.delete('job');
		void goto(`?${q}`, { replaceState: true, noScroll: true, keepFocus: true });
	}

	function cancel(j: ImportJob): SubmitFunction {
		return confirmed(
			`Cancel the import of ${j.source_name}?`,
			'The import stops where it is. Rows it already wrote stay, and canceling does not undo them.',
			{ confirmLabel: 'Cancel import', success: 'Import canceled' },
		);
	}

	function rollback(j: ImportJob): SubmitFunction {
		return confirmed(
			`Roll back the import of ${j.source_name}?`,
			`The ${formatCount(j.inserted_rows)} ${plural(j.inserted_rows, 'entry it created is deleted, with any edits made to it', 'entries it created are deleted, with any edits made to them')} since. Entries it updated keep the imported values. The history of the import stays.`,
			{ confirmLabel: 'Roll back', success: 'Import rolled back' },
		);
	}
</script>

<PageShell
	title="Imports"
	description="Bring content in from a file or another engine, and see what each import wrote and rejected."
	width="wide"
>
	{#snippet actions()}
		<RefreshButton dependency="app:imports" />
		{#if data.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={() => (wizardOpen = true)}>
				<Plus size={ICON.sm} /> New import
			</Button>
		{/if}
	{/snippet}

	<FormErrors message={formError} refused={refusal} />

	<ImportTabs active="history" />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Imports"
			absent="Imports are not included in this build."
		/>
	{:else}

		<div class="grid gap-4 lg:grid-cols-[3fr_2fr]">
			<Card>
				<div class="flex flex-col gap-3">
					<SectionHeading level={2}>How an import works</SectionHeading>
					<p class="text-sm text-muted">
						An import reads a file, matches its columns to the fields of one content type and saves each
						row as an entry. These are ordinary entries with their history, which you can edit in the
						content screens and export.
					</p>
					<p class="text-sm text-muted">
						A dry run comes first. It checks every row against the content type, reports which rows would be
						rejected and why, and writes nothing. A key field, such as the slug, matches a row to an entry
						that already exists. Create only leaves that entry alone, and create and update overwrites it.
					</p>
					<p class="text-sm text-muted">
						Every import stays in the history below with its counts. The rows it rejected can be downloaded
						with their reasons, fixed and imported again, and the entries it created can be rolled back.
					</p>
				</div>
			</Card>
			<Card>
				<div class="flex flex-col gap-3">
					<SectionHeading level={2}>Sources</SectionHeading>
					<ul class="flex flex-col gap-3">
						<li class="flex gap-3">
							<Upload size={ICON.md} class="mt-0.5 shrink-0 text-brand" />
							<div>
								<div class="text-sm text-fg">File upload</div>
								<div class="text-xs text-muted">
									CSV with a header row, an Excel workbook (XLSX), JSON, NDJSON or YAML, up to 50 MB.
								</div>
							</div>
						</li>
						<li class="flex gap-3">
							<Link size={ICON.md} class="mt-0.5 shrink-0 text-brand" />
							<div>
								<div class="text-sm text-fg">Web address</div>
								<div class="text-xs text-muted">
									An http or https link. Private and internal addresses are not allowed.
								</div>
							</div>
						</li>
						<li class="flex gap-3">
							<FileText size={ICON.md} class="mt-0.5 shrink-0 text-brand" />
							<div>
								<div class="text-sm text-fg">Another LyEve engine</div>
								<div class="text-xs text-muted">
									Import its data export in JSON, NDJSON, YAML or CSV as it is, from a file or the signed
									download link. Entries keep their slug, title and status.
								</div>
							</div>
						</li>
					</ul>
				</div>
			</Card>
		</div>

		<div class="grid gap-4 sm:grid-cols-3">
			<Stat size="sm" mono label="Imports" value={formatCount(data.total ?? data.jobs.length)} />
			<Stat size="sm" mono label="Running" value={formatCount(running.length)} />
			<!-- A job completes having skipped every row it could not parse, so
			     the status alone says nothing about whether the content arrived. -->
			<Stat
				size="sm"
				mono
				label="Finished with rows rejected"
				value={formatCount(rejecting.length)}
				tone={rejecting.length > 0 ? 'warn' : 'neutral'}
			/>
		</div>

		<section class="flex flex-col gap-4">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<SectionHeading level={2}>History</SectionHeading>
				{#if running.length > 0}
					<p class="flex items-center gap-2 text-xs text-muted" role="status">
						<Spinner size={ICON.xs} />
						{running.length === 1 ? 'One import is running.' : `${running.length} imports are running.`}
						The history updates until every import finishes.
					</p>
				{/if}
			</div>

			{#if data.jobs.length === 0}
				<EmptyState
					title="No imports yet"
					description="Each import appears here with what it wrote and what it rejected."
				>
					{#snippet iconSnippet()}
						<Upload size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						<Button variant="secondary" onclick={() => (wizardOpen = true)}><Plus size={ICON.sm} /> New import</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Imports">
					<thead>
						<tr>
							<th scope="col">Source</th>
							<th scope="col">Outcome</th>
							<th scope="col">Created</th>
							<th scope="col">Updated</th>
							<th scope="col">Skipped</th>
							<th scope="col">Rejected</th>
							<th scope="col" class="text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each data.jobs as j (j.id)}
							<tr>
								<td>
									<div class="flex items-center gap-2">
										<span class="max-w-56 truncate font-medium text-fg" title={j.source_name}
											>{j.source_name || 'Unnamed'}</span
										>
										{#if j.dry_run}
											<!-- A dry run wrote nothing. Reading its counts as
											     content that now exists is the other mistake
											     available on this page. -->
											<Badge tone="brand">Dry run, nothing written</Badge>
										{/if}
									</div>
									<div class="text-xs text-faint">
										{j.content_type} · {j.source_format}{j.source_kind === 'url' ? ' · web address' : ''}
										{#if j.mode === 'upsert'}· create and update{/if}
									</div>
									<div class="text-xs text-faint">{formatDateTime(j.created_at)}</div>
								</td>
								<td class="min-w-48">
									<div class="flex flex-col gap-1">
										<Badge tone={outcomeTone(outcome(j))} dot>{OUTCOME_LABELS[outcome(j)]}</Badge>
										{#if cancelable(j)}
											<Progress
												value={Math.round(progress(j) * 100)}
												size="sm"
												label="{formatCount(j.processed_rows)} of {formatCount(j.total_rows)} rows"
												animated={j.total_rows === 0}
											/>
										{/if}
										{#if j.error_message}
											<div class="max-w-xs truncate text-xs text-danger" title={j.error_message}>
												{j.error_message}
											</div>
										{/if}
									</div>
								</td>
								<td data-cell="nowrap" class="font-mono text-xs">{j.dry_run ? NO_VALUE : formatCount(j.inserted_rows)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{j.dry_run ? NO_VALUE : formatCount(j.updated_rows)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{formatCount(j.skipped_rows)}</td>
								<td data-cell="nowrap">
									<span class="font-mono text-xs">{formatCount(j.errored_rows)}</span>
									{#if rejectionRate(j) !== null && j.errored_rows > 0}
										<div class="text-xs text-faint">
											{rejectionRate(j)}% of the {formatCount(j.processed_rows)}
											{plural(j.processed_rows, 'row')} read
										</div>
									{/if}
								</td>
								<td data-cell="nowrap">
									<div class="flex items-center justify-end gap-1">
										<Button
											variant="ghost"
											size="sm"
											href={detailHref(j.id)}
											aria-label="Rows of the import of {j.source_name}"
										>
											<ListChecks size={ICON.sm} />
										</Button>
										{#if j.errored_rows > 0}
											<Button
												variant="ghost"
												size="sm"
												href={rejectedHref(j.id)}
												aria-label="Download the rows rejected from {j.source_name}"
											>
												<Download size={ICON.sm} />
											</Button>
										{/if}
										{#if cancelable(j)}
											<form method="POST" action="?/cancel" use:enhance={cancel(j)}>
												<input type="hidden" name="id" value={j.id} />
												<Button variant="ghost" size="sm" type="submit" aria-label="Cancel the import of {j.source_name}">
													<Ban size={ICON.sm} />
												</Button>
											</form>
										{/if}
										{#if rollbackable(j)}
											<form method="POST" action="?/rollback" use:enhance={rollback(j)}>
												<input type="hidden" name="id" value={j.id} />
												<Button variant="ghost" size="sm" type="submit" aria-label="Roll back the import of {j.source_name}">
													<Undo2 size={ICON.sm} class="text-danger" />
												</Button>
											</form>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.jobs.length}
					total={data.total ?? undefined}
					hasNext={data.hasMore}
					noun="imports"
					href={pageHref('/admin/imports', data.limit)}
				/>
			{/if}
		</section>
	{/if}
</PageShell>

<ImportWizard
	bind:open={wizardOpen}
	schemas={schemaList}
	templates={data.templates}
	templatesFailed={data.templatesFailed}
	licensed={data.licensed}
	onstarted={started}
/>

<ImportRowsDrawer bind:open={detailOpen} detail={data.detail} onclose={closeDetail} />
