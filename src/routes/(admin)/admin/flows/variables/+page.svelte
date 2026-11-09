<script lang="ts">
	import { Badge, Button, Drawer, EmptyState, Input, PageShell, PasswordInput, SearchInput, Table, Toggle, Pagination } from '@lyeve-labs/ui-kit';
	import type { SubmitFunction } from '@sveltejs/kit';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { Pencil, Plus, Trash2, Variable as VariableIcon } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { flowBack } from '$lib/flow/back';
	import { confirmed, submitter } from '$lib/forms.svelte';
	import type { ActionData, PageData } from './$types';
	import type { Variable } from '$lib/api/flows';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { relativeTime, formatDateTime } from '$lib/format';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';
	

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The shell shows why the page is unavailable while the flow plugin does
	// not run. A plugin that runs and refuses its routes is said here.
	const enabled = $derived(!data.locked);

	// One drawer for both writes: a null target is a new variable. The value
	// lives here and not in the control: flipping Secret swaps the Input for a
	// PasswordInput, which remounts, and a value held only by the control went
	// with it.
	let open = $state(false);
	let editing = $state<Variable | null>(null);
	let key = $state('');
	let value = $state('');
	let secret = $state(false);

	/*
	 * The drawer and a row's delete share one `form` result. A save shows its
	 * failure in the drawer and a delete on the page, so a failed delete never
	 * reads as a failed save in the next drawer opened. Opening the drawer
	 * clears what an earlier attempt left.
	 */
	let cleared = $state<unknown>(null);
	const failure = $derived.by(() => {
		const f = form as { action?: unknown; error?: unknown } | null;
		if (!f || f === cleared || typeof f.error !== 'string' || !f.error) return null;
		return { action: String(f.action ?? ''), error: f.error };
	});
	const saveFailure = $derived(failure?.action === 'put' ? failure.error : undefined);
	const pageFailure = $derived(failure && failure.action !== 'put' ? failure.error : undefined);

	function openCreate() {
		cleared = form;
		editing = null;
		key = '';
		value = '';
		secret = false;
		open = true;
	}

	function openEdit(v: Variable) {
		cleared = form;
		editing = v;
		key = v.key;
		value = v.is_secret ? '' : (v.value ?? '');
		secret = v.is_secret;
		open = true;
	}

	// The drawer closes once the action answers. A failure keeps it open
	// beside the message.
	$effect(() => {
		if (form && 'saved' in form && form.saved) open = false;
	});

	function deleteVariable(key: string): SubmitFunction {
		return confirmed(`Delete variable vars.${key}?`, 'Expressions that use it will fail.', {
			confirmLabel: 'Delete',
			success: `Variable vars.${key} deleted.`,
		});
	}

	const save = submitter(() => (open = false));

	// The flow this page was opened from rides along with the search and the
	// pager, so the way back still leads to it.
	const fromFlow = $derived(page.url.searchParams.get('flow') ?? '');
	const keep = $derived({ ...(data.q ? { q: data.q } : {}), ...(fromFlow ? { flow: fromFlow } : {}) });
</script>

