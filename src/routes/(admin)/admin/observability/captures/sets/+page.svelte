<script lang="ts">
	import CaptureTabs from '$lib/components/CaptureTabs.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		Alert,
		Badge,
		Button,
		PageShell,
		SectionHeading,
		Table,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { CONFIRM_FIELD, CONFIRMED } from '$lib/confirmation';
	import { confirmed } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Play, Trash2 } from '@lucide/svelte';
	import { diffChanged, type ReplaySet, type SetReplay } from '$lib/api/request-capture';
	import { formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const refusal = $derived(formRefusal(form));
	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const needsWrites = $derived((form as { needsWrites?: string } | null)?.needsWrites ?? '');
	const replay = $derived((form as { replay?: SetReplay } | null)?.replay ?? null);
	const replayedSet = $derived(replay ? data.sets.find((s) => s.id === replay.set_id) : undefined);

	function remove(what: string, detail: string): SubmitFunction {
		return confirmed(
			`Delete ${what}?`,
			detail,
			{ confirmLabel: 'Delete', success: `${what} deleted.` },
		);
	}

	/**
	 * A replay sends each request again with the caller's own credentials in
	 * place of the redacted ones, so the confirm says that before it runs.
	 */
	function runSet(s: ReplaySet, writes: boolean): SubmitFunction {
		return async ({ cancel, formData }) => {
			const ok = await confirmDialog(
				writes ? `Replay ${s.name}, writes included?` : `Replay ${s.name}?`,
				writes
					? 'Every request in the set runs again with your credentials, and each write is repeated.'
					: 'Every request in the set runs again against this engine with your credentials in place of the ones that were redacted.',
				{ confirmLabel: 'Replay' },
			);
			if (!ok) {
				cancel();
				return;
			}
			formData.set(CONFIRM_FIELD, CONFIRMED);
			return async ({ update }) => {
				await update({ reset: false });
			};
		};
	}
</script>

<PageShell
	title="Request capture"
	documentTitle="Replay sets - Request capture"
	description="Replay a saved set of requests and compare the answers."
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	<CaptureTabs active="sets" sets={data.setsRead ? data.sets.length : undefined} />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Request capture"
			absent="Request capture is not included in this build."
		/>
	{:else}
		{#if refusal}
			<RefusalNotice {refusal} />
		{:else if needsWrites}
			{@const s = data.sets.find((x) => x.id === needsWrites)}
			<Alert tone="warn" title="This set includes a write">
				<p>Replaying it repeats each write against this engine. Nothing in the set has run yet.</p>
				{#if s}
					<form method="POST" action="?/replaySet" class="mt-3" use:enhance={runSet(s, true)}>
						<input type="hidden" name="id" value={s.id} />
						<input type="hidden" name="confirm_mutating" value="true" />
						<Button variant="secondary" size="sm" type="submit">Replay including writes</Button>
					</form>
				{/if}
			</Alert>
		{:else if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}

		{#if data.licensed === false}
			<Alert tone="brand" title="Capture rules and replay sets are not included">
				Without them, every request is kept for a day and you replay requests one at a time. Creating or enabling a
				rule, or saving a replay set, needs a license that includes them. Saved rules and sets keep working, and you
				can always switch a rule off or delete it.
			</Alert>
		{/if}

		<section class="flex flex-col gap-4" aria-label="Replay sets">
			<SectionHeading level={2}>Replay sets</SectionHeading>
			{#if !data.setsRead}
				{#if data.setsGate}
					<GateNotice gate={data.setsGate} title="the replay sets" absent="Replay sets need a newer version of the request capture plugin." />
				{:else}
					<Alert tone="danger">Could not load replay sets. Reload the page to try again.</Alert>
				{/if}
			{:else if data.sets.length === 0}
				<p class="text-sm text-muted">
					No replay sets yet. Select captures on the
					<a href="/admin/observability/captures" class="text-brand hover:underline">Captures</a> tab and save them
					as a set to replay them together and compare each response with the original.
				</p>
			{:else}
				<Table label="Replay sets">
					<thead>
						<tr>
							<th scope="col">Set</th>
							<th scope="col">Captures</th>
							<th scope="col">Created</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.sets as s (s.id)}
							<tr>
								<td class="font-medium text-fg">{s.name}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{s.capture_ids.length}</td>
								<td data-cell="nowrap" class="text-xs text-faint">{formatDateTime(s.created_at)}</td>
								<td data-cell="nowrap">
									<div class="flex items-center justify-end gap-1">
										<form method="POST" action="?/replaySet" use:enhance={runSet(s, false)}>
											<input type="hidden" name="id" value={s.id} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Replay {s.name}" title="Replay">
												<Play size={ICON.sm} />
											</Button>
										</form>
										<form
											method="POST"
											action="?/deleteSet"
											use:enhance={remove(s.name, 'Its captures are kept. Only the set is deleted.')}
										>
											<input type="hidden" name="id" value={s.id} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Delete {s.name}">
												<Trash2 size={ICON.sm} class="text-danger" />
											</Button>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}

			{#if replay}
				<div class="flex flex-col gap-3" data-testid="replay-results">
					<SectionHeading level={3}>Replayed {replayedSet?.name ?? 'the set'}</SectionHeading>
					<p class="text-sm text-muted">
						{replay.results.filter((r) => r.diff && !diffChanged(r.diff)).length} of {replay.results.length} returned
						the same response as when captured.
					</p>
					{#each replay.results as r (r.capture_id)}
						<div class="rounded border border-line bg-surface-2 p-3">
							<div class="flex flex-wrap items-center gap-2">
								<!-- An expired capture comes back with no method or path, so
								     its id is all there is to name it by. -->
								{#if r.method && r.path}
									<span class="font-mono text-xs text-fg">{r.method} {r.path}</span>
								{:else}
									<span class="font-mono text-xs text-faint">{r.capture_id}</span>
								{/if}
								{#if r.error}
									<Badge tone="danger">Not replayed</Badge>
								{:else if r.diff}
									<Badge tone={diffChanged(r.diff) ? 'warn' : 'success'} dot>
										{diffChanged(r.diff) ? 'Changed' : 'Same'}
									</Badge>
								{/if}
							</div>
							{#if r.error}
								<p class="mt-1 text-xs text-muted">{r.error}</p>
							{:else if r.diff}
								<p class="mt-1 font-mono text-xs text-muted">
									Status {r.diff.status_code1} then {r.diff.status_code2}, {Math.round(r.diff.duration1_ms)} ms then
									{Math.round(r.diff.duration2_ms)} ms
								</p>
								{#if r.diff.headers_diff}
									<pre class="mt-2 overflow-x-auto font-mono text-xs text-muted">{r.diff.headers_diff}</pre>
								{/if}
								{#if r.diff.body_diff}
									<pre class="mt-2 overflow-x-auto font-mono text-xs text-muted">{r.diff.body_diff}</pre>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</PageShell>
