<script lang="ts">
	import { Alert, Badge, Button, Collapsible, Panel, Skeleton, type StatusTone } from '@lyeve-labs/ui-kit';
	import { formatDateTime } from '$lib/format';
	import type { HistoryEntry } from '../+page.server';
	import type { DdlHistory } from './ddl-history.svelte';

	let { ddl }: { ddl: DdlHistory } = $props();

	const HISTORY_TONE: Record<HistoryEntry['state'], StatusTone> = {
		applied: 'success',
		pending: 'warn',
		failed: 'danger',
		canceled: 'neutral',
	};
	const HISTORY_WORD: Record<HistoryEntry['state'], string> = {
		applied: 'Applied',
		pending: 'Queued',
		failed: 'Failed',
		canceled: 'Canceled',
	};
</script>

<!-- What each save ran against the table, and the drops it queued
     instead of running. The editor's History tab draws it, and the read
     starts when that tab is first chosen. -->
<div class="flex flex-col gap-3" data-testid="schema-history">
	{#if ddl.applyError}
		<Alert tone="danger">{ddl.applyError}</Alert>
	{/if}
	{#if ddl.error}
		<!-- A failed read is not an empty history, and opening the
		     tab again does not read it again, so the retry is here. -->
		<Alert tone="danger" title="Could not load the history">
			{#snippet children()}
				<p>{ddl.error}</p>
				<div class="mt-3">
					<Button variant="secondary" size="sm" loading={ddl.loading} onclick={ddl.load}>Try again</Button>
				</div>
			{/snippet}
		</Alert>
	{/if}
	{#if ddl.loading && !ddl.view && !ddl.error}
		<div class="flex flex-col gap-2" aria-busy="true" data-testid="schema-history-loading">
			<span class="sr-only">Loading history</span>
			<Skeleton height="3.5rem" rounded="rounded-lg" />
			<Skeleton height="3.5rem" rounded="rounded-lg" />
		</div>
	{:else if ddl.view}
		{#if ddl.view.pending > 0}
			<Alert tone="warn" title="{ddl.view.pending} queued {ddl.view.pending === 1 ? 'change' : 'changes'}">
				{#snippet children()}
					<div class="flex flex-wrap items-center justify-between gap-3">
						<span>Saving queued these changes instead of running them. The columns and their data stay in the table until you apply them.</span>
						<Button variant="danger" size="sm" onclick={ddl.applyQueued} loading={ddl.applying}>Apply</Button>
					</div>
				{/snippet}
			</Alert>
		{/if}
		{#if ddl.view.entries.length === 0}
			<p class="text-sm text-muted">No history for this table yet.</p>
		{:else}
			<ol class="flex flex-col gap-2">
				{#each ddl.view.entries as e, i (e.version + ':' + i)}
					<li>
						<Panel pad="sm">
							<div class="flex flex-wrap items-center gap-2">
								<Badge tone={HISTORY_TONE[e.state]} dot>{HISTORY_WORD[e.state]}</Badge>
								<span class="text-sm text-fg">{e.description}</span>
								<span class="ms-auto text-xs text-faint">
									v{e.version} ·
									{formatDateTime(e.canceled_at ?? e.applied_at ?? e.created_at)}
									{#if e.tenant}· tenant {e.tenant}{/if}
									{#if e.applied_by}· {e.applied_by}{/if}
								</span>
							</div>
							<Collapsible label="SQL" class="mt-2">
								<pre class="mt-1 overflow-x-auto rounded bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap text-fg">{e.up_sql}</pre>
								{#if e.down_sql}
									<p class="mt-2 text-xs text-muted">Undo</p>
									<pre class="mt-1 overflow-x-auto rounded bg-surface-2/60 p-3 font-mono text-xs whitespace-pre-wrap text-muted">{e.down_sql}</pre>
								{/if}
							</Collapsible>
						</Panel>
					</li>
				{/each}
			</ol>
			{#if ddl.view.entries.length >= ddl.view.limit}
				<p class="text-xs text-faint">Showing the newest {ddl.view.limit} statements.</p>
			{/if}
		{/if}
	{/if}
</div>
