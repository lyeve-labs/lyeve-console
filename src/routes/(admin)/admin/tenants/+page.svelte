<script lang="ts">
	import {
		Badge,
		Button,
		EmptyState,
		Drawer,
		Input,
		PageShell,
		Pagination,
		SearchInput,
		SegmentedControl,
		Table,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { Building2, Coins, Pencil, Plus, Trash2, ToggleLeft, ToggleRight } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { confirmed, drawerFailure, fieldErrors, tracked } from '$lib/forms.svelte';
	import { narrows } from '$lib/narrow';
	import type { PageData, ActionData } from './$types';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { Tenant } from '@lyeve-labs/client-rest';
	import { formatDate, NO_VALUE, plural } from '$lib/format';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { ICON } from '$lib/icon';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { formRefusal } from '$lib/api/refusal';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The multitenant plugin says whether this instance may create tenants.
	// Where it may not, no create control is drawn rather than drawn and
	// refused. Editing, disabling and deleting a tenant stay open either way.
	const canProvision = $derived(data.canProvision);

	type Failure = { action?: string; error?: string } | null;
	const failure = drawerFailure(() => form as Failure, ['create', 'update']);
	const errors = $derived(fieldErrors(failure.drawer));

	// One drawer for both writes: a null target is a new tenant.
	let open = $state(false);
	let editing = $state<Tenant | null>(null);
	let slug = $state('');
	let name = $state('');

	/**
	 * Deleting a tenant destroys its rows and users for good, so the row asks
	 * first and names the tenant. enhance awaits this before it sends anything,
	 * so canceling here means the request is never made.
	 */
	function deleteTenant(name: string): SubmitFunction {
		return confirmed(
			`Delete ${name}?`,
			"All of its data and users are deleted. Its stored files stay in the storage backend until that backend's own lifecycle rules remove them.",
			{ confirmLabel: 'Delete', success: `${name} deleted.` },
		);
	}

	/** Enabling and disabling both leave the row in place, so the toast says it worked. */
	function toggleTenant(name: string, enabled: boolean): SubmitFunction {
		return async () =>
			async ({ result, update }) => {
				await update();
				if (result.type === 'success') {
					toast.success(`${enabled ? 'Disabled' : 'Enabled'} ${name}`);
				}
			};
	}

	// The plan is a label stored with the tenant, typed rather than picked:
	// the engine keeps no list of them. It lives here rather than only in the
	// DOM, so the field keeps its value across a failed write.
	let plan = $state('');

	function openCreate() {
		failure.opened();
		editing = null;
		slug = '';
		name = '';
		plan = '';
		open = true;
	}

	function openEdit(tenant: Tenant) {
		failure.opened();
		editing = tenant;
		slug = tenant.slug;
		name = tenant.name;
		plan = tenant.plan;
		open = true;
	}

	/** Closes the drawer once the write lands. A failure keeps it open beside the message. */
	const saveTenant: SubmitFunction = () => {
		const subject = name;
		const verb = editing ? 'Updated' : 'Created';
		return async ({ result, update }) => {
			if (result.type !== 'failure') open = false;
			await update();
			if (result.type === 'success') toast.success(`${verb} ${subject}`);
		};
	};

	// The endpoint takes no search, so the box narrows the page on screen and
	// the pager below still walks the whole collection.
	let query = $state('');
	let status = $state('');
	const STATUSES = [
		{ value: '', label: 'All' },
		{ value: 'enabled', label: 'Enabled' },
		{ value: 'disabled', label: 'Disabled' },
	];
	const visible = $derived(
		(data.tenants.ok ? data.tenants.value : []).filter(
			(t: Tenant) =>
				narrows(query, t.slug, t.name, t.plan) &&
				(status === '' || (status === 'enabled') === t.enabled)
		)
	);

	const saveTenantSubmit = tracked(saveTenant);

	// A notice that withholds creating speaks of the tenants below only when
	// the list holds some.
	const stillEditable = $derived(
		data.tenants.ok && data.tenants.value.length > 0 ? ' You can still edit, disable and delete the tenants below.' : '',
	);
</script>

<PageShell
	title="Tenants"
	description={data.tenants.ok
		? `See and manage the ${data.total} ${plural(data.total, 'tenant')} on this engine.`
		: 'See and manage every tenant on this engine.'}
	width="wide"
>
	{#snippet actions()}
		<Button variant="secondary" size="sm" href="/admin/tenants/costs">
			<Coins size={ICON.sm} /> Tenant costs
		</Button>
		{#if canProvision}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New tenant
			</Button>
		{/if}
	{/snippet}

	<FormErrors message={failure.page?.error || undefined} />

	{#if data.tenants.ok && data.provisionGate}
		<GateNotice
			level={2}
			gate={data.provisionGate}
			title="Tenant provisioning"
			absent="Creating tenants is not included in this build.{stillEditable}"
		/>
	{:else if data.tenants.ok && !canProvision}
		<NotEnabled
			level={2}
			title="Tenant provisioning"
			description="Creating tenants is not enabled on this engine.{stillEditable}"
			url={data.provisioningUrl || null}
		/>
	{/if}

	{#if !data.tenants.ok}
		<GateNotice
			level={2}
			gate={data.tenants.gate}
			title="Tenants"
			absent="Multitenancy is not included in this build. This engine has one tenant."
		/>
	{:else if data.tenants.value.length === 0}
		<EmptyState
			level={2}
			title="No tenants yet"
			description={canProvision ? 'Create a tenant to start serving content on this engine.' : undefined}
		>
			{#snippet iconSnippet()}
				<Building2 size={ICON.lg} />
			{/snippet}
			{#snippet action()}
				{#if canProvision}
					<Button variant="secondary" onclick={openCreate}>
						<Plus size={ICON.sm} /> New tenant
					</Button>
				{/if}
			{/snippet}
		</EmptyState>
	{:else}
		<ListToolbar label="Filter tenants">
			{#snippet search()}
				<label for="tenant-search" class="sr-only">Search this page</label>
				<SearchInput id="tenant-search" bind:value={query} placeholder="Slug, name or plan on this page" />
			{/snippet}
			{#snippet filters()}
				<SegmentedControl label="Status" labelHidden bind:value={status} options={STATUSES} />
			{/snippet}
		</ListToolbar>

		{#if visible.length === 0}
			<EmptyState
				level={2}
				title="No tenants match this search"
				description="The search covers this page only. Clear it or go to another page."
			/>
		{:else}
		<Table label="Tenants">
			<thead>
				<tr>
					<th scope="col">Slug</th>
					<th scope="col">Name</th>
					<th scope="col">Plan</th>
					<th scope="col">Status</th>
					<th scope="col">Created</th>
					<th scope="col" class="text-right">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each visible as tenant (tenant.id)}
					<tr>
						<td data-cell="nowrap" class="font-mono text-xs">{tenant.slug}</td>
						<td data-cell="nowrap">
							<a href="/admin/tenants/{tenant.id}" class="relative hit-area text-fg transition-colors hover:text-brand">{tenant.name}</a>
						</td>
						<td>
							{#if tenant.plan}
								<Badge tone="neutral">{tenant.plan}</Badge>
							{:else}
								<span class="text-faint">{NO_VALUE}</span>
							{/if}
						</td>
						<td>
							<Badge tone={tenant.enabled ? 'success' : 'neutral'} dot>
								{tenant.enabled ? 'Enabled' : 'Disabled'}
							</Badge>
						</td>
						<td data-cell="nowrap" class="text-xs text-faint">{formatDate(tenant.created_at, 'Unknown')}</td>
						<td>
							<div class="flex items-center justify-end gap-2">
								<Button
									variant="ghost"
									size="sm"
									aria-label="Edit {tenant.name}"
									onclick={() => openEdit(tenant)}
								>
									<Pencil size={ICON.sm} />
								</Button>
								<form
									method="post"
									action="?/toggle"
									use:enhance={toggleTenant(tenant.name, tenant.enabled)}
								>
									<input type="hidden" name="id" value={tenant.id} />
									<input type="hidden" name="enabled" value={String(tenant.enabled)} />
									<Button
										variant="ghost"
										size="sm"
										type="submit"
										aria-label="{tenant.enabled ? 'Disable' : 'Enable'} {tenant.name}"
									>
										{#if tenant.enabled}
											<ToggleRight size={ICON.sm} class="text-brand" />
										{:else}
											<ToggleLeft size={ICON.sm} />
										{/if}
									</Button>
								</form>
								<form
									method="post"
									action="?/delete"
									use:enhance={deleteTenant(tenant.name)}
								>
									<input type="hidden" name="id" value={tenant.id} />
									<Button
										variant="ghost"
										size="sm"
										type="submit"
										aria-label="Delete {tenant.name}"
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
		{/if}

		<!-- Links rather than a callback, so a page turns before hydration. -->
		<Pagination
			page={pageNumber(data.offset, data.limit)}
			perPage={data.limit}
			count={data.tenants.value.length}
			total={data.total}
			noun="tenants"
			href={pageHref('/admin/tenants', data.limit)}
		/>
	{/if}
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New tenant'}>
	<form method="post" action={editing ? '?/update' : '?/create'} id="tenant-form" use:enhance={saveTenantSubmit.enhance} class="flex flex-col gap-4">
		<FormErrors message={failure.drawer?.error || undefined} fields={errors} refused={formRefusal(failure.drawer)} />

		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
			<!-- The slug is the tenant's address, and the engine offers no rename. -->
			<Input id="slug" label="Slug" value={slug} disabled />
		{:else}
			<Input
				id="slug"
				label="Slug"
				name="slug"
				required
				placeholder="acme_corp"
				hint="Lowercase letters, digits and underscores, starting with a letter. At most 63 characters. It cannot be changed later."
				bind:value={slug}
				error={errors.slug}
			/>
		{/if}
		<Input
			id="name"
			label="Display name"
			name="name"
			required
			placeholder="ACME Corp"
			bind:value={name}
			error={errors.name}
		/>
		<Input
			id="plan"
			label="Plan"
			name="plan"
			hint="A label saved with the tenant. Leave it empty to use free."
			bind:value={plan}
			autocomplete="off"
		/>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="tenant-form" loading={saveTenantSubmit.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>
