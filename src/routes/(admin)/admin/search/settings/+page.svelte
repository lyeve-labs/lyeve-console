<script lang="ts">
	import {
		Alert,
		Button,
		Card,
		CopyField,
		EmptyState,
		MultiSelect,
		NumberInput,
		PageShell,
		SectionHeading,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageData, ActionData } from './$types';
	import { Database } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import SearchTabs from '$lib/components/SearchTabs.svelte';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let publicChoice = $state<string[]>([]);
	$effect.pre(() => {
		publicChoice = data.publicSchemas.ok ? [...data.publicSchemas.value] : [];
	});
	const savePublic: SubmitFunction = () => async ({ update }) => {
		await update({ reset: false });
	};
</script>

<PageShell
	title="Search"
	documentTitle="Settings - Search"
	description="Choose what anyone may search on your site, tune how results rank and rebuild the index."
	width="wide"
>
	<SearchTabs active="settings" />

	<div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
		<Card pad="sm">
			{#snippet header()}
				<SectionHeading level={2}>Public search</SectionHeading>
			{/snippet}
			{#if !data.publicSchemas.ok}
				<GateNotice gate={data.publicSchemas.gate} title="Public search" absent="Public search is not included in this build." />
			{:else if !data.schemas.ok}
				<GateNotice gate={data.schemas.gate} title="The content types" absent="The content type list is not included in this build." />
			{:else if data.schemas.value.length === 0}
				<EmptyState title="No content types yet" description="Build a content type, then choose here whether anyone may search it.">
					{#snippet iconSnippet()}<Database size={ICON.lg} />{/snippet}
					{#snippet action()}
						<Button variant="secondary" href="/admin/schema">Go to the schema builder</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<form method="POST" action="?/publicSchemas" class="flex flex-col gap-3" use:enhance={savePublic}>
					{#if form?.publicError}
						<Alert tone="danger">{form.publicError}</Alert>
					{:else if form && 'publicSaved' in form}
						<Alert tone="success" autoDismiss>Saved.</Alert>
					{/if}
					<!-- A searchable picker rather than a box per schema, which grows
					     into a wall past a dozen. The picks travel as one field each. -->
					<MultiSelect
						id="public-schemas"
						label="Searchable by anyone"
						hint="Anyone can search the published entries of a chosen content type on your site's own host, without credentials, and see the title, slug, tags and a snippet. A query matches every field, and the snippet can quote any of them, so choose only content types whose fields can all be public."
						placeholder="Choose content types"
						searchable
						options={data.schemas.value.map((n) => ({ value: n, label: n }))}
						bind:value={publicChoice}
					/>
					{#each publicChoice as name (name)}
						<input type="hidden" name="schemas" value={name} />
					{/each}
					{#if publicChoice.length > 0}
						<CopyField label="Example GET request" value={`/api/v1/search/${publicChoice[0]}?q=kettle`} copyLabel="Copy the request" wrap />
					{/if}
					<div><Button variant="primary" size="sm" type="submit">Save</Button></div>
				</form>
			{/if}
		</Card>

		<Card pad="sm">
			{#snippet header()}
				<SectionHeading level={2}>Ranking weights</SectionHeading>
			{/snippet}
			<!-- A failed read offers no Save: the boxes would hold weights nobody
			     read, and saving them would overwrite the real ones. -->
			{#if !data.ranking.ok}
				<GateNotice gate={data.ranking.gate} title="Ranking weights" absent="Ranking weights are not included in this build." />
			{:else}
				{@const ranking = data.ranking.value}
				<form method="POST" action="?/ranking" class="flex flex-col gap-3" use:enhance>
					{#if form?.rankingError}
						<Alert tone="danger">{form.rankingError}</Alert>
					{:else if form && 'rankingSaved' in form}
						<Alert tone="success" autoDismiss>Saved.</Alert>
					{/if}
					<p class="text-xs text-muted">Set how much a match in each field counts. These weights apply to every content type without its own.</p>
					<NumberInput id="w-title" name="title_weight" label="Title" min={0} max={10} step={0.1} value={ranking.title_weight} />
					<NumberInput id="w-body" name="body_weight" label="Body" min={0} max={10} step={0.1} value={ranking.body_weight} />
					<NumberInput id="w-tag" name="tag_weight" label="Tags" min={0} max={10} step={0.1} value={ranking.tag_weight} />
					<div><Button variant="primary" size="sm" type="submit">Save</Button></div>
				</form>
			{/if}
		</Card>

		{#if data.canReindex}
			<Card pad="sm">
				{#snippet header()}
					<SectionHeading level={2}>Index</SectionHeading>
				{/snippet}
				<form method="POST" action="?/reindex" class="flex flex-col gap-3" use:enhance>
					{#if form?.reindexError}
						<Alert tone="danger">{form.reindexError}</Alert>
					{:else if form && 'reindexed' in form}
						<Alert tone="success" autoDismiss>{form.reindexMessage || `Rebuilt ${form.reindexed} entries.`}</Alert>
					{/if}
					<p class="text-xs text-muted">Rebuild the index from every entry. Entries are indexed when they are saved, so you only need this after data changed outside the engine.</p>
					<div><Button variant="secondary" size="sm" type="submit">Rebuild index</Button></div>
				</form>
			</Card>
		{/if}
	</div>
</PageShell>
