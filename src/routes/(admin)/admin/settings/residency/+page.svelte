<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		SectionHeading,
		Stat,
		Table,
		Toggle,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { confirmed, tracked } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Globe, MapPin, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import {
		REGION_STATE_LABELS,
		occupancy,
		regionState,
		regionTone,
		replicationLabel,
		replicationTone,
		reportIsPartial,
		unassigned,
		type Region,
	} from '$lib/api/residency';
	import { formatDateTime, plural } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The region form and the row deletes report through one result, so each
	// failure is tagged with its action and shown only where it was made. The
	// drawer opened after a failure starts clean: the result is set aside.
	let setAside = $state<unknown>(null);
	const failure = $derived(form && form !== setAside ? (form as { action?: string; error?: string }) : null);
	const saveError = $derived(failure?.action === 'create' || failure?.action === 'update' ? (failure.error ?? '') : '');
	// A region created but not closed is no longer a failure of the form, so
	// it shows above the list with the region it names.
	const rowError = $derived(
		failure?.action === 'delete' || failure?.action === 'close' ? (failure.error ?? '') : '',
	);
	const summary = $derived(data.report?.summary ?? null);
	const stranded = $derived(unassigned(data.report));
	const partial = $derived(reportIsPartial(data.report));
	const perRegion = $derived(occupancy(data.report));

	let open = $state(false);
	let editing = $state<Region | null>(null);

	let slug = $state('');
	let displayName = $state('');
	let provider = $state('aws');
	let lat = $state('');
	let long = $state('');
	let enabled = $state(true);
	let isDefault = $state(false);

	function openCreate() {
		editing = null;
		slug = '';
		displayName = '';
		provider = 'aws';
		lat = '';
		long = '';
		enabled = true;
		isDefault = false;
		setAside = form;
		open = true;
	}

	function openEdit(r: Region) {
		editing = r;
		slug = r.slug;
		displayName = r.display_name;
		provider = r.provider;
		lat = r.coordinates ? String(r.coordinates.lat) : '';
		long = r.coordinates ? String(r.coordinates.long) : '';
		enabled = r.enabled;
		isDefault = r.is_default;
		setAside = form;
		open = true;
	}

	const saveRegion: SubmitFunction = () => {
		const subject = displayName;
		const verb = editing ? 'Saved' : 'Created';
		return async ({ result, update }) => {
			const closeFailed = result.type === 'failure' && result.data?.action === 'close';
			if (result.type !== 'failure' || closeFailed) open = false;
			await update();
			if (result.type === 'success') toast.success(`${verb} ${subject}`);
		};
	};

	/**
	 * Tenants assigned to a region do not move when it is deleted, so this is
	 * the point at which a residency record can silently stop being true.
	 */
	function removeRegion(r: Region): SubmitFunction {
		return confirmed(
			`Delete region ${r.display_name}?`,
			'Tenants in this region are not moved. Move them first, or the report can no longer show where their data is.',
			{ confirmLabel: 'Delete', success: `${r.display_name} deleted.` },
		);
	}

	const saveRegionSubmit = tracked(saveRegion);
</script>