{#if enabled}
	<PageShell
		title="Variables"
		documentTitle="Variables - Flows"
		description="Set per-tenant values that every flow can use as vars.<key>. A secret is stored encrypted, never shown again and never written to a run record."
		width="wide"
		back={flowBack(page.url)}
	>
		{#snippet actions()}
			{#if data.gate.state === 'ok'}
				<Button variant="primary" size="sm" onclick={openCreate}>
					<Plus size={ICON.sm} />
					New variable
				</Button>
			{/if}
		{/snippet}

		{#if data.gate.state !== 'ok'}
			<GateNotice level={2} gate={data.gate} title="flow variables" absent="Flow variables are not included in this build." />
		{/if}

		<FormErrors message={pageFailure} />

		{#if data.gate.state === 'ok' && (data.total > 0 || data.q)}
			<!-- A GET form, so the search lives in the address and the pager
			     keeps it. -->
			<form method="GET" data-testid="variable-filters">
				{#if fromFlow}<input type="hidden" name="flow" value={fromFlow} />{/if}
				<ListToolbar label="Filter variables">
					{#snippet search()}
						<div class="flex items-center gap-2">
							<label for="variable-search" class="sr-only">Search variables</label>
							<SearchInput id="variable-search" name="q" value={data.q} placeholder="Key or value" class="min-w-0 flex-1" />
							<Button type="submit" variant="secondary">Search</Button>
							{#if data.q}
								<Button variant="ghost" href="/admin/flows/variables">Clear</Button>
							{/if}
						</div>
					{/snippet}
				</ListToolbar>
			</form>
		{/if}

		{#if data.gate.state !== 'ok'}
			<!-- Nothing: the empty state would say there are none. -->
		{:else if data.variables.length === 0 && data.q}
			<EmptyState level={2} title="No variables match" description="Secret values are not searched. Try another key or value." />
		{:else if data.variables.length === 0}
			<EmptyState level={2} title="No variables yet" description="Create a variable to use it in expressions as vars.<key>.">
				{#snippet iconSnippet()}<VariableIcon size={ICON.lg} />{/snippet}
				{#snippet action()}
					<Button variant="secondary" onclick={openCreate}>
						<Plus size={ICON.sm} />
						New variable
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Variables">
				<thead>
					<tr>
						<th scope="col">Key</th>
						<th scope="col">Value</th>
						<th scope="col">Updated</th>
						<th scope="col">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.variables as v (v.key)}
						<tr>
							<td data-cell="nowrap" class="font-mono text-sm text-fg">vars.{v.key}</td>
							<td>
								{#if v.is_secret}
									<span class="flex items-center gap-2">
										<span class="font-mono text-xs text-faint" aria-label="Secret value hidden">********</span>
										<Badge tone="brand" size="sm">secret</Badge>
									</span>
								{:else}
									<span class="font-mono text-sm text-fg">{v.value}</span>
								{/if}
							</td>
							<td data-cell="nowrap" class="text-xs text-muted" title={formatDateTime(v.updated_at)}>{relativeTime(v.updated_at)}</td>
							<td>
								<div class="flex items-center gap-2">
									<Button variant="ghost" size="sm" onclick={() => openEdit(v)} title="Edit" aria-label="Edit {v.key}">
										<Pencil size={ICON.sm} />
									</Button>
									<form method="POST" action="?/delete" use:enhance={deleteVariable(v.key)}>
										<input type="hidden" name="key" value={v.key} />
										<Button variant="ghost" size="sm" type="submit" title="Delete" aria-label="Delete {v.key}">
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
				count={data.variables.length}
				total={data.total ?? undefined}
				noun="variables"
				href={pageHref('/admin/flows/variables', data.limit, keep)}
			/>
		{/if}
	</PageShell>

	<Drawer bind:open title={editing ? `Edit vars.${editing.key}` : 'New variable'}>
		<form method="POST" action="?/put" id="variable-form" use:enhance={save.enhance} class="flex flex-col gap-4">
			<FormErrors message={saveFailure} />
			{#if editing}
				<!-- The key is the variable's name in every expression, so it is not renamed here. -->
				<input type="hidden" name="key" value={editing.key} />
				<input type="hidden" name="existing" value="true" />
				<Input id="variable-key" label="Key" value={key} disabled />
			{:else}
				<Input id="variable-key" name="key" label="Key" placeholder="region" bind:value={key} required />
			{/if}
			{#if secret}
				<PasswordInput
					id="variable-value"
					name="value"
					label={editing?.is_secret ? 'New value' : 'Value'}
					hint={editing?.is_secret ? 'Secrets cannot be read back. Leave blank to keep the stored value.' : undefined}
					bind:value
				/>
			{:else}
				<Input id="variable-value" name="value" label="Value" placeholder="eu" bind:value />
			{/if}
			<div>
				<input type="hidden" name="is_secret" value={secret ? 'true' : 'false'} />
				<Toggle id="variable-secret" label="Secret" hint="Stored encrypted and never shown again." bind:checked={secret} />
			</div>
		</form>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button variant="primary" type="submit" form="variable-form" loading={save.pending}>{editing ? 'Save' : 'Create'}</Button>
		{/snippet}
	</Drawer>
{:else}
	<PageShell title="Flows" documentTitle="Variables - Flows" width="wide">
		<NotEnabled level={2} title="Flows" description="Flows are not enabled on this engine." />
	</PageShell>
{/if}
