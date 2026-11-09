<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		CopyButton,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		Pagination,
		SectionHeading,
		Table,
		Textarea,
	} from '@lyeve-labs/ui-kit';
	import { Braces, Plus, Power, Trash2 } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import { confirmed, drawerFailure, submitter } from '$lib/forms.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GraphqlTabs from '$lib/components/GraphqlTabs.svelte';
	import type { PersistedQuery } from '$lib/api/graphql';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';
	import { pageHref, pageNumber } from '$lib/api/list';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The drawer shows a failed register, and the page shows a failed toggle or delete.
	type Failure = { action?: string; error?: string } | null;
	const failure = drawerFailure(() => form as Failure, ['register']);

	function openRegister() {
		failure.opened();
		open = true;
	}

	let open = $state(false);
	const register = submitter(() => (open = false));

	let hash = $state('');
	let toggleForm = $state<HTMLFormElement>();

	const deleteQuery = (q: PersistedQuery) =>
		confirmed(
			`Delete persisted query ${q.operation_name || q.query_hash.slice(0, 12)}?`,
			'Clients that send only its hash will be refused.',
			{ confirmLabel: 'Delete' },
		);

	async function toggle(q: PersistedQuery) {
		hash = q.query_hash;
		await tick();
		toggleForm?.requestSubmit();
	}

	const persisted = $derived(data.persisted.ok ? data.persisted.value : []);
</script>

<PageShell
	title="GraphQL"
	documentTitle="Persisted queries - GraphQL"
	description="Choose which queries clients may send by hash."
	width="wide"
>
	{#if failure.page?.error}
		<Alert tone="danger">{failure.page.error}</Alert>
	{/if}

	<GraphqlTabs active="persisted" />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="GraphQL"
			absent="GraphQL is not included in this build."
		/>
	{:else}
		<section class="flex flex-col gap-3">
			<div class="flex items-center justify-between gap-2">
				<SectionHeading level={2}>Persisted queries</SectionHeading>
				{#if data.persisted.ok}
					<Button variant="secondary" size="sm" onclick={openRegister}>
						<Plus size={ICON.sm} /> New persisted query
					</Button>
				{/if}
			</div>
			<p class="text-xs text-muted">
				Clients can send the hash of a query instead of its text. Only queries on this list run by hash. A query a
				client registered itself is marked automatic, and a disabled query is refused until you enable it again.
			</p>
			{#if !data.persisted.ok}
				<GateNotice gate={data.persisted.gate} title="Persisted queries" absent="Persisted queries need a newer version of the GraphQL plugin." />
			{:else if persisted.length === 0}
				<EmptyState title="No persisted queries yet" description="Register a query to let clients call it by hash.">
					{#snippet iconSnippet()}<Braces size={ICON.lg} />{/snippet}
					{#snippet action()}
						<Button variant="secondary" onclick={openRegister}>
							<Plus size={ICON.sm} /> New persisted query
						</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Persisted queries">
					<thead>
						<tr>
							<th scope="col">Operation</th>
							<th scope="col">Hash</th>
							<th scope="col">Query</th>
							<th scope="col">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each persisted as q (q.query_hash)}
							<tr>
								<td data-cell="nowrap">
									<span class="flex items-center gap-2 text-sm text-fg">
										{q.operation_name || 'unnamed'}
										{#if !q.enabled}<Badge tone="neutral" size="sm">off</Badge>{/if}
										{#if q.auto_registered}<Badge tone="brand" size="sm">automatic</Badge>{/if}
									</span>
									{#if q.description}<span class="block text-xs text-muted">{q.description}</span>{/if}
								</td>
								<td data-cell="nowrap" class="font-mono text-xs text-faint">{q.query_hash.slice(0, 16)}</td>
								<td class="max-w-md truncate font-mono text-xs text-muted">{q.query}</td>
								<td>
									<div class="flex items-center gap-2">
										<CopyButton value={q.query_hash} label="Copy the hash of {q.operation_name || 'this query'}" />
										<Button
											variant="ghost"
											size="sm"
											onclick={() => toggle(q)}
											aria-label="{q.enabled ? 'Disable' : 'Enable'} {q.operation_name || q.query_hash.slice(0, 12)}"
										>
											<Power size={ICON.sm} />
										</Button>
										<form method="POST" action="?/delete" use:enhance={deleteQuery(q)}>
											<input type="hidden" name="hash" value={q.query_hash} />
											<Button
												variant="ghost"
												size="sm"
												type="submit"
												aria-label="Delete {q.operation_name || q.query_hash.slice(0, 12)}"
											>
												<Trash2 size={ICON.sm} class="text-danger" />
											</Button>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={persisted.length}
					total={data.persistedTotal}
					noun="persisted queries"
					href={pageHref('/admin/settings/graphql/persisted', data.limit)}
				/>
			{/if}
		</section>
	{/if}
</PageShell>

<Drawer bind:open title="New persisted query">
	<form method="POST" action="?/register" id="persisted-form" use:enhance={register.enhance} class="flex flex-col gap-4">
		<FormErrors message={failure.drawer?.error || undefined} />
		<Textarea
			id="persisted-query"
			name="query"
			label="Query"
			required
			mono
			rows={10}
			placeholder={'query Posts {\n  posts { id title }\n}'}
			hint="Its SHA-256 is the hash a client sends."
		/>
		<Input id="persisted-operation" name="operation_name" label="Operation name" mono placeholder="Posts" />
		<Input id="persisted-description" name="description" label="Description" placeholder="The home page's post list" />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="persisted-form" loading={register.pending}>Create</Button>
	{/snippet}
</Drawer>

<form method="POST" action="?/toggle" use:enhance bind:this={toggleForm} class="hidden">
	<input type="hidden" name="hash" value={hash} />
</form>
