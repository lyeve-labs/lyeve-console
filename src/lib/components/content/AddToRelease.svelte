<script lang="ts">
	/**
	 * Puts the entry into a release that has not gone out yet. The list holds
	 * the releases the page read, and the write is the entry page's own form
	 * action, so a refusal comes back to this card.
	 */
	import { Alert, Button, Card, SectionHeading, SegmentedControl, Select } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { submitter } from '$lib/forms.svelte';
	import type { Release } from '$lib/api/content-releases';
	import type { Refusal } from '$lib/api/refusal';
	import { couldNotLoad } from '$lib/outage';

	interface Props {
		releases: Pick<Release, 'id' | 'name' | 'status'>[];
		/** Releases this entry is already in, by id. */
		holding: string[];
		error?: string;
		refused?: Refusal | null;
		added?: boolean;
		/** The releases could not be read, so the card has none to offer. */
		failed?: boolean;
	}

	let { releases, holding, error = undefined, refused = null, added = false, failed = false }: Props = $props();

	const options = $derived(releases.map((r) => ({ value: r.id, label: `${r.name} (${r.status})` })));
	// svelte-ignore state_referenced_locally
	let target = $state(releases[0]?.id ?? '');
	let action = $state<'publish' | 'unpublish'>('publish');
	const ACTIONS: { value: 'publish' | 'unpublish'; label: string }[] = [
		{ value: 'publish', label: 'Publish it' },
		{ value: 'unpublish', label: 'Unpublish it' },
	];
	const add = submitter();
</script>

<Card>
	{#snippet header()}
		<SectionHeading level={3}>Release</SectionHeading>
	{/snippet}
	<div class="flex flex-col gap-3" data-testid="add-to-release">
		{#if refused}
			<RefusalNotice refusal={refused} />
		{:else if error}
			<Alert tone="danger">{error}</Alert>
		{:else if added}
			<Alert tone="success" autoDismiss>Added to the release.</Alert>
		{/if}
		{#if holding.length > 0}
			<p class="text-sm text-muted">
				In {holding.length === 1 ? 'a release' : `${holding.length} releases`}:
				{#each releases.filter((r) => holding.includes(r.id)) as r, i (r.id)}
					{i > 0 ? ', ' : ''}<a class="text-brand" href="/admin/releases/{r.id}">{r.name}</a>
				{/each}
			</p>
		{/if}
		{#if failed}
			<p class="text-sm text-muted">{couldNotLoad('releases', { reload: true })}</p>
		{:else if options.length === 0}
			<p class="text-sm text-muted">
				No release is open for changes. <a class="text-brand" href="/admin/releases">Create one</a> to publish this entry with others.
			</p>
		{:else}
			<form method="POST" action="?/addToRelease" use:enhance={add.enhance} class="flex flex-col gap-3">
				<Select id="entry-release" name="release_id" label="Release" searchable {options} value={target} onvaluechange={(v) => (target = v)} />
				<SegmentedControl name="action" label="When it goes out" options={ACTIONS} bind:value={action} />
				<div class="flex justify-end">
					<Button variant="secondary" size="sm" type="submit" disabled={!target} loading={add.pending}>Add to release</Button>
				</div>
			</form>
		{/if}
	</div>
</Card>
