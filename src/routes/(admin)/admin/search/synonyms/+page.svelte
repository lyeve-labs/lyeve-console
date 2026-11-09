<script lang="ts">
	import { Alert, Button, Card, Drawer, EmptyState, Input, PageShell } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageData, ActionData } from './$types';
	import { ArrowRight, Plus, Shuffle, Trash2 } from '@lucide/svelte';
	import { confirmed } from '$lib/forms.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import SearchTabs from '$lib/components/SearchTabs.svelte';
	import { ICON } from '$lib/icon';
	import { formatCount } from '$lib/format';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const synFields = $derived((form as { fields?: Record<string, string> } | null)?.fields ?? {});
	let synonymOpen = $state(false);
	let baseTerm = $state('');
	let terms = $state('');
	const saveSynonym: SubmitFunction = () => async ({ result, update }) => {
		if (result.type === 'success') {
			synonymOpen = false;
			baseTerm = '';
			terms = '';
		}
		await update({ reset: false });
	};

	function confirmDelete(term: string): SubmitFunction {
		return confirmed(
			`Delete the synonyms of ${term}?`,
			'Searches for it match only the term itself.',
			{ confirmLabel: 'Delete' },
		);
	}
</script>

<PageShell
	title="Search"
	documentTitle="Synonyms - Search"
	description="Let a search for one term also match the others in its group."
	width="wide"
>
	{#snippet actions()}
		{#if data.synonyms.ok}
			<Button variant="primary" size="sm" onclick={() => (synonymOpen = true)}>
				<Plus size={ICON.sm} /> New synonym
			</Button>
		{/if}
	{/snippet}

	{#if form && 'synonymDeleteError' in form && form.synonymDeleteError}
		<Alert tone="danger">{form.synonymDeleteError}</Alert>
	{:else if form?.synonymError && !synonymOpen}
		<Alert tone="danger">{form.synonymError}</Alert>
	{/if}

	<SearchTabs active="synonyms" />

	{#if !data.synonyms.ok}
		<GateNotice level={2} gate={data.synonyms.gate} title="Synonyms" absent="Search synonyms are not included in this build." />
	{:else if data.synonyms.value.groups.length === 0}
		<EmptyState level={2} title="No synonym groups yet" description="A group lets a search for one term also match the others.">
			{#snippet iconSnippet()}<Shuffle size={ICON.lg} />{/snippet}
			{#snippet action()}
				<Button variant="secondary" onclick={() => (synonymOpen = true)}>
					<Plus size={ICON.sm} /> New synonym
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<Card pad="sm">
			{#if data.synonyms.value.total > data.synonyms.value.groups.length}
				<p class="mb-2 text-xs text-muted">
					Showing the first {formatCount(data.synonyms.value.groups.length)} of {formatCount(data.synonyms.value.total)} groups.
				</p>
			{/if}
			<ul class="space-y-2 text-xs">
				{#each data.synonyms.value.groups as group (group.id)}
					<li class="flex items-center gap-1.5">
						<span class="font-medium text-muted">{group.base_term}</span>
						<ArrowRight size={ICON.xs} class="shrink-0 text-faint" />
						<span class="min-w-0 flex-1 text-muted">{group.synonyms.join(', ')}</span>
						<form method="POST" action="?/deleteSynonym" use:enhance={confirmDelete(group.base_term)}>
							<input type="hidden" name="id" value={group.id} />
							<Button variant="ghost" size="sm" type="submit" aria-label="Delete the synonyms of {group.base_term}">
								<Trash2 size={ICON.sm} class="text-danger" />
							</Button>
						</form>
					</li>
				{/each}
			</ul>
		</Card>
	{/if}
</PageShell>

<Drawer bind:open={synonymOpen} title="New synonym">
	<form method="POST" action="?/createSynonym" id="synonym-form" class="flex flex-col gap-4" use:enhance={saveSynonym}>
		<FormErrors message={synonymOpen ? (form?.synonymError ?? undefined) : undefined} fields={synonymOpen ? synFields : {}} />
		<Input id="syn-base" name="base_term" label="Term" required hint="A search for exactly this term also matches the terms below." bind:value={baseTerm} error={synFields.base_term} />
		<Input id="syn-terms" name="synonyms" label="Also matches" required hint="Separated by commas." bind:value={terms} error={synFields.synonyms} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (synonymOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="synonym-form">Create</Button>
	{/snippet}
</Drawer>
