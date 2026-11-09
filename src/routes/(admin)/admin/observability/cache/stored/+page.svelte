<script lang="ts">
	import { Alert, Button, EmptyState, PageShell, SectionHeading, Table, Pagination } from '@lyeve-labs/ui-kit';
	import CacheTabs from '$lib/components/CacheTabs.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { enhance } from '$app/forms';
	import { confirmed } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Database, Trash2 } from '@lucide/svelte';
	import { tagsOf } from '$lib/api/cache';
	import { formatBytes, formatDateTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const tags = $derived(tagsOf(data.entries));
	const refusal = $derived(formRefusal(form));

	const RECOMPUTED =
		'Each flushed key is computed again on its next request, which adds that load to the database immediately.';

	/**
	 * Every flushed key is recomputed on its next request, so this is a
	 * deliberate load against the database rather than a tidy-up. The plugin
	 * flushes only the request's tenant when the request names one, so the
	 * confirm says which of the two this flush is.
	 */
	function flushAll(): SubmitFunction {
		if (data.flushScoped) {
			return confirmed(
				"Flush this tenant's cached responses?",
				`Other tenants' entries and keys outside the response cache are kept. ${RECOMPUTED}`,
				{ confirmLabel: 'Flush', success: 'Cache flushed for this tenant.' },
			);
		}
		return confirmed(
			'Flush the cache?',
			`Your session is not scoped to a tenant. On an engine with many tenants, this removes every key of every tenant. On an engine with one tenant, it removes that tenant's cached responses. ${RECOMPUTED}`,
			{ confirmLabel: 'Flush', success: 'Cache flushed.' },
		);
	}

	function flushTag(tag: string): SubmitFunction {
		return confirmed(
			`Flush everything tagged ${tag}?`,
			`Every entry with this tag is removed, for every tenant. ${RECOMPUTED}`,
			{ confirmLabel: 'Flush', success: `Entries tagged ${tag} flushed.` },
		);
	}
</script>

<PageShell
	title="Cache"
	documentTitle="Stored - Cache"
	description="See what the cache holds and flush it."
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	<CacheTabs active="stored" stored={data.total ?? undefined} />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Cache"
			absent="The cache is not included in this build."
		/>
	{:else}
		<FormErrors message={formError} refused={refusal} />

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Stored</SectionHeading>
			<div class="flex flex-wrap items-center gap-2">
				<form method="POST" action="?/flush" use:enhance={flushAll()}>
					<Button variant="secondary" size="sm" type="submit">
						<Trash2 size={ICON.sm} />
						{data.flushScoped ? "Flush this tenant's responses" : 'Flush the cache'}
					</Button>
				</form>
				{#if data.superAdmin}
					{#each tags as tag (tag)}
						<form method="POST" action="?/flush" use:enhance={flushTag(tag)}>
							<input type="hidden" name="tag" value={tag} />
							<Button variant="ghost" size="sm" type="submit">Flush {tag}</Button>
						</form>
					{/each}
				{/if}
			</div>

			{#if !data.superAdmin}
				<p class="text-sm text-muted">
					Only super admins can see stored keys, because the store has every tenant's keys.
				</p>
			{:else if data.entriesGate}
				<GateNotice
					gate={data.entriesGate}
					title="the stored entries"
					absent="Stored entries need a newer version of the cache plugin."
				/>
			{:else if data.unlisted}
				<Alert tone="brand">
					This cache provider cannot list its entries. The counters on the Overview tab still
					include them.
				</Alert>
			{:else if data.entries.length === 0}
				<EmptyState
					title="No cached entries yet"
					description="Entries appear here after the first cached request."
				>
					{#snippet iconSnippet()}
						<Database size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				{#if data.flushScoped}
					<p class="text-xs text-faint">Only this tenant's keys are listed. The counters on the Overview tab include every tenant.</p>
				{/if}
				<Table label="Stored">
					<thead>
						<tr>
							<th scope="col">Key</th>
							<th scope="col">Size</th>
							<th scope="col">Tags</th>
							<th scope="col">Expires</th>
						</tr>
					</thead>
					<tbody>
						{#each data.entries as e (e.key)}
							<tr>
								<td class="max-w-md truncate font-mono text-xs" title={e.key}>{e.key}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{formatBytes(e.size, 'GB')}</td>
								<td data-cell="nowrap" class="text-xs text-faint">
									{(e.tags ?? []).join(', ') || '-'}
								</td>
								<td data-cell="nowrap" class="text-xs text-faint">
									{formatDateTime(e.expires_at)}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.entries.length}
					total={data.total ?? undefined}
					hasNext={data.hasMore}
					noun="entries"
					href={pageHref('/admin/observability/cache/stored', data.limit)}
				/>
			{/if}
		</section>
	{/if}
</PageShell>
