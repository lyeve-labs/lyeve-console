<script lang="ts">
	import {
		Alert,
		Autocomplete,
		Badge,
		Button,
		Card,
		CopyButton,
		EmptyState,
		Input,
		PageShell,
		SectionHeading,
		Stat,
		Table,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { RefreshCw, Sparkles, UserSearch } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import {
		hasUsers,
		score,
		sourceLabel,
		sourceTone,
		splitIsSkewed,
		type FeedEntry,
		INTEGRATION_EXAMPLE,
	} from '$lib/api/recommendations';
	import { formatMillis, formatPercent, plural } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The accounts the preview can run for, searchable by email. Picking one
	// fills the id field, which is what the form posts, so an account past the
	// first page is reachable by pasting its id there.
	const readerOptions = $derived(
		(data.readers.ok ? data.readers.value : []).map((r) => ({ value: r.id, label: r.email, keywords: [r.id] }))
	);

	// The recompute and the preview report through the one `form`. A failed
	// preview shows in its own form, beside the id that caused it, and a failed
	// recompute shows at the top of the page.
	const failure = $derived(form as { action?: string; error?: string } | null);
	const formError = $derived(failure?.action === 'preview' ? '' : (failure?.error ?? ''));
	const previewError = $derived(failure?.action === 'preview' ? (failure.error ?? '') : '');
	const outcome = $derived(
		form as { refreshed?: boolean; pairs?: number; trending?: number; feeds?: number; ms?: number } | null,
	);
	const preview = $derived(
		(form as { previewFor?: string; feed?: FeedEntry[] } | null)?.feed ?? null,
	);
	const previewId = $derived((form as { previewFor?: string } | null)?.previewFor ?? '');
	const previewFor = $derived((data.readers.ok ? data.readers.value : []).find((r) => r.id === previewId)?.email ?? previewId);

	const stats = $derived(data.stats);
	const skewed = $derived(splitIsSkewed(stats));

	let userId = $state('');
	let recomputing = $state(false);

	// The recompute rebuilds everything and takes minutes on a large corpus,
	// so the button has to stay busy for the whole of it rather than look idle
	// and invite a second press.
	const recompute: SubmitFunction = () => {
		recomputing = true;
		return async ({ update }) => {
			await update();
			recomputing = false;
		};
	};
</script>

<PageShell
	title="Recommendations"
	description="See the similar entries, trending entries and personal feeds computed from what your readers do."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#snippet actions()}
		{#if data.gate.state === 'ok' && data.canRecompute}
			<form method="POST" action="?/refresh" use:enhance={recompute}>
				<Button variant="secondary" size="sm" type="submit" loading={recomputing}>
					<RefreshCw size={ICON.sm} /> Recompute
				</Button>
			</form>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Recommendations"
			absent="Recommendations are not included in this build."
		/>
	{:else}
		{#if formError}
			<!-- A recompute already under way is its own outcome, not a fault,
			     so it is shown as information rather than in red. -->
			<Alert tone={formError.includes('already running') ? 'warn' : 'danger'}>{formError}</Alert>
		{/if}

		{#if outcome?.refreshed}
			<Alert tone="success" autoDismiss>
				Recomputed in {formatMillis(outcome.ms)}: {outcome.pairs} similarity pairs, {outcome.trending}
				trending items and {outcome.feeds} feeds.
			</Alert>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Trending now</SectionHeading>
			{#if !data.trending.ok}
				<GateNotice
					gate={data.trending.gate}
					title="Trending entries"
					absent="The trending list needs a newer version of the recommendations plugin."
				/>
			{:else if data.trending.value.length === 0}
				<EmptyState
					title="No trending entries yet"
					description="An entry trends once readers have been tracked on it and a recompute has run."
				/>
			{:else}
				<Table label="Trending now">
					<thead>
						<tr>
							<th scope="col">Entry</th>
							<th scope="col">Score</th>
							<th scope="col">Views</th>
						</tr>
					</thead>
					<tbody>
						{#each data.trending.value as item (item.content_id)}
							<tr>
								<td>
									<span class="text-sm text-fg">{item.title || item.slug || item.content_id}</span>
									{#if item.slug}<span class="block font-mono text-xs text-faint">{item.slug}</span>{/if}
								</td>
								<td data-cell="nowrap" class="font-mono text-xs">{item.score.toFixed(1)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{item.view_count}</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>What one reader would see</SectionHeading>
			{#if !data.canRecompute}
				<Alert tone="brand">
					Only a super admin can generate a feed for a named reader, because it shows what that person has been doing.
				</Alert>
			{:else}
				<p class="text-xs text-muted">
					Generate the feed for one reader now. It runs the same computation the reader gets, so you see exactly what they would be shown.
					{#if !data.readers.ok}
						Could not load the accounts. Enter the user id from the Users page.
					{:else if readerOptions.length > 0}
						Find a reader by email to fill in their id, or paste the id of any account from the Users
						page.
					{:else}
						Enter the user id from the Users page.
					{/if}
				</p>
				<!-- The combobox posts the label it shows, an email, so it only
				     fills the id field and the id field is what the form posts.
				     The guidance sits in the paragraph above rather than under the
				     id field, because a hint there would make the field taller
				     than the button and align the button with the hint instead of
				     the input. -->
				<form method="POST" action="?/preview" use:enhance class="flex flex-col gap-3" id="rec-preview-form">
					<FormErrors message={previewError || undefined} />
					{#if readerOptions.length > 0}
						<div class="w-full min-w-0 sm:w-80">
							<Autocomplete
								id="rec-reader"
								label="Find a reader"
								placeholder="Search by email"
								options={readerOptions}
								value={userId}
								onchange={(v) => {
									if (v) userId = v;
								}}
							/>
						</div>
					{/if}
					<div class="flex flex-wrap items-end gap-2">
						<div class="w-full min-w-0 sm:w-80">
							<Input id="rec-user" name="user_id" label="User id" bind:value={userId} />
						</div>
						<Button variant="secondary" type="submit">
							<UserSearch size={ICON.sm} /> Generate
						</Button>
					</div>
				</form>

				{#if preview !== null}
					{#if preview.length === 0}
						<EmptyState
							title="No recommendations for this reader"
							description="Either they have read nothing yet, or no content is similar enough to rank."
						>
							{#snippet iconSnippet()}
								<Sparkles size={ICON.lg} />
							{/snippet}
						</EmptyState>
					{:else}
						<p class="text-xs text-muted">
							{preview.length} {plural(preview.length, 'entry', 'entries')} for {previewFor}.
						</p>
						<Table label="What one reader would see">
							<thead>
								<tr>
									<th scope="col">Content</th>
									<th scope="col">Why</th>
									<th scope="col">Score</th>
								</tr>
							</thead>
							<tbody>
								{#each preview as entry (entry.id)}
									<tr>
										<td data-cell="nowrap" class="font-mono text-xs">{entry.content_id}</td>
										<td data-cell="nowrap">
											<!-- A random pick is the control arm, not a broken
											     recommendation, so it is marked apart. -->
											<Badge tone={sourceTone(entry.source)}>{sourceLabel(entry.source)}</Badge>
										</td>
										<td data-cell="nowrap" class="font-mono text-xs">{score(entry.score)}</td>
									</tr>
								{/each}
							</tbody>
						</Table>
					{/if}
				{/if}
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>The split</SectionHeading>
			{#if !hasUsers(stats)}
				<!-- Nobody has been bucketed yet, which on a fresh install is
				     correct. Drawing it as an even split of zero people would read
				     as a working experiment. -->
				<EmptyState
					title="No readers assigned yet"
					description="A reader is assigned to a group the first time a request signed in as them asks for their group. Generating a feed above assigns no one."
				>
					{#snippet iconSnippet()}
						<Sparkles size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else if stats}
				<div class="grid gap-4 sm:grid-cols-3">
					<Stat size="sm" mono label="Readers assigned" value={stats.total_users} />
					<Stat size="sm" mono label="Getting recommendations" value={formatPercent(stats.recommendation_pct / 100)} />
					<Stat size="sm" mono label="Control arm, random" value={formatPercent(stats.random_pct / 100)} />
				</div>
				<p class="text-xs text-muted">
					{stats.recommendation_count} readers see computed recommendations and
					{stats.random_count} see random picks, which is what the computed ones are measured
					against.
				</p>
				<!-- The banner sits under the tiles rather than between them, so the
				     row of three numbers stays whole. -->
				{#if skewed}
					<Alert tone="warn">
						The two arms are far apart. Either the control arm is too small to measure against, or many readers are being shown random content.
					</Alert>
				{/if}
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Wire it into your application</SectionHeading>
			<p class="text-sm text-muted">
				Send the reader's token or an API key with every call. The tenant comes from that token or key.
			</p>
			<div class="flex flex-col gap-2">
				<div class="flex justify-end"><CopyButton value={INTEGRATION_EXAMPLE} label="Copy the calls" /></div>
				<pre class="overflow-auto rounded border border-line bg-surface-2 p-3 font-mono text-xs">{INTEGRATION_EXAMPLE}</pre>
			</div>
		</section>

		<Card>
			<div class="flex flex-col gap-3 text-sm text-muted">
				<SectionHeading level={2}>What recommendations do</SectionHeading>
				<p>
					Your application tells the engine what each reader does: views, likes, bookmarks and shares,
					weighted 1, 2, 5 and 3. From that, each reader gets:
				</p>
				<ul class="flex list-disc flex-col gap-1 ps-5">
					<li>More like the entry they are on: entries the same people read over the last 30 days.</li>
					<li>What is trending: the entries with the most activity this week.</li>
					<li>A feed of their own: what readers who liked the same entries read next.</li>
				</ul>
				<p>
					Readers are split between the recommended feed and a random baseline, so the split above
					shows whether recommending changes what people read.
				</p>
				<p>
					The lists are not live. New activity counts only after a super admin recomputes them. There is no schedule yet, so recompute after a batch of activity, or from a cron job that calls
					<span class="font-mono text-xs">POST /api/admin/recommendations/refresh</span>.
				</p>
			</div>
		</Card>
	{/if}
</PageShell>
