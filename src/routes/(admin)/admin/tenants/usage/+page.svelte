<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Drawer,
		EmptyState,
		Input,
		NumberInput,
		PageShell,
		SectionHeading,
		Stat,
		Table,
		Toggle,
		confirm as confirmDialog,
		toast,
		Pagination,
		SearchInput,
	} from '@lyeve-labs/ui-kit';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { narrows } from '$lib/narrow';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { CONFIRM_FIELD, CONFIRMED } from '$lib/confirmation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Check, Gauge, Pencil, Plus, X } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { drawerFailure, fieldErrors, submitter } from '$lib/forms.svelte';
	import { formRefusal, refusalText, type Refusal } from '$lib/api/refusal';
	import {
		blocked,
		bytesToGib,
		keptBytes,
		enforcementLabel,
		enforcementTone,
		enforces,
		hasAnyLimit,
		limitLabel,
		pending,
		requesterName,
		uncheckedDimensions,
		usageTone,
		usedPct,
		type Quota,
		type QuotaRequest,
	} from '$lib/api/usage';
	import { formatBytes, formatDateTime, formatCount, plural } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	// The plugin serves every quota write to a super admin only. An admin reads
	// their own tenant's quota and requests, and is told the rest.
	const isSuperAdmin = $derived(data.user?.roles?.includes('super_admin') ?? false);
	// The tenant list is the super admin's. An admin who can read this page
	// would be sent to a 403 by a way back that names it.
	const back = $derived(isSuperAdmin ? { href: '/admin/tenants', label: 'Tenants' } : undefined);

	/*
	 * The plugin says nothing about its license until a write is refused, so
	 * the first refusal of a quota or an approval is what this page learns it
	 * from. From then on it holds the paid fields and Approve, with the
	 * reason beside them, and keeps live the writes that need no license.
	 */
	let paidRefusal = $state.raw<Refusal | null>(null);
	$effect(() => {
		const refused = formRefusal(form);
		const action = (form as { action?: string } | null)?.action;
		if (refused?.kind === 'feature' && (action === 'quota' || action === 'review')) paidRefusal = refused;
	});
	const paidReason = $derived(
		paidRefusal
			? `${refusalText(paidRefusal)} You need it to raise a limit, turn on enforcement or approve a request. You can still lower a limit to 0, turn off enforcement or deny a request.`
			: '',
	);

	/*
	 * Each failure names the action that caused it. The quota drawer shows only
	 * its own failures, and only one that came back after it was opened, so a
	 * failed review never reads as a failure of the form opened next. The rest
	 * show above the tables.
	 */
	type Failure = { action?: string; error?: string } | null;
	const failure = drawerFailure(() => form as Failure, ['quota']);
	const errors = $derived(fieldErrors(failure.drawer));

	// One drawer for a new quota and an existing one.
	let editorOpen = $state(false);
	let editing = $state<Quota | null>(null);
	let tenantId = $state('');
	let requestsLimit = $state(0);
	let storageGib = $state(0);
	let bandwidthGib = $state(0);
	// What the GiB fields showed when the editor opened, and the bytes behind
	// them. A field left as it was sends the stored bytes back, because two
	// decimals of a GiB cannot hold every byte limit the plugin stores.
	let shownStorageGib = $state(0);
	let shownBandwidthGib = $state(0);
	let hardLimit = $state(false);
	let blockOnExceeded = $state(false);
	let graceHours = $state(0);
	let warn80 = $state(true);
	let warn90 = $state(true);
	const saveQuota = submitter(() => (editorOpen = false));

	function openQuota(q: Quota | null) {
		failure.opened();
		editing = q;
		tenantId = q?.tenant_id ?? '';
		requestsLimit = q?.requests_limit ?? 0;
		storageGib = bytesToGib(q?.storage_bytes_limit ?? 0);
		bandwidthGib = bytesToGib(q?.bandwidth_bytes_limit ?? 0);
		shownStorageGib = storageGib;
		shownBandwidthGib = bandwidthGib;
		hardLimit = q?.is_hard_limit ?? false;
		blockOnExceeded = q?.block_on_exceeded ?? false;
		graceHours = q?.grace_period_hours ?? 0;
		warn80 = q?.warn_at_pct_80 ?? true;
		warn90 = q?.warn_at_pct_90 ?? true;
		editorOpen = true;
	}

	let clearForm = $state<HTMLFormElement>();
	async function askClear() {
		if (!editing) return;
		const ok = await confirmDialog(`Delete the quota for ${editing.tenant_id}?`, 'The tenant can then use as much as it likes, and any block on it is lifted.', {
			confirmLabel: 'Delete',
		});
		if (!ok) return;
		editorOpen = false;
		// The hidden form posts what it holds once the value has reached the DOM.
		await tick();
		clearForm?.requestSubmit();
	}
	const waiting = $derived(data.requests.ok ? pending(data.requests.value) : []);
	const stopped = $derived(blocked(data.quotas));
	const reportingOnly = $derived(
		data.quotas.filter((q) => hasAnyLimit(q) && !enforces(q)),
	);
	// The endpoint takes no search, so the box narrows the page on screen and
	// the pager below still walks every quota.
	let query = $state('');
	const visibleQuotas = $derived(data.quotas.filter((q) => narrows(query, q.tenant_id)));
	const usageByTenant = $derived(new Map((data.usage.ok ? data.usage.value : []).map((u) => [u.tenant_id, u])));

	function review(r: QuotaRequest, decision: 'approve' | 'deny'): SubmitFunction {
		return async ({ cancel, formData }) => {
			if (decision === 'approve') {
				const confirmed = await confirmDialog(
					`Approve more quota for ${r.tenant_id}?`,
					'Their limits are raised to what they asked for.',
					{ confirmLabel: 'Approve' },
				);
				if (!confirmed) {
					cancel();
					return;
				}
				formData.set(CONFIRM_FIELD, CONFIRMED);
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') {
					toast.success(decision === 'approve' ? 'Approved' : 'Denied');
				}
			};
		};
	}
