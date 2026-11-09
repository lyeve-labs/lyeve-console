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
		Table,
		Textarea,
		Toggle,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import AuditTabs from '$lib/components/AuditTabs.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { confirmed, tracked } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Copy, Lock, Plus, ScrollText, Trash2, Unlock } from '@lucide/svelte';
	import {
		activeHolds,
		archivalLabel,
		archivalTone,
		deletionIsBlocked,
		holdIsUnbounded,
		holdScope,
		policyIsCatchAll,
		policyScope,
		retentionLabel,
		type LegalHold,
		type RetentionPolicy,
	} from '$lib/api/retention';
	import { formatDateTime, plural } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Every form on this page reports through one result, so each failure is
	// tagged with its action and shown only where that action was made. A
	// drawer opened after a failure starts clean: the result is set aside.
	let setAside = $state<unknown>(null);
	const failure = $derived(
		form && form !== setAside ? (form as { action?: string; error?: string }) : null,
	);
	const DRAWER_ACTIONS = ['createPolicy', 'createHold'];
	const policyError = $derived(failure?.action === 'createPolicy' ? (failure.error ?? '') : '');
	const holdError = $derived(failure?.action === 'createHold' ? (failure.error ?? '') : '');
	const rowError = $derived(
		failure?.action && !DRAWER_ACTIONS.includes(failure.action) ? (failure.error ?? '') : '',
	);
	const outcome = $derived(
		(form as { enforced?: boolean; deleted?: number; policies?: number; archiveFailed?: string[] } | null) ?? null,
	);
	const archiveFailed = $derived(outcome?.archiveFailed ?? []);
	const holds = $derived(data.holds.ok ? data.holds.value : []);
	const live = $derived(activeHolds(holds));
	const blocked = $derived(deletionIsBlocked(data.policies, holds));
	// The audit plugin takes every write on this page from a super admin only.
	// An admin reads the rules and is told who can change them.
	const canWrite = $derived(data.user.roles.includes('super_admin'));

	let addingPolicy = $state(false);
	let eventType = $state('');
	let resourceType = $state('');
	let days = $state('365');
	let archival = $state(false);
	let storage = $state('');
	let pathPrefix = $state('');

	let addingHold = $state(false);
	let holdName = $state('');
	let holdDescription = $state('');
	let holdAction = $state('');
	let holdResourceType = $state('');
	let holdResourceId = $state('');
	let holdTenant = $state('');

	function openPolicy() {
		eventType = '';
		resourceType = '';
		days = '365';
		archival = false;
		storage = '';
		pathPrefix = '';
		setAside = form;
		addingPolicy = true;
	}

	/**
	 * Copy a policy into the create drawer.
	 *
	 * A retention policy has no edit: it is created and deleted. So this is the
	 * only way to write one like another, which is what somebody wants when
	 * they are covering a second resource type on the same schedule.
	 *
	 * The scope is deliberately left blank. Two policies covering exactly the
	 * same thing is the one shape that is always a mistake, and the copy exists
	 * to carry the schedule rather than the coverage.
	 */
	function duplicatePolicy(source: RetentionPolicy) {
		eventType = '';
		resourceType = '';
		days = String(source.retention_days ?? 365);
		archival = source.archival_enabled ?? false;
		storage = source.archival_storage ?? '';
		pathPrefix = source.archival_path_prefix ?? '';
		setAside = form;
		addingPolicy = true;
	}

	function openHold() {
		holdName = '';
		holdDescription = '';
		holdAction = '';
		holdResourceType = '';
		holdResourceId = '';
		holdTenant = '';
		setAside = form;
		addingHold = true;
	}

	const savePolicy: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type !== 'failure') addingPolicy = false;
			await update();
			if (result.type === 'success') toast.success('Policy created');
		};
	};

	const saveHold: SubmitFunction = () => {
		const subject = holdName;
		return async ({ result, update }) => {
			if (result.type !== 'failure') addingHold = false;
			await update();
			if (result.type === 'success') toast.success(`Hold ${subject} created`);
		};
	};

	function removePolicy(p: RetentionPolicy): SubmitFunction {
		return confirmed(
			`Delete the policy covering ${policyScope(p)}?`,
			'Entries it covered are no longer deleted, and the audit log grows until another policy covers them.',
			{ confirmLabel: 'Delete', success: 'Policy deleted' },
		);
	}

	/**
	 * Releasing a hold is the moment protected entries become deletable. If a
	 * policy already covers them, the next enforcement run removes them.
	 */
	function release(h: LegalHold): SubmitFunction {
		return confirmed(
			`Release ${h.name}?`,
			'Entries this hold protected can be deleted again. If a retention policy covers them, the next enforcement run deletes them permanently.',
			{ confirmLabel: 'Release', success: `Released ${h.name}` },
		);
	}

	/** Deletes. Not a dry run, and nothing undoes it. */
	const enforce = confirmed(
		'Enforce retention now?',
		'Every audit entry past its retention window and not under a legal hold is deleted. This cannot be undone.',
		{ confirmLabel: 'Delete them' },
	);

	const savePolicySubmit = tracked(savePolicy);
	const saveHoldSubmit = tracked(saveHold);
