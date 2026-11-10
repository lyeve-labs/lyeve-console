<script lang="ts">
	import { Badge, Button, EmptyState, Input, PageShell, Pagination, Select, Table } from '@lyeve-labs/ui-kit';
	import { ChevronRight, MessagesSquare, Search } from '@lucide/svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import type { PageData } from './$types';
	import AiSection from '$lib/components/ai/AiSection.svelte';
	import { useCaseLabel } from '$lib/components/ai/use-case';
	import { TRANSCRIPT_KINDS } from '$lib/api/ai';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';
	import { liveFilter } from '$lib/live-filter.svelte';

	let { data }: { data: PageData } = $props();

	const kindOptions = [{ value: '', label: 'Any kind' }, ...TRANSCRIPT_KINDS.map((k) => ({ value: k, label: k.replace('_', ' ') }))];
	const live = liveFilter(() => data.subjectId ?? '', { name: 'subject_id' });
	const filtered = $derived(!!(data.kind || data.subjectKind || data.subjectId));
	const filterParams = $derived({
		...(data.kind ? { kind: data.kind } : {}),
		...(data.subjectKind ? { subject_kind: data.subjectKind } : {}),
		...(data.subjectId ? { subject_id: data.subjectId } : {}),
	});
</script>

<PageShell
	title="AI transcripts"
	description="Review every AI request from routes, flow nodes, the editor assistant and other plugins, with the prompt and the reply."
	width="wide"
>
	<AiSection level={2} tab="transcripts" gate={data.gate} layoutGate={data.aiLayoutGate} noun="transcripts">
		{#if !data.aiSettings?.transcripts_enabled}
			<p class="text-xs text-warn" role="status">
				Transcript storage is off for this tenant. New requests are not recorded.
				<a href="/admin/ai/settings" class="underline">Turn it on in settings.</a>
			</p>
		{/if}

		<!-- A GET form: the filters live in the URL so a page can be shared and the
		     pager keeps them. -->
		<form method="GET" {@attach live.form}>
			<ListToolbar label="Filter transcripts">
				{#snippet search()}
					<div class="flex items-center gap-2">
						<label for="f-subject-id" class="sr-only">Subject id</label>
						<Input
							id="f-subject-id"
							name="subject_id"
							bind:value={live.value}
							oninput={(e) => live.input(e.currentTarget.value)}
							placeholder="Flow or entry id"
							class="min-w-0 flex-1"
						/>
						<Button variant="secondary" type="submit">
							<Search size={ICON.sm} aria-hidden="true" /> Filter
						</Button>
					</div>
				{/snippet}
				{#snippet filters()}
					<label for="f-kind" class="sr-only">Kind</label>
					<Select id="f-kind" name="kind" options={kindOptions} value={data.kind} class="w-40" />
					<label for="f-subject-kind" class="sr-only">Subject kind</label>
					<Input id="f-subject-kind" name="subject_kind" value={data.subjectKind} placeholder="Subject kind" class="w-36" />
				{/snippet}
			</ListToolbar>
		</form>

		{#if data.transcripts.length === 0}
			<EmptyState
				level={2}
				title={filtered ? 'No transcripts match' : 'No transcripts yet'}
				description={filtered
					? 'No transcripts match these filters.'
					: 'Each AI request is recorded here once a provider is set up and transcript storage is on.'}
			>
				{#snippet iconSnippet()}
					<MessagesSquare size={ICON.lg} />
				{/snippet}
				{#snippet action()}
					{#if filtered}
						<Button variant="secondary" href="/admin/ai/transcripts">Clear filters</Button>
					{/if}
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Transcripts">
				<thead>
					<tr>
						<th scope="col">Use case</th>
						<th scope="col">Kind</th>
						<th scope="col">Caller</th>
						<th scope="col">Model</th>
						<th scope="col">Messages</th>
						<th scope="col">Time</th>
						<th scope="col" class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.transcripts as t (t.id)}
						<tr>
							<td data-cell="nowrap" class="font-medium">
								{t.prompt_use_case ? useCaseLabel(t.prompt_use_case) : 'none'}
								<span class="block text-xs text-faint">prompt v{t.prompt_version}{t.recap ? ', recapped' : ''}</span>
							</td>
							<td><Badge tone="neutral" size="sm">{t.kind.replace('_', ' ')}</Badge></td>
							<td data-cell="nowrap" class="text-muted">
								{t.caller || t.created_by || 'unknown'}
								{#if t.subject_kind}<span class="block text-xs text-faint">{t.subject_kind} {t.subject_id}</span>{/if}
							</td>
							<td data-cell="nowrap" class="text-muted">{t.model || 'none'}</td>
							<td data-cell="nowrap" class="text-muted">{t.message_count}</td>
							<td data-cell="nowrap" class="text-muted">{formatDateTime(t.created_at)}</td>
							<td class="text-right">
								<Button href="/admin/ai/transcripts/{t.id}" variant="ghost" size="sm">
									Open <ChevronRight size={ICON.sm} aria-hidden="true" />
								</Button>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
			<Pagination
				page={pageNumber(data.offset, data.limit)}
				perPage={data.limit}
				count={data.transcripts.length}
				total={data.total ?? undefined}
				hasNext={data.hasMore}
				noun="transcripts"
				href={pageHref('/admin/ai/transcripts', data.limit, filterParams)}
			/>
		{/if}
	</AiSection>
</PageShell>