<PageShell
	title="Data residency"
	description="Manage the regions this engine runs in, and see where each tenant's data is."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#snippet actions()}
		{#if data.permitted && data.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New region
			</Button>
		{/if}
	{/snippet}

	{#if !data.permitted}
		<Alert tone="brand">
			Only a super admin can see regions and the residency report, because they cover the whole engine and every tenant.
		</Alert>
	{:else if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Data residency"
			absent="Data residency is not included in this build."
		/>
	{:else}
		{#if rowError}
			<Alert tone="danger">{rowError}</Alert>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Where tenants are</SectionHeading>

			{#if data.reportGate.state !== 'ok'}
				<!-- An unread report is never drawn as a clean one. Zero unassigned
				     tenants because nobody could ask is the worst answer here. -->
				<GateNotice
					gate={data.reportGate}
					title="The residency report"
					absent="The residency report needs a newer version of the data residency plugin."
				/>
			{:else if summary}
				<div class="grid gap-4 sm:grid-cols-4">
					<Stat size="sm" mono label="Regions" value={summary.total_regions} />
					<Stat size="sm" mono label="Tenants" value={summary.total_tenants} />
					<Stat size="sm" mono label="Replicated" value={summary.replicating_count} />
					<Stat
						size="sm"
						mono
						label="Not placed"
						value={stranded}
						tone={stranded > 0 ? 'danger' : 'neutral'}
					/>
				</div>

				{#if stranded > 0}
					<!-- The number that reads as harmless and is not. A tenant with no
					     region is not in a compliant default, it is unaccounted for. -->
					<Alert tone="danger">
						{stranded}
						{plural(stranded, 'tenant has', 'tenants have')} no region assigned. They are not in a default region, and this report cannot show where their data is.
					</Alert>
				{/if}

				{#if partial}
					<Alert tone="warn">
						This report covers one page of tenants, not all of them.
					</Alert>
				{/if}

				<p class="text-xs text-muted">
					Generated {formatDateTime(data.report?.generated_at)}.
				</p>

				{#if perRegion.length > 0}
					<Table label="Tenants per region">
						<thead>
							<tr>
								<th scope="col">Region</th>
								<th scope="col">Tenants</th>
							</tr>
						</thead>
						<tbody>
							{#each perRegion as row (row.slug)}
								<tr>
									<td data-cell="nowrap" class="font-mono text-xs">{row.slug}</td>
									<td data-cell="nowrap" class="font-mono text-xs">{row.tenants}</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				{/if}

				{#if (data.report?.tenant_regions ?? []).length > 0}
					<Table label="Where each tenant is">
						<thead>
							<tr>
								<th scope="col">Tenant</th>
								<th scope="col">Region</th>
								<th scope="col">Replica</th>
								<th scope="col">Assigned</th>
							</tr>
						</thead>
						<tbody>
							{#each data.report?.tenant_regions ?? [] as t (t.tenant_id)}
								<tr>
									<td data-cell="nowrap">
										<span class="font-medium text-fg">{t.tenant_name || t.tenant_slug}</span>
										<div class="font-mono text-xs text-faint">{t.tenant_slug}</div>
									</td>
									<td data-cell="nowrap">
										<span class="font-mono text-xs">{t.region_slug}</span>
										<div class="text-xs text-faint">{t.provider}</div>
									</td>
									<td data-cell="nowrap">
										<Badge tone={t.has_replica ? replicationTone(t.replica_status) : 'neutral'}>
											{t.has_replica ? replicationLabel(t.replica_status) : 'None'}
										</Badge>
									</td>
									<td data-cell="nowrap" class="text-xs text-faint">
										{formatDateTime(t.assigned_at)}
									</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				{/if}
			{:else}
				<EmptyState
					title="No tenants assigned yet"
					description="Tenants appear here once they are assigned a region."
				>
					{#snippet iconSnippet()}
						<Globe size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Regions</SectionHeading>

			{#if data.regions.length === 0}
				<EmptyState
					title="No regions yet"
					description="Create a region before you place a tenant in it."
				>
					{#snippet iconSnippet()}
						<MapPin size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						<Button variant="secondary" onclick={openCreate}>
							<Plus size={ICON.sm} /> New region
						</Button>
					{/snippet}
				</EmptyState>
			{:else}
				{#if data.more}
					<p class="text-xs text-muted">
						Showing the first 100 regions. Any others are not listed here.
					</p>
				{/if}
				<Table label="Regions">
					<thead>
						<tr>
							<th scope="col">Region</th>
							<th scope="col">Runs on</th>
							<th scope="col">State</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.regions as r (r.id)}
							<tr>
								<td data-cell="nowrap">
									<span class="font-medium text-fg">{r.display_name}</span>
									<div class="font-mono text-xs text-faint">{r.slug}</div>
								</td>
								<td data-cell="nowrap" class="text-xs text-faint">{r.provider}</td>
								<td data-cell="nowrap">
									<Badge tone={regionTone(regionState(r))} dot>
										{REGION_STATE_LABELS[regionState(r)]}
									</Badge>
								</td>
								<td data-cell="nowrap">
									<div class="flex items-center justify-end gap-1">
										<Button
											variant="ghost"
											size="sm"
											aria-label="Edit {r.display_name}"
											onclick={() => openEdit(r)}
										>
											<Pencil size={ICON.sm} />
										</Button>
										<form method="POST" action="?/delete" use:enhance={removeRegion(r)}>
											<input type="hidden" name="id" value={r.id} />
											<Button
												variant="ghost"
												size="sm"
												type="submit"
												aria-label="Delete {r.display_name}"
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
		</section>
	{/if}
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.display_name}` : 'New region'}>
	<form
		id="region-form"
		method="POST"
		action={editing ? '?/update' : '?/create'}
		use:enhance={saveRegionSubmit.enhance}
	>
		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
		{/if}

		<div class="flex flex-col gap-4">
			<FormErrors message={saveError || undefined} />
			{#if editing}
				<!-- The slug is copied onto every tenant assignment and onto the
				     report, so changing it would leave those rows naming a region
				     that no longer exists. -->
				<Input
					id="region-slug-fixed"
					label="Slug"
					value={slug}
					hint="A slug cannot be changed after the region is created."
					readonly
				/>
			{:else}
				<Input
					id="region-slug"
					name="slug"
					label="Slug"
					hint="Lowercase letters, digits and hyphens, such as eu-west-1. You cannot change it later."
					bind:value={slug}
					required
				/>
			{/if}
			<Input
				id="region-name"
				name="display_name"
				label="Name"
				hint="The name shown on the residency report."
				bind:value={displayName}
				required
			/>
			<Input
				id="region-provider"
				name="provider"
				label="Runs on"
				hint="For example aws, gcp, azure or on-prem."
				bind:value={provider}
				required
			/>
			<div class="grid gap-4 sm:grid-cols-2">
				<Input
					id="region-lat"
					name="lat"
					label="Latitude"
					hint={editing?.coordinates
						? 'Used to route a client to its nearest region. Saved coordinates cannot be removed, and empty fields keep them. Enter new ones to move the region.'
						: 'Optional. Used to route a client to its nearest region.'}
					bind:value={lat}
				/>
				<Input id="region-long" name="long" label="Longitude" bind:value={long} />
			</div>

			<!-- Toggle renders a button, which submits nothing. -->
			<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
			<Toggle
				id="region-enabled"
				label="Accepting new tenants"
				hint="Turning this off closes the region to new tenants. Tenants already in it stay where they are."
				bind:checked={enabled}
			/>
			<input type="hidden" name="is_default" value={isDefault ? 'true' : 'false'} />
			<Toggle
				id="region-default"
				label="Default for new tenants"
				bind:checked={isDefault}
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="region-form" loading={saveRegionSubmit.pending}>
			{editing ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>