</script>

<PageShell
	title="Audit log"
	documentTitle="Retention and holds - Audit log"
	description="Choose how long audit entries are kept, and hold entries back from deletion."
	width="wide"
>
	{#snippet actions()}
		{#if data.gate.state === 'ok' && canWrite}
			<form method="POST" action="?/enforce" use:enhance={enforce}>
				<Button variant="secondary" size="sm" type="submit">
					<Trash2 size={ICON.sm} /> Enforce now
				</Button>
			</form>
			<Button variant="primary" size="sm" onclick={openPolicy}>
				<Plus size={ICON.sm} /> New policy
			</Button>
		{/if}
	{/snippet}

	<AuditTabs active="retention" rules={data.holds.ok ? data.policies.length + data.holds.value.length : undefined} />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Retention"
			absent="Audit retention is not included in this build. Entries are kept indefinitely."
		/>
	{:else}
		{#if rowError}
			<Alert tone="danger">{rowError}</Alert>
		{/if}
		{#if !canWrite}
			<Alert tone="info">
				Only a super admin can change a retention policy, raise or release a hold, or enforce retention.
			</Alert>
		{/if}
		{#if outcome?.enforced}
			<Alert tone="success" autoDismiss>
				Retention enforced across {outcome.policies} {plural(outcome.policies ?? 0, 'policy', 'policies')}.
				{outcome.deleted} {plural(outcome.deleted ?? 0, 'entry was', 'entries were')} deleted.
			</Alert>
			{#if archiveFailed.length > 0}
				<!-- A standing condition, not an outcome: the entries are still
				     there until an archive succeeds, so the warning stays. -->
				<Alert tone="warn">
					Archiving failed for {archiveFailed.join(', ')}, so nothing {archiveFailed.length === 1
						? 'that policy covers'
						: 'those policies cover'} was deleted. Check the archive storage, then enforce again.
				</Alert>
			{/if}
		{/if}

		{#if blocked}
			<!-- The reading a policy list alone gets wrong. A hold overrides
			     every policy, so an auditor asking "is this gone after ninety
			     days" is told yes by the policy and no by reality. -->
			<Alert tone="warn">
				A legal hold covers every audit entry, so none of the policies below deletes anything.
				Release the hold once the matter it was raised for has closed.
			</Alert>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Policies</SectionHeading>
			{#if data.policies.length === 0}
				<EmptyState
					title="No retention policies yet"
					description="Audit entries are kept forever. Create a policy to delete them after a set time."
				>
					{#snippet iconSnippet()}
						<ScrollText size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						{#if canWrite}
							<Button variant="secondary" onclick={openPolicy}>
								<Plus size={ICON.sm} /> New policy
							</Button>
						{/if}
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Policies">
					<thead>
						<tr>
							<th scope="col">Covers</th>
							<th scope="col">Kept for</th>
							<th scope="col">Then</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.policies as p (p.id)}
							<tr>
								<td data-cell="nowrap">
									<span class="text-fg">{policyScope(p)}</span>
									{#if policyIsCatchAll(p)}
										<!-- The widest rule there is. An empty cell would
										     read as an unfinished row. -->
										<Badge tone="warn">Catch-all</Badge>
									{/if}
								</td>
								<td data-cell="nowrap" class="text-xs text-faint">
									{retentionLabel(p.retention_days)}
								</td>
								<td data-cell="nowrap">
									<!-- Archival off means the entries are gone. With a
									     compliance obligation that is the difference
									     between a policy and a data loss incident. -->
									<Badge tone={archivalTone(p)}>{archivalLabel(p)}</Badge>
								</td>
								<td data-cell="nowrap">
									{#if canWrite}
										<div class="flex justify-end">
											<Button
												variant="ghost"
												size="sm"
												aria-label="Duplicate the policy covering {policyScope(p)}"
												onclick={() => duplicatePolicy(p)}
											>
												<Copy size={ICON.sm} />
											</Button>
											<form method="POST" action="?/deletePolicy" use:enhance={removePolicy(p)}>
												<input type="hidden" name="id" value={p.id} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													aria-label="Delete the policy covering {policyScope(p)}"
												>
													<Trash2 size={ICON.sm} class="text-danger" />
												</Button>
											</form>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Legal holds</SectionHeading>
			{#if !data.holds.ok}
				<GateNotice
					gate={data.holds.gate}
					title="Legal holds"
					absent="Legal holds are not included in this build."
				/>
			{:else if live.length === 0}
				<EmptyState
					title="No legal holds yet"
					description="Every entry is deleted on the schedule its policy sets."
				>
					{#snippet iconSnippet()}
						<Unlock size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						{#if canWrite}
							<Button variant="secondary" onclick={openHold}>
								<Plus size={ICON.sm} /> New hold
							</Button>
						{/if}
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Legal holds">
					<thead>
						<tr>
							<th scope="col">Hold</th>
							<th scope="col">Protects</th>
							<th scope="col">Raised</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each live as h (h.id)}
							<tr>
								<td data-cell="nowrap">
									<div class="flex items-center gap-2">
										<Lock size={ICON.sm} class="text-warn" aria-hidden="true" />
										<span class="font-medium text-fg">{h.name}</span>
										{#if holdIsUnbounded(h)}
											<Badge tone="warn">Everything</Badge>
										{/if}
									</div>
									{#if h.description}
										<div class="text-xs text-faint">{h.description}</div>
									{/if}
								</td>
								<td class="text-xs text-faint">{holdScope(h)}</td>
								<td data-cell="nowrap" class="text-xs text-faint">
									{formatDateTime(h.created_at)}
									{#if h.created_by}
										<div>by {h.created_by}</div>
									{/if}
								</td>
								<td data-cell="nowrap">
									{#if canWrite}
										<div class="flex justify-end">
											<form method="POST" action="?/releaseHold" use:enhance={release(h)}>
												<input type="hidden" name="id" value={h.id} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													aria-label="Release {h.name}"
												>
													<Unlock size={ICON.sm} />
												</Button>
											</form>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				{#if canWrite}
					<div>
						<Button variant="secondary" size="sm" onclick={openHold}>
							<Plus size={ICON.sm} /> New hold
						</Button>
					</div>
				{/if}
			{/if}
		</section>
	{/if}
</PageShell>

<Drawer bind:open={addingPolicy} title="New retention policy">
	<form id="policy-form" method="POST" action="?/createPolicy" use:enhance={savePolicySubmit.enhance}>
		<div class="flex flex-col gap-4">
			<FormErrors message={policyError || undefined} />
			<Input
				id="ret-event"
				name="event_type"
				label="Event type"
				hint="Leave empty to cover every event this policy does not already name."
				bind:value={eventType}
			/>
			<Input
				id="ret-resource"
				name="resource_type"
				label="Resource type"
				hint="Leave empty for every resource."
				bind:value={resourceType}
			/>
			<Input
				id="ret-days"
				name="retention_days"
				label="Keep for, in days"
				hint="Zero deletes matching entries at the next enforcement run."
				bind:value={days}
			/>
			<!-- Toggle renders a button, which submits nothing. -->
			<input type="hidden" name="archival_enabled" value={archival ? 'true' : 'false'} />
			<Toggle
				id="ret-archival"
				label="Archive before deleting"
				hint="When on, matching entries are written to storage before they are deleted. When off, they are deleted without an archive."
				bind:checked={archival}
			/>
			<Input
				id="ret-storage"
				name="archival_storage"
				label="Archive to"
				hint="Required when archiving is on."
				bind:value={storage}
			/>
			<Input
				id="ret-prefix"
				name="archival_path_prefix"
				label="Path prefix"
				bind:value={pathPrefix}
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (addingPolicy = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="policy-form" loading={savePolicySubmit.pending}>Create</Button>
	{/snippet}
</Drawer>

<Drawer bind:open={addingHold} title="New legal hold">
	<form id="hold-form" method="POST" action="?/createHold" use:enhance={saveHoldSubmit.enhance}>
		<div class="flex flex-col gap-4">
			<FormErrors message={holdError || undefined} />
			<Alert tone="warn">
				A hold overrides every retention policy for the entries it matches. Leaving every
				filter empty holds the entire audit log.
			</Alert>
			<Input id="hold-name" name="name" label="Name" bind:value={holdName} required />
			<Textarea
				id="hold-description"
				name="description"
				label="Why it was raised"
				hint="Explain why, for whoever later decides whether to release it."
				rows={3}
				bind:value={holdDescription}
			/>
			<Input id="hold-action" name="filter_action" label="Action" bind:value={holdAction} />
			<Input
				id="hold-resource-type"
				name="filter_resource_type"
				label="Resource type"
				bind:value={holdResourceType}
			/>
			<Input
				id="hold-resource-id"
				name="filter_resource_id"
				label="Resource id"
				bind:value={holdResourceId}
			/>
			<Input
				id="hold-tenant"
				name="filter_tenant_id"
				label="Tenant"
				bind:value={holdTenant}
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (addingHold = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="hold-form" loading={saveHoldSubmit.pending}>Create</Button>
	{/snippet}
</Drawer>
