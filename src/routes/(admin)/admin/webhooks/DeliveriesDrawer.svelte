<script lang="ts">
	import { Badge, Button, Drawer, EmptyState, Table } from '@lyeve-labs/ui-kit';
	import type { WebhookDelivery } from '@lyeve-labs/client';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { CheckCircle, XCircle, History, RotateCcw } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import type { Section } from '$lib/api/gate';
	import { formRefusal, refusalText, type Refusal } from '$lib/api/refusal';
	import { formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';
	import { eventTone } from '$lib/tones';

	interface Props {
		/** The page's one action result, which carries each retry. */
		form: Record<string, unknown> | null | undefined;
		/** The history of the webhook the address names, as the load read it. */
		deliveries: { id: string; limit: number; read: Section<WebhookDelivery[]> } | null;
		/** That webhook's name, for the title. */
		name: string;
		/** The license refusal a paid write met, which holds the retry. */
		held?: Refusal | null;
	}

	let { form, deliveries, name, held = null }: Props = $props();

	// A failed retry shows here, beside the row that asked, not behind the panel.
	const failure = $derived(form?.action === 'retry-delivery' ? (form as { error?: string }) : null);

	// Closing takes the webhook out of the address, or the next load would
	// open its history again.
	function close() {
		const next = new URL(page.url);
		next.searchParams.delete('deliveries');
		void goto(`${next.pathname}${next.search}`, { noScroll: true, keepFocus: true });
	}

	let retryResults = $state<Record<string, { success: boolean; message: string }>>({});

	// The map is read untracked: an effect that tracks the map it rewrites
	// reruns on its own write until Svelte stops it.
	$effect(() => {
		if (form && 'retryResult' in form && form.retryResult) {
			const r = form.retryResult as { delivery_id: string; success: boolean; message: string };
			retryResults = { ...untrack(() => retryResults), [r.delivery_id]: { success: r.success, message: r.message } };
		}
	});
</script>

{#if deliveries}
	{@const items = deliveries.read.ok ? deliveries.read.value : []}
	<Drawer open title="Delivery history for {name}" size="xl" onclose={close}>
	{#snippet children()}
			<FormErrors message={failure?.error || undefined} refused={formRefusal(failure)} />
			{#if held}
				<p class="mb-2 text-xs text-muted" data-testid="retry-held">{refusalText(held)}</p>
			{/if}
			{#if !deliveries.read.ok}
				<GateNotice gate={deliveries.read.gate} title="Delivery history" absent="This webhook no longer exists." />
			{:else if items.length === 0}
				<EmptyState
					title="No deliveries yet"
					description="Every attempt this webhook makes is listed here."
				>
					{#snippet iconSnippet()}<History size={ICON.lg} />{/snippet}
				</EmptyState>
			{:else}
				<!-- The plugin answers the newest attempts up to the limit asked and
				     offers no offset, so a full page says the older ones are not listed. -->
				{#if items.length >= deliveries.limit}
					<p class="mb-2 text-xs text-muted">Showing the newest {deliveries.limit} attempts. Older attempts are stored but not shown here.</p>
				{/if}
				<Table label="Delivery history">
					<thead>
						<tr>
							<th scope="col">Time</th>
							<th scope="col">Event</th>
							<th scope="col">Content type</th>
							<th scope="col">Status</th>
							<th scope="col">Duration</th>
							<th scope="col">Result</th>
							<th scope="col">Retry</th>
						</tr>
					</thead>
					<tbody>
						{#each items as d (d.id)}
							<tr>
								<td class="font-mono text-xs whitespace-nowrap text-muted">
									{formatDateTime(d.attempted_at)}
								</td>
								<td><Badge tone={eventTone(d.event_type)}>{d.event_type}</Badge></td>
								<td data-cell="nowrap">{d.schema_name}</td>
								<td data-cell="nowrap" class="font-mono text-xs">
									{#if d.status_code != null}
										<span class={d.success ? 'text-success' : 'text-danger'}>{d.status_code}</span>
									{:else}
										<span class="text-faint">No response</span>
									{/if}
								</td>
								<td data-cell="nowrap" class="text-xs text-muted">
									{d.duration_ms != null ? `${d.duration_ms}ms` : 'Not recorded'}
								</td>
								<td data-cell="nowrap">
									{#if d.success}
										<span class="flex items-center gap-1 text-xs text-success">
											<CheckCircle size={ICON.xs} /> OK
										</span>
									{:else if d.error}
										<span class="flex items-center gap-1 text-xs text-danger" title={d.error}>
											<XCircle size={ICON.xs} />
											{d.error.slice(0, 40)}
										</span>
									{:else}
										<span class="flex items-center gap-1 text-xs text-danger">
											<XCircle size={ICON.xs} /> Failed
										</span>
									{/if}
								</td>
								<td>
									{#if !d.success}
										<form method="POST" action="?/retry-delivery" use:enhance>
											<input type="hidden" name="id" value={deliveries.id} />
											<input type="hidden" name="delivery_id" value={d.id} />
											<Button
												variant="ghost"
												size="sm"
												type="submit"
												disabled={held !== null}
												title="Retry this delivery"
												aria-label="Retry the delivery attempted at {formatDateTime(
													d.attempted_at
												)}"
											>
												<RotateCcw size={ICON.sm} />
											</Button>
										</form>
									{/if}
									<!-- The plugin answers a retry under the failed delivery's own id,
									     so the result shows under that row's button, which stays for
									     another try. -->
									{#if retryResults[d.id]}
										{@const rr = retryResults[d.id]}
										<span class="text-xs {rr.success ? 'text-success' : 'text-danger'}">
											{rr.message.slice(0, 30)}
										</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		{/snippet}
		{#snippet footer()}
			<Button variant="secondary" type="button" onclick={close}>
				Close
			</Button>
		{/snippet}
	</Drawer>
{/if}
