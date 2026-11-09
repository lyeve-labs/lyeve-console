<script lang="ts">
	/**
	 * Editorial threads on one entry: start a thread, reply, mention people,
	 * resolve and reopen. Every write is a form action on the entry page, so
	 * this component only renders what the page read and posts its forms.
	 *
	 * The engine may refuse a write with 402, which the panel renders as a
	 * notice.
	 */
	import { Alert, Badge, Button, Card, EmptyState, MultiSelect, SectionHeading, SegmentedControl, Textarea } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { CheckCircle2, MessageSquare, RotateCcw } from '@lucide/svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { submitter } from '$lib/forms.svelte';
	import type { EntryComment } from '$lib/api/content-comments';
	import type { Refusal } from '$lib/api/refusal';
	import { formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';
	import { couldNotLoad } from '$lib/outage';

	interface Person {
		id: string;
		email: string;
	}

	interface Props {
		threads: EntryComment[];
		/** Accounts the directory names, so an author reads by email. */
		people: Person[];
		/** Accounts a comment can mention. Empty when the caller may not list them. */
		mentionable: Person[];
		/** The thread read failed. Never drawn as an empty list. */
		unavailable?: boolean;
		error?: string;
		refused?: Refusal | null;
	}

	let { threads, people, mentionable, unavailable = false, error = undefined, refused = null }: Props = $props();

	let view = $state<'open' | 'resolved' | 'all'>('open');
	const VIEWS = [
		{ value: 'open', label: 'Open' },
		{ value: 'resolved', label: 'Resolved' },
		{ value: 'all', label: 'All' },
	];
	const shown = $derived(threads.filter((t) => view === 'all' || (view === 'resolved') === t.resolved));
	const openCount = $derived(threads.filter((t) => !t.resolved).length);

	const options = $derived(mentionable.map((p) => ({ value: p.id, label: p.email })));
	const who = (id: string) => people.find((p) => p.id === id)?.email ?? 'Someone';

	let body = $state('');
	let mentions = $state<string[]>([]);
	const start = submitter(() => {
		body = '';
		mentions = [];
	});

	// One reply box open at a time, keyed by the thread it answers.
	let replyTo = $state('');
	let reply = $state('');
	const answer = submitter(() => {
		replyTo = '';
		reply = '';
	});
</script>

{#snippet comment(c: EntryComment)}
	<div class="flex flex-col gap-1">
		<div class="flex flex-wrap items-center gap-2 text-xs text-faint">
			<span class="font-medium text-fg">{who(c.author_id)}</span>
			<span>{formatDateTime(c.created_at)}</span>
		</div>
		<p class="whitespace-pre-wrap text-sm text-fg">{c.body}</p>
		{#if c.mentions?.length}
			<div class="flex flex-wrap gap-1">
				{#each c.mentions as m (m)}
					<Badge tone="neutral">@{who(m)}</Badge>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

<Card>
	{#snippet header()}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<SectionHeading level={3}>Comments{openCount ? ` (${openCount} open)` : ''}</SectionHeading>
			{#if !unavailable && threads.length > 0}
				<SegmentedControl label="Show" labelHidden bind:value={view} options={VIEWS} />
			{/if}
		</div>
	{/snippet}

	<div class="flex flex-col gap-4" data-testid="comments-panel">
		{#if refused}
			<RefusalNotice refusal={refused} />
		{:else if error}
			<Alert tone="danger">{error}</Alert>
		{/if}

		{#if unavailable}
			<Alert tone="warn">{couldNotLoad('comments', { reload: true })}</Alert>
		{:else}
			{#if shown.length === 0}
				<EmptyState
					title={threads.length === 0 ? 'No comments yet' : `No ${view} threads`}
					description={threads.length === 0 ? 'Start a thread to ask a question or leave a note for the next editor.' : 'Switch the view to see the rest.'}
				>
					{#snippet iconSnippet()}<MessageSquare size={ICON.lg} />{/snippet}
				</EmptyState>
			{:else}
				<ul class="flex flex-col divide-y divide-line">
					{#each shown as t (t.id)}
						<li class="flex flex-col gap-3 py-3">
							<div class="flex items-start justify-between gap-3">
								{@render comment(t)}
								<form method="POST" action="?/resolveThread" use:enhance>
									<input type="hidden" name="comment_id" value={t.id} />
									<input type="hidden" name="resolved" value={t.resolved ? 'false' : 'true'} />
									<Button variant="ghost" size="sm" type="submit">
										{#if t.resolved}
											<RotateCcw size={ICON.sm} /> Reopen
										{:else}
											<CheckCircle2 size={ICON.sm} /> Resolve
										{/if}
									</Button>
								</form>
							</div>
							{#if t.replies?.length}
								<ul class="ml-4 flex flex-col gap-3 border-l border-line pl-4">
									{#each t.replies as r (r.id)}
										<li>{@render comment(r)}</li>
									{/each}
								</ul>
							{/if}
							{#if !t.resolved}
								{#if replyTo === t.id}
									<form method="POST" action="?/comment" use:enhance={answer.enhance} class="ml-4 flex flex-col gap-2">
										<input type="hidden" name="parent_id" value={t.id} />
										<Textarea id="reply-{t.id}" name="body" label="Reply" rows={2} bind:value={reply} />
										<div class="flex justify-end gap-2">
											<Button variant="secondary" size="sm" onclick={() => (replyTo = '')}>Cancel</Button>
											<Button variant="primary" size="sm" type="submit" disabled={!reply.trim()} loading={answer.pending}>Reply</Button>
										</div>
									</form>
								{:else}
									<div class="ml-4">
										<Button variant="ghost" size="sm" onclick={() => ((replyTo = t.id), (reply = ''))}>Reply</Button>
									</div>
								{/if}
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			<form method="POST" action="?/comment" use:enhance={start.enhance} class="flex flex-col gap-3">
				{#each mentions as m (m)}
					<input type="hidden" name="mentions" value={m} />
				{/each}
				<Textarea id="comment-body" name="body" label="New thread" rows={3} bind:value={body} />
				{#if options.length > 0}
					<MultiSelect id="comment-mentions" label="Mention" bind:value={mentions} {options} searchable placeholder="Choose people to notify" />
				{/if}
				<div class="flex justify-end">
					<Button variant="primary" size="sm" type="submit" disabled={!body.trim()} loading={start.pending}>Comment</Button>
				</div>
			</form>
		{/if}
	</div>
</Card>