</script>

<PageShell
	title="Quotas and usage"
	description="Set what each tenant is allowed, see what they have used and review requests for more."
	width="wide"
	{back}
>
	{#snippet actions()}
		{#if data.permitted && data.gate.state === 'ok' && isSuperAdmin}
			<Button variant="primary" size="sm" onclick={() => openQuota(null)}>
				<Plus size={ICON.sm} /> New quota
			</Button>
		{/if}
	{/snippet}

	{#if !data.permitted}
		<Alert tone="brand">
			Admins can view quotas and super admins can set them. Your role can do neither.
		</Alert>
	{:else if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Quotas and usage"
			absent="Usage quotas are not included in this build. Nothing is metered or capped."
		/>
	{:else}
		<FormErrors message={failure.page?.error || undefined} refused={formRefusal(failure.page)} />
		{#if !isSuperAdmin}
			<Alert tone="brand">Your role can view this tenant's quota and requests. Only a super admin can set a quota or review a request.</Alert>
		{/if}
		{#if form && 'quotaSaved' in form}
			<Alert tone="success" autoDismiss>Quota saved for {form.quotaSaved}.</Alert>
		{:else if form && 'quotaCleared' in form}
			<Alert tone="success" autoDismiss>Quota removed for {form.quotaCleared}.</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-3">
			<Stat size="sm" mono label="Quotas set" value={data.quotas.length} />
			<Stat
				size="sm"
				mono
				label="Tenants blocked"
				value={stopped.length}
				tone={stopped.length > 0 ? 'danger' : 'neutral'}
			/>
			<Stat
				size="sm"
				mono
				label="Requests waiting"
				value={data.requests.ok ? waiting.length : '?'}
				tone={waiting.length > 0 ? 'warn' : 'neutral'}
			/>
		</div>

		{#if reportingOnly.length > 0}
			<!-- A soft quota is a reporting line: the tenant passes it and
			     nothing stops. It is also what unticked boxes give you, so a
			     page showing numbers alone describes enforcement that may not
			     exist. -->
			<Alert tone="warn">
				{reportingOnly.length}
				{plural(reportingOnly.length, 'quota is', 'quotas are')} reported but not enforced, because
				Hard limit is off. Tenants can go past those limits.
			</Alert>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Quotas</SectionHeading>
			<p class="text-xs text-muted" data-testid="usage-scope">
				API calls and bandwidth count requests made with an API key only. Requests from a signed-in
				session are not counted.
			</p>
			{#if data.quotas.length === 0}
				<EmptyState
					title="No quotas yet"
					description={isSuperAdmin ? 'Every tenant may use as much as it likes.' : 'This tenant may use as much as it likes.'}
				>
					{#snippet iconSnippet()}
						<Gauge size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						{#if isSuperAdmin}
							<Button variant="secondary" onclick={() => openQuota(null)}>
								<Plus size={ICON.sm} /> New quota
							</Button>
						{/if}
					{/snippet}
				</EmptyState>
			{:else}
				<ListToolbar label="Filter quotas">
					{#snippet search()}
						<label for="quota-search" class="sr-only">Search this page</label>
						<SearchInput id="quota-search" bind:value={query} placeholder="Tenant on this page" />
					{/snippet}
				</ListToolbar>
				{#if !data.usage.ok}
					<GateNotice gate={data.usage.gate} title="what each tenant used" absent="Usage per tenant is not included in this build. The quotas below show their limits only." />
				{/if}
				{#if visibleQuotas.length === 0}
					<EmptyState
						title="No quotas match this search"
						description="The search covers this page only. Clear it or go to another page."
					/>
				{:else}
				<Table label="Quotas">
					<thead>
						<tr>
							<th scope="col">Tenant</th>
							<th scope="col">API calls</th>
							<th scope="col">Storage</th>
							<th scope="col">Bandwidth</th>
							<th scope="col">Enforcement</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each visibleQuotas as q (q.id)}
							{@const used = usageByTenant.get(q.tenant_id)}
							{@const callPct = used ? usedPct(used.api_calls, q.requests_limit) : null}
							{@const storePct = used ? usedPct(used.storage_bytes, q.storage_bytes_limit) : null}
							{@const bandPct = used ? usedPct(used.bandwidth_bytes, q.bandwidth_bytes_limit) : null}
							<tr>
								<td data-cell="nowrap">
									<span class="font-medium text-fg">{q.tenant_id}</span>
									{#if q.blocked_at}
										<Badge tone="danger" dot>Blocked</Badge>
									{/if}
									{#if uncheckedDimensions(q).length > 0}
										<!-- Zero reads like the strictest setting and is the
										     loosest: that dimension is not checked at all. -->
										<div class="text-xs text-faint">
											Unchecked: {uncheckedDimensions(q).join(', ')}
										</div>
									{/if}
								</td>
								<td data-cell="nowrap">
									<Badge tone={usageTone(callPct)}>
										{callPct === null ? limitLabel(q.requests_limit) : `${callPct}%`}
									</Badge>
									{#if used}
										<div class="text-xs text-faint">
											{formatCount(used.api_calls)} used
										</div>
									{/if}
								</td>
								<td data-cell="nowrap">
									<Badge tone={usageTone(storePct)}>
										{storePct === null ? limitLabel(q.storage_bytes_limit, true) : `${storePct}%`}
									</Badge>
									{#if used}
										<div class="text-xs text-faint">{formatBytes(used.storage_bytes)} used</div>
									{/if}
								</td>
								<td data-cell="nowrap">
									<Badge tone={usageTone(bandPct)}>
										{bandPct === null
											? limitLabel(q.bandwidth_bytes_limit, true)
											: `${bandPct}%`}
									</Badge>
									{#if used}
										<div class="text-xs text-faint">{formatBytes(used.bandwidth_bytes)} used</div>
									{/if}
								</td>
								<td data-cell="nowrap">
									<Badge tone={enforcementTone(q)}>{enforcementLabel(q)}</Badge>
								</td>
								<td class="text-right">
									{#if isSuperAdmin}
										<Button variant="ghost" size="sm" onclick={() => openQuota(q)} aria-label="Edit the quota for {q.tenant_id}">
											<Pencil size={ICON.sm} />
										</Button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				{/if}
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.quotas.length}
					total={data.quotaTotal ?? undefined}
					noun="quotas"
					href={pageHref('/admin/tenants/usage', data.limit)}
				/>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Requests for more</SectionHeading>
			{#if !data.requests.ok}
				<GateNotice gate={data.requests.gate} title="the requests for more" absent="Requests for more quota are not included in this build." />
			{:else if waiting.length === 0}
				<EmptyState
					title="No requests waiting"
					description="No tenant has asked for a higher limit."
				>
					{#snippet iconSnippet()}
						<Check size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				{#if data.requestTotal !== null && data.requestTotal > waiting.length}
					<p class="text-xs text-muted">
						Showing the newest {waiting.length} of {data.requestTotal} waiting requests. Review these to reach the rest.
					</p>
				{/if}
				{#if isSuperAdmin && paidReason}
					<p class="text-xs text-muted" data-testid="approve-held">{paidReason}</p>
				{/if}
				<Table label="Requests for more">
					<thead>
						<tr>
							<th scope="col">Tenant</th>
							<th scope="col">Asking for</th>
							<th scope="col">Because</th>
							<th scope="col">Raised</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each waiting as r (r.id)}
							<tr>
								<td data-cell="nowrap">
									<span class="font-medium text-fg">{r.tenant_id}</span>
									<div class="text-xs text-faint">by {requesterName(r.requested_by, data.people)}</div>
								</td>
								<td class="text-xs text-faint">
									{#if r.requests_limit}
										<div>{formatCount(r.requests_limit)} API calls</div>
									{/if}
									{#if r.storage_bytes_limit}
										<div>{formatBytes(r.storage_bytes_limit)} storage</div>
									{/if}
									{#if r.bandwidth_bytes_limit}
										<div>{formatBytes(r.bandwidth_bytes_limit)} bandwidth</div>
									{/if}
								</td>
								<td class="max-w-sm text-xs text-faint">{r.reason}</td>
								<td data-cell="nowrap" class="text-xs text-faint">
									{formatDateTime(r.created_at)}
								</td>
								<td data-cell="nowrap">
									{#if isSuperAdmin}
									<div class="flex items-center justify-end gap-1">
										<form method="POST" action="?/review" use:enhance={review(r, 'approve')}>
											<input type="hidden" name="id" value={r.id} />
											<input type="hidden" name="decision" value="approve" />
											<Button
												variant="ghost"
												size="sm"
												type="submit"
												disabled={paidRefusal !== null}
												aria-label="Approve the request from {r.tenant_id}"
											>
												<Check size={ICON.sm} class="text-success" />
											</Button>
										</form>
										<form method="POST" action="?/review" use:enhance={review(r, 'deny')}>
											<input type="hidden" name="id" value={r.id} />
											<input type="hidden" name="decision" value="deny" />
											<Button
												variant="ghost"
												size="sm"
												type="submit"
												aria-label="Deny the request from {r.tenant_id}"
											>
												<X size={ICON.sm} class="text-danger" />
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
	{/if}
</PageShell>

<Drawer bind:open={editorOpen} title={editing ? `Quota for ${editing.tenant_id}` : 'New quota'}>
	<form method="POST" action="?/quota" id="quota-form" use:enhance={saveQuota.enhance} class="flex flex-col gap-4">
		<FormErrors
			message={failure.drawer?.error || undefined}
			fields={errors}
			refused={formRefusal(failure.drawer)}
		/>
		{#if editing}
			<input type="hidden" name="tenant_id" value={editing.tenant_id} />
		{:else}
			<Input id="quota-tenant" name="tenant_id" label="Tenant" required bind:value={tenantId} error={errors.tenant_id} placeholder="acme" />
		{/if}
		<p class="text-xs text-muted">Enter 0 for no limit.</p>
		{#if paidReason}
			<p class="text-xs text-muted" data-testid="paid-held">{paidReason}</p>
		{/if}
		<!-- The values post through hidden fields, so a field held for the
		     license still sends what the quota stores. -->
		<input type="hidden" name="requests_limit" value={requestsLimit} />
		<input type="hidden" name="storage_bytes_limit" value={keptBytes(storageGib, shownStorageGib, editing?.storage_bytes_limit ?? 0)} />
		<input type="hidden" name="bandwidth_bytes_limit" value={keptBytes(bandwidthGib, shownBandwidthGib, editing?.bandwidth_bytes_limit ?? 0)} />
		<NumberInput id="quota-requests" label="API calls a month" min={0} disabled={paidRefusal !== null} bind:value={requestsLimit} />
		<div class="grid gap-4 sm:grid-cols-2">
			<NumberInput id="quota-storage" label="Storage (GB)" min={0} disabled={paidRefusal !== null} bind:value={storageGib} />
			<NumberInput id="quota-bandwidth" label="Bandwidth a month (GB)" min={0} disabled={paidRefusal !== null} bind:value={bandwidthGib} />
		</div>
		<input type="hidden" name="is_hard_limit" value={hardLimit ? 'true' : 'false'} />
		<Toggle
			id="quota-hard"
			label="Hard limit"
			hint="When on, the limits are enforced. When off, they are only reported."
			disabled={paidRefusal !== null && !(editing?.is_hard_limit ?? false)}
			bind:checked={hardLimit}
		/>
		<input type="hidden" name="block_on_exceeded" value={blockOnExceeded ? 'true' : 'false'} />
		<Toggle
			id="quota-block"
			label="Block the tenant past a limit"
			disabled={paidRefusal !== null && !(editing?.block_on_exceeded ?? false)}
			bind:checked={blockOnExceeded}
		/>
		<NumberInput id="quota-grace" name="grace_period_hours" label="Grace period (hours)" min={0} bind:value={graceHours} hint="How long a tenant may stay over before the block." />
		<input type="hidden" name="warn_at_pct_80" value={warn80 ? 'true' : 'false'} />
		<input type="hidden" name="warn_at_pct_90" value={warn90 ? 'true' : 'false'} />
		<!-- Under a finger each switch takes a 44px hit area around its 20px
		     track, so two switches 24px apart share none of it. -->
		<div class="flex flex-col gap-4 coarse:gap-6">
			<Toggle id="quota-warn80" label="Warn at 80%" bind:checked={warn80} />
			<Toggle id="quota-warn90" label="Warn at 90%" bind:checked={warn90} />
		</div>
	</form>
	{#snippet footer()}
		{#if editing}
			<Button variant="danger" class="me-auto" onclick={askClear}>Delete</Button>
		{/if}
		<Button variant="secondary" onclick={() => (editorOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="quota-form" disabled={!editing && !tenantId.trim()} loading={saveQuota.pending}>
			{editing ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>

<form method="POST" action="?/clearQuota" use:enhance bind:this={clearForm} class="hidden">
	<input type="hidden" name="tenant_id" value={editing?.tenant_id ?? ''} />
</form>
