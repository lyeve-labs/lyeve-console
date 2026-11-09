<script lang="ts">
	import CaptureTabs from '$lib/components/CaptureTabs.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		Alert,
		Badge,
		Button,
		Checkbox,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		Pagination,
		SectionHeading,
		Table,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { tracked } from '$lib/forms.svelte';
	import { History, Plus } from '@lucide/svelte';
	import { MAX_SET_CAPTURES, capturePath } from '$lib/api/request-capture';
	import { NO_VALUE, formatDateTime, plural } from '$lib/format';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';
	import { httpStatusTone } from '$lib/tones';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const refusal = $derived(formRefusal(form));
	// A failed save names the drawer it came from, so it is said inside that
	// drawer and nowhere else. Every other failure is the page's.
	const fromDrawer = $derived(
		form && 'drawer' in form && typeof form.drawer === 'string' ? form.drawer : null,
	);
	// The plugin refuses a new replay set on an install whose license leaves
	// it out, so none is offered there.
	const canCreate = $derived(data.licensed !== false);
	const NOT_INCLUDED = 'Not included in this license';
	const formError = $derived((form as { error?: string } | null)?.error ?? '');

	let selected = $state<string[]>([]);
	// The plugin refuses a set that names a capture another tenant sent. A
	// session with no tenant of its own cannot tell, so its rows stay live.
	function foreign(c: { tenant_id?: string }): boolean {
		return data.superAdmin && !!data.ownTenant && c.tenant_id !== data.ownTenant;
	}

	function toggleCapture(id: string, on: boolean) {
		selected = on ? [...new Set([...selected, id])] : selected.filter((x) => x !== id);
	}

	let setOpen = $state(false);
	let setName = $state('');

	function openSet() {
		setName = '';
		setOpen = true;
	}

	const saveSet = tracked(() => {
		const subject = setName;
		return async ({ result, update }) => {
			if (result.type !== 'failure') {
				setOpen = false;
				selected = [];
			}
			await update();
			if (result.type === 'success') toast.success(`Replay set ${subject} created.`);
		};
	});
</script>

<PageShell
	title="Request capture"
	description={data.superAdmin
		? 'See the requests every tenant sent and save a selection as a replay set.'
		: 'See the requests this tenant sent and save a selection as a replay set.'}
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	<CaptureTabs active="captures" captures={data.gate.state === 'ok' ? (data.total ?? undefined) : undefined} />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Request capture"
			absent="Request capture is not included in this build."
		/>
	{:else}
		{#if refusal && !fromDrawer}
			<RefusalNotice {refusal} />
		{:else if formError && !fromDrawer}
			<Alert tone="danger">{formError}</Alert>
		{/if}

		{#if data.licensed === false}
			<Alert tone="brand" title="Capture rules and replay sets are not included">
				Without them, every request is kept for a day and you replay requests one at a time. Creating or enabling a
				rule, or saving a replay set, needs a license that includes them. Saved rules and sets keep working, and you
				can always switch a rule off or delete it.
			</Alert>
		{/if}

		<section class="flex flex-col gap-4" aria-label="Captures">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<SectionHeading level={2}>{data.superAdmin ? 'Captures from every tenant' : 'Captures'}</SectionHeading>
				{#if data.captures.length > 0}
					<Button
						variant="secondary"
						size="sm"
						disabled={!canCreate || selected.length === 0 || selected.length > MAX_SET_CAPTURES}
						title={canCreate ? undefined : NOT_INCLUDED}
						onclick={openSet}
					>
						<Plus size={ICON.sm} /> New replay set{selected.length > 0 ? ` from ${selected.length}` : ''}
					</Button>
				{/if}
			</div>
			{#if data.superAdmin && data.captures.length > 0}
				<p class="text-sm text-muted">
					This list and its total include every tenant. A replay set can only include captures from your own
					tenant.
				</p>
			{/if}
			{#if selected.length > MAX_SET_CAPTURES}
				<Alert tone="warn">A set can have at most {MAX_SET_CAPTURES} captures, because a replay runs them in one request.</Alert>
			{/if}
			{#if data.captures.length === 0}
				<EmptyState
					title="No captures yet"
					description="Requests appear here as this tenant sends them, unless a rule excludes them."
				>
					{#snippet iconSnippet()}
						<History size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Captures">
					<thead>
						<tr>
							<th scope="col"><span class="sr-only">Select</span></th>
							<th scope="col">Request</th>
							{#if data.superAdmin}
								<th scope="col">Tenant</th>
							{/if}
							<th scope="col">Status</th>
							<th scope="col">Took</th>
							<th scope="col">Captured</th>
						</tr>
					</thead>
					<tbody>
						{#each data.captures as c (c.id)}
							<tr>
								<td data-cell="nowrap">
									<Checkbox
										id="pick-{c.id}"
										label={foreign(c)
											? `${c.method} ${capturePath(c.url)} is from another tenant and cannot be added to a replay set`
											: `Select ${c.method} ${capturePath(c.url)}`}
										labelHidden
										disabled={foreign(c)}
										checked={selected.includes(c.id)}
										onchange={(on) => toggleCapture(c.id, on)}
									/>
								</td>
								<td class="max-w-md truncate font-mono text-xs" title={c.url}>
									{c.method} {capturePath(c.url)}
								</td>
								{#if data.superAdmin}
									<td data-cell="nowrap" class="font-mono text-xs">{c.tenant_id || NO_VALUE}</td>
								{/if}
								<td data-cell="nowrap">
									<Badge tone={httpStatusTone(c.status_code)}>
										{c.status_code}
									</Badge>
								</td>
								<td data-cell="nowrap" class="font-mono text-xs">{Math.round(c.duration_ms)} ms</td>
								<td data-cell="nowrap" class="text-xs text-faint">{formatDateTime(c.captured_at)}</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.captures.length}
					total={data.total ?? undefined}
					hasNext={data.hasMore}
					noun={data.superAdmin ? 'captures across every tenant' : 'captures'}
					href={pageHref('/admin/observability/captures', data.limit)}
				/>
			{/if}
		</section>
	{/if}
</PageShell>

<Drawer bind:open={setOpen} title="New replay set">
	<form id="replay-set-form" method="POST" action="?/createSet" use:enhance={saveSet.enhance}>
		<FormErrors
			message={fromDrawer === 'set' ? formError || undefined : undefined}
			refused={fromDrawer === 'set' ? refusal : null}
		/>
		{#each selected as id (id)}
			<input type="hidden" name="capture_id" value={id} />
		{/each}
		<div class="flex flex-col gap-4">
			<Input id="set-name" name="name" label="Name" bind:value={setName} required />
			<p class="text-sm text-muted">
				{selected.length}
				{plural(selected.length, 'capture')}, replayed in the order they were selected. A capture that
				expires before a replay is reported as not replayed and the rest still run.
			</p>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (setOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="replay-set-form" loading={saveSet.pending}>Create</Button>
	{/snippet}
</Drawer>
