<script lang="ts">
	import { Badge, Button, Drawer, EmptyState, Pagination, Table, confirm } from '@lyeve-labs/ui-kit';
	import type { DeadLetter } from '@lyeve-labs/client';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { CONFIRM_FIELD, CONFIRMED } from '$lib/confirmation';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { RotateCcw, Skull, Trash2, XCircle } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import type { Section } from '$lib/api/gate';
	import { formRefusal, refusalText, type Refusal } from '$lib/api/refusal';
	import { pageNumber } from '$lib/api/list';
	import { formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';
	import { eventTone } from '$lib/tones';

	interface Props {
		/** The page's one action result, which carries each replay or dismissal. */
		form: Record<string, unknown> | null | undefined;
		/** The page of the queue the address opens, as the load read it. */
		deadLetters: { offset: number; limit: number; read: Section<{ rows: DeadLetter[]; total: number | null }> } | null;
		/** The license refusal a paid write met, which holds replay and dismissal. */
		held?: Refusal | null;
	}

	let { form, deadLetters, held = null }: Props = $props();

	/** The queue's own writes, whose failures this drawer draws. */
	const OWN_ACTIONS = ['dead-letter-replay', 'dead-letter-dismiss', 'dead-letter-delete'];

	// A delete takes its row out at once, and the next load reads the queue again.
	let deadLetterItems = $derived(deadLetters?.read.ok ? deadLetters.read.value.rows : []);
	const deadLetterTotal = $derived(deadLetters?.read.ok ? deadLetters.read.value.total : null);

	const failure = $derived(
		form && OWN_ACTIONS.includes(String(form.action ?? '')) ? (form as { error?: string }) : null,
	);

	/** What a row's last replay or dismissal came to. `done` means it left the queue. */
	type Outcome = { text: string; done: boolean };
	let deadLetterResults = $state<Record<string, Outcome>>({});

	/**
	 * The plugin marks an entry replayed only when the receiver answers 2xx,
	 * and reports the receiver's code beside a status that always reads
	 * "replayed", so the code is what says whether it was delivered.
	 */
	function replayOutcome(code: unknown): Outcome {
		if (typeof code !== 'number') return { text: 'Replayed. The receiver sent no status.', done: false };
		if (code >= 200 && code < 300) return { text: `Delivered (HTTP ${code})`, done: true };
		return { text: `The receiver returned HTTP ${code}. The entry is still pending.`, done: false };
	}

	// The map is read untracked: an effect that tracks the map it rewrites
	// reruns on its own write until Svelte stops it.
	$effect(() => {
		if (form && 'deadLetterReplay' in form && form.deadLetterReplay) {
			const r = form.deadLetterReplay as { id: string; http_status?: unknown };
			deadLetterResults = { ...untrack(() => deadLetterResults), [r.id]: replayOutcome(r.http_status) };
		}
		if (form && 'deadLetterDismiss' in form && form.deadLetterDismiss) {
			const r = form.deadLetterDismiss as { id: string };
			deadLetterResults = { ...untrack(() => deadLetterResults), [r.id]: { text: 'Dismissed', done: true } };
		}
	});

	/** Deleting drops the delivery for good, so it asks first and names it. */
	function deletePermanently(dl: DeadLetter): SubmitFunction {
		return async ({ cancel, formData }) => {
			const ok = await confirm(
				`Delete the dead letter from ${dl.webhook_name}?`,
				`The ${dl.event_type} delivery that died at ${formatDateTime(dl.dead_at)} is deleted permanently. It cannot be replayed.`,
				{ confirmLabel: 'Delete' },
			);
			if (!ok) {
				cancel();
				return;
			}
			formData.set(CONFIRM_FIELD, CONFIRMED);
			return async ({ result, update }) => {
				if (result.type === 'success') {
					deadLetterItems = deadLetterItems.filter((x) => x.id !== dl.id);
				}
				await update({ reset: false });
			};
		};
	}

	/** The address of a page of the queue. */
	function pageHref(offset: number): string {
		const next = new URL(page.url);
		next.searchParams.set('dead', '1');
		if (offset > 0) next.searchParams.set('dead_offset', String(offset));
		else next.searchParams.delete('dead_offset');
		return `${next.pathname}${next.search}`;
	}

	// Closing takes the queue out of the address, or the next load would open
	// it again.
	function close() {
		const next = new URL(page.url);
		next.searchParams.delete('dead');
		next.searchParams.delete('dead_offset');
		void goto(`${next.pathname}${next.search}`, { noScroll: true, keepFocus: true });
	}
</script>

{#if deadLetters}
	{@const { offset, limit } = deadLetters}
	<Drawer open title="Dead letter queue" size="xl" onclose={close}>
	{#snippet children()}
			<FormErrors message={failure?.error || undefined} refused={formRefusal(failure)} />
			{#if !deadLetters.read.ok}
				<GateNotice gate={deadLetters.read.gate} title="Dead letter queue" absent="The dead letter queue is not included in this build." />
			{:else if deadLetterItems.length === 0}
				<EmptyState
					title="No dead letters"
					description="Deliveries that fail after every retry appear here."
				>
					{#snippet iconSnippet()}<Skull size={ICON.lg} />{/snippet}
				</EmptyState>
			{:else}
				{#if held}
					<p class="mb-2 text-xs text-muted" data-testid="replay-held">
						{refusalText(held)} You can still delete entries.
					</p>
				{/if}
				<Table label="Dead letters">
					<thead>
						<tr>
							<th scope="col">Webhook</th>
							<th scope="col">Event</th>
							<th scope="col">Content type</th>
							<th scope="col">Attempts</th>
							<th scope="col">Last error</th>
							<th scope="col">Status</th>
							<th scope="col">Dead at</th>
							<th scope="col">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each deadLetterItems as dl (dl.id)}
							{@const outcome = deadLetterResults[dl.id]}
							<tr>
								<td data-cell="nowrap" class="text-xs font-medium text-fg">{dl.webhook_name}</td>
								<td><Badge tone={eventTone(dl.event_type)}>{dl.event_type}</Badge></td>
								<td data-cell="nowrap" class="text-xs">{dl.schema_name}</td>
								<td data-cell="nowrap" class="font-mono text-xs text-muted">{dl.total_attempts}</td>
								<td class="max-w-48 truncate text-xs text-muted" title={dl.last_error ?? ''}>
									{dl.last_error ? dl.last_error.slice(0, 60) : 'None'}
								</td>
								<td>
									{#if dl.status === 'pending'}
										<Badge tone="warn">{dl.status}</Badge>
									{:else if dl.status === 'replayed'}
										<Badge tone="success">{dl.status}</Badge>
									{:else}
										<Badge tone="neutral">{dl.status}</Badge>
									{/if}
								</td>
								<td class="font-mono text-xs whitespace-nowrap text-muted">
									{formatDateTime(dl.dead_at)}
								</td>
								<td>
									{#if outcome}
										<span class="text-xs text-muted" data-testid="dead-letter-outcome">{outcome.text}</span>
									{/if}
									{#if dl.status === 'pending' && !outcome?.done}
										<div class="flex items-center gap-1">
											<form method="POST" action="?/dead-letter-replay" use:enhance>
												<input type="hidden" name="id" value={dl.id} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													title="Replay"
													disabled={held !== null}
													aria-label="Replay the dead letter from {dl.webhook_name}"
												>
													<RotateCcw size={ICON.sm} />
												</Button>
											</form>
											<form method="POST" action="?/dead-letter-dismiss" use:enhance>
												<input type="hidden" name="id" value={dl.id} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													title="Dismiss"
													disabled={held !== null}
													aria-label="Dismiss the dead letter from {dl.webhook_name}"
												>
													<XCircle size={ICON.sm} />
												</Button>
											</form>
											<form method="POST" action="?/dead-letter-delete" use:enhance={deletePermanently(dl)}>
												<input type="hidden" name="id" value={dl.id} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													title="Delete permanently"
													aria-label="Delete the dead letter from {dl.webhook_name} permanently"
												>
													<Trash2 size={ICON.sm} class="text-danger" />
												</Button>
											</form>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(offset, limit)}
					perPage={limit}
					count={deadLetterItems.length}
					total={deadLetterTotal ?? undefined}
					hasNext={deadLetterTotal === null && deadLetterItems.length === limit}
					noun="entries"
					href={(p) => pageHref((p - 1) * limit)}
				/>
			{/if}
		{/snippet}
		{#snippet footer()}
			<Button variant="secondary" type="button" onclick={close}>
				Close
			</Button>
		{/snippet}
	</Drawer>
{/if}
