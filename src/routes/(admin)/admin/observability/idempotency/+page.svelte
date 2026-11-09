<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		EmptyState,
		PageShell,
		SectionHeading,
		Stat,
		Table,
		Pagination,
		SearchInput,
		SegmentedControl,
	} from '@lyeve-labs/ui-kit';
	import { confirmed } from '$lib/forms.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { KeyRound, Search, Unlock } from '@lucide/svelte';
	import {
		ABANDONED_AFTER_SECONDS,
		abandoned,
		ageLabel,
		ageSeconds,
		keyLabel,
		keyTone,
		replaysServed,
		type IdempotencyKey,
	} from '$lib/api/idempotency';
	import { formatDateTime, plural } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const orphans = $derived(abandoned(data.keys));
	const replays = $derived(replaysServed(data.keys));

	// The plugin offers no filter of its own, so these narrow the rows on
	// screen and say so.
	let narrow = $state('');
	let showing = $state<'all' | 'open' | 'stored'>('all');
	const visible = $derived(
		data.keys.filter((k) => {
			if (showing === 'open' && k.completed) return false;
			if (showing === 'stored' && !k.completed) return false;
			const term = narrow.trim().toLowerCase();
			return !term || `${k.key} ${k.method} ${k.path}`.toLowerCase().includes(term);
		}),
	);

	/**
	 * Releasing a key is the repair for one whose process died mid-write, and
	 * the wrong thing to do to a request that is genuinely still running: the
	 * write would then happen twice, which is what the key exists to prevent.
	 */
	function release(k: IdempotencyKey): SubmitFunction {
		return confirmed(
			`Release the key ${k.key}?`,
			'The next request with this key runs again. If the original request is still running, the write happens twice.',
			{ confirmLabel: 'Release', success: 'Key released' },
		);
	}
</script>

<PageShell
	title="Idempotency"
	description="See the idempotency keys in use and the responses stored for them."
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Idempotency"
			absent="Idempotency is not included in this build. Requests sent twice run twice."
		/>
	{:else}
		{#if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}

		{#if data.statsRead && data.stats}
			<div class="grid gap-4 sm:grid-cols-3">
				<Stat size="sm" mono label="Keys held" value={data.stats.total} />
				<Stat size="sm" mono label="With a stored response" value={data.stats.completed} />
				<Stat
					size="sm"
					mono
					label="In flight"
					value={data.stats.in_flight}
					tone={data.stats.in_flight > 0 ? 'warn' : 'neutral'}
				/>
			</div>
			<p class="text-xs text-muted">
				{replays} repeated requests on this page got the stored response instead of running
				again.
			</p>
		{:else if !data.statsRead}
			{#if data.statsGate}
				<GateNotice level={2} gate={data.statsGate} title="the counters" absent="The counters need a newer version of the idempotency plugin." />
			{:else}
				<Alert tone="danger">
					Could not load the counters. Reload the page to try again.
				</Alert>
			{/if}
		{/if}

		{#if orphans.length > 0}
			<!-- A key is recorded before the handler finishes. One still open
			     minutes later is a process that died mid-write, and it refuses
			     every retry of that key until it expires. -->
			<Alert tone="danger">
				{orphans.length}
				{plural(orphans.length, 'key has', 'keys have')} been open for more than
				{ABANDONED_AFTER_SECONDS} seconds, longer than any request takes. Every retry with one of
				these keys is refused until the key expires, so the caller sees a write that was accepted
				but never happened. Release a key to let its next request run.
			</Alert>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Keys</SectionHeading>
			{#if data.keys.length === 0}
				<EmptyState
					title="No idempotency keys yet"
					description="Keys appear here when a client sends one."
				>
					{#snippet iconSnippet()}
						<KeyRound size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<ListToolbar label="Filter keys">
					{#snippet search()}
						<label for="key-narrow" class="sr-only">Search this page</label>
						<SearchInput id="key-narrow" bind:value={narrow} placeholder="Key, method or path on this page" />
					{/snippet}
					{#snippet filters()}
						<SegmentedControl
							label="Show"
							labelHidden
							size="sm"
							bind:value={showing}
							options={[
								{ value: 'all', label: 'All' },
								{ value: 'open', label: 'Not finished' },
								{ value: 'stored', label: 'Stored' },
							]}
						/>
					{/snippet}
				</ListToolbar>
				{#if visible.length === 0}
					<EmptyState title="No keys on this page match these filters" description="Clear the filter to see the rest.">
						{#snippet iconSnippet()}
							<Search size={ICON.lg} />
						{/snippet}
						{#snippet action()}
							<Button variant="secondary" onclick={() => { narrow = ''; showing = 'all'; }}>Clear the filter</Button>
						{/snippet}
					</EmptyState>
				{:else}
					<Table label="Keys">
						<thead>
							<tr>
								<th scope="col">Key</th>
								<th scope="col">Request</th>
								<th scope="col">State</th>
								<th scope="col">Replays</th>
								<th scope="col">Age</th>
								<th scope="col"><span class="sr-only">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{#each visible as k (k.key)}
								<tr>
									<td class="max-w-xs truncate font-mono text-xs" title={k.key}>{k.key}</td>
									<td data-cell="nowrap" class="font-mono text-xs text-faint">
										{k.method}
										{k.path}
									</td>
									<td data-cell="nowrap">
										<Badge tone={keyTone(k)} dot>{keyLabel(k)}</Badge>
									</td>
									<td data-cell="nowrap" class="font-mono text-xs">{k.replay_count}</td>
									<td data-cell="nowrap" class="text-xs text-faint" title={formatDateTime(k.created_at)}>
										{ageLabel(ageSeconds(k))}
									</td>
									<td data-cell="nowrap">
										<div class="flex justify-end">
											{#if !k.completed}
												<form method="POST" action="?/release" use:enhance={release(k)}>
													<input type="hidden" name="key" value={k.key} />
													<Button
														variant="ghost"
														size="sm"
														type="submit"
														aria-label="Release the key {k.key}"
														title="Let the next request with this key run again"
													>
														<Unlock size={ICON.sm} />
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
						count={data.keys.length}
						total={data.total ?? undefined}
						hasNext={data.hasMore}
						noun="keys"
						href={pageHref('/admin/observability/idempotency', data.limit)}
					/>
				{/if}
			{/if}
		</section>
	{/if}
</PageShell>
