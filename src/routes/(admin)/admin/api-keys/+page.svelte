<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		CheckboxGroup,
		CopyField,
		DatePicker,
		Drawer,
		EmptyState,
		Input,
		Modal,
		PageShell,
		Progress,
		SearchInput,
		SegmentedControl,
		Pagination,
		Table,
		type StatusTone,
	} from '@lyeve-labs/ui-kit';
	import type { PageData, ActionData } from './$types';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { Key, Plus, Trash2, Ban, Gauge } from '@lucide/svelte';
	import { formRefusal } from '$lib/api/refusal';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { confirmed, fieldErrors, submitter } from '$lib/forms.svelte';
	import { narrows } from '$lib/narrow';
	import { ROLE_OPTIONS, roleTone } from '$lib/roles';
	import { formatCount, formatDate, plural } from '$lib/format';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';
	import {
		LIMIT_FIELDS,
		MAX_PRIVILEGED_KEY_DAYS,
		isPrivilegedKey,
		keyExpiryProblem,
		keyRoleProblem,
		keyScopeProblem,
		limitOrderProblem,
		limitsOf,
		privilegedExpiryBounds,
		scopesOf,
		type KeyLimits,
	} from '$lib/api/api-keys';
	import { accessProblem, accessScopes, defaultAccess, describeScopes, groupCatalog } from '$lib/api/key-access';
	import KeyAccess from './KeyAccess.svelte';
	import RequestLimits from './RequestLimits.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type APIKeyRow = Extract<PageData['keys'], { ok: true }>['value'][number];
	const keys = $derived(data.keys.ok ? data.keys.value : []);

	/*
	 * Every action answers into the one `form`, so each failure names its
	 * action. A drawer shows only its own action's failure, and only one that
	 * came back after it opened. The page shows revoke and delete.
	 */
	type Failure = { action?: string; error?: string; fields?: Record<string, string>; refused?: unknown };
	const failure = $derived(form && typeof form === 'object' && 'error' in form ? (form as Failure) : null);
	let createOpenedOver = $state.raw<unknown>(null);
	let limitOpenedOver = $state.raw<unknown>(null);
	const createFailure = $derived(form !== createOpenedOver && failure?.action === 'create' ? failure : null);
	const limitFailure = $derived(form !== limitOpenedOver && failure?.action === 'limit' ? failure : null);
	const pageFailure = $derived(failure && failure.action !== 'create' && failure.action !== 'limit' ? failure : null);
	const errors = $derived(fieldErrors(createFailure));
	const limitErrors = $derived(fieldErrors(limitFailure));

	function usagePct(keyId: string): number {
		const key = keys.find((k) => k.id === keyId);
		const usage = data.usageMap?.[keyId];
		if (!key || !usage || !key.monthly_limit || key.monthly_limit === 0) return -1;
		return Math.min(100, Math.round((usage.requests / key.monthly_limit) * 100));
	}

	function usageTone(pct: number): StatusTone {
		if (pct >= 90) return 'danger';
		if (pct >= 70) return 'warn';
		return 'brand';
	}

	// The create drawer. A key cannot be edited once issued, so it has no
	// edit mode.
	const NO_LIMITS: KeyLimits = { hourly_limit: 0, daily_limit: 0, monthly_limit: 0 };
	let showCreate = $state(false);
	let createName = $state('');
	let createLimits = $state<KeyLimits>({ ...NO_LIMITS });

	// The request limits drawer, one key at a time.
	let limitKey = $state<{ id: string; name: string } | null>(null);
	let limitOpen = $state(false);
	let limitValues = $state<KeyLimits>({ ...NO_LIMITS });
	function openLimit(key: APIKeyRow) {
		limitOpenedOver = form;
		limitKey = { id: key.id, name: key.name };
		limitValues = limitsOf(key);
		limitOpen = true;
	}

	/** The hourly and daily ceilings, for the usage cell under the monthly bar. */
	function windowNote(key: APIKeyRow): string {
		const l = limitsOf(key);
		const parts = LIMIT_FIELDS.filter((f) => f.field !== 'monthly_limit' && l[f.field] > 0).map(
			(f) => `${formatCount(l[f.field])}/${f.per}`,
		);
		return parts.join(', ');
	}

	// Which routes a key can be scoped to, from the engine's catalog.
	const groups = $derived(groupCatalog(data.catalog ?? null));
	const refused = $derived(formRefusal(createFailure));
	const limitRefused = $derived(formRefusal(limitFailure));
	const pageRefused = $derived(formRefusal(pageFailure));
	let createRoles = $state<string[]>(['viewer']);
	let createAccess = $state(defaultAccess());
	const createScopes = $derived(accessScopes(createAccess));
	let createExpires = $state('');
	// A key holding an admin role carries that role on the content API, so it
	// has to expire, and within 90 days.
	const privileged = $derived(isPrivilegedKey(createRoles));
	const bounds = $derived(privilegedExpiryBounds());
	const expiryProblem = $derived(keyExpiryProblem(createRoles, createExpires));
	const scopeProblem = $derived(keyScopeProblem(createRoles, createScopes));
	const roleProblem = $derived(keyRoleProblem(createRoles, createScopes));
	// A privileged key with no expiry keeps working. The page counts those so
	// they get replaced rather than forgotten.
	const neverExpiring = $derived(keys.filter((k) => k.enabled && !k.expires_at && isPrivilegedKey(k.roles)).length);
	// The admin API refuses these and takes admin tokens instead. The page
	// counts them so automation still sending one is found.
	const adminRoleKeys = $derived(keys.filter((k) => k.enabled && isPrivilegedKey(k.roles)).length);

	function openCreate() {
		createOpenedOver = form;
		createName = '';
		createLimits = { ...NO_LIMITS };
		createRoles = ['viewer'];
		createAccess = defaultAccess();
		createExpires = '';
		showCreate = true;
	}

	// Raw key reveal modal
	// Shown once after creation. Populated from form action result.
	let showRawKey = $state(false);
	let rawKey = $state('');
	let rawKeyName = $state('');

	$effect(() => {
		if (form && 'created' in form && form.created) {
			rawKey = String((form as Record<string, unknown>).raw_key ?? '');
			rawKeyName = String((form as Record<string, unknown>).key_name ?? '');
			showCreate = false;
			showRawKey = true;
		}
	});

	/**
	 * A key is a live credential and deleting it cannot be undone, so the row
	 * asks first and names the key. enhance awaits this before it sends anything,
	 * so canceling here means the request is never made.
	 */
	function deleteKey(name: string): SubmitFunction {
		return confirmed(
			`Delete API key ${name}?`,
			'Anything that uses this key stops working, and the key is removed from the list. This cannot be undone.',
			{ confirmLabel: 'Delete', success: `${name} deleted.` },
		);
	}

	/** Revoking leaves the row in place, so nothing on screen says it worked. */
	/**
	 * Revoke asks before it fires, as delete does.
	 *
	 * Revoking breaks a live integration silently: the key stops working and
	 * nothing on the caller's side says why. So it asks first, as delete does.
	 */
	function revokeKey(name: string): SubmitFunction {
		return confirmed(
			`Revoke key ${name}?`,
			'Anything that uses this key stops working immediately. The key stays in the list and cannot be used again.',
			{ confirmLabel: 'Revoke', success: `${name} revoked.` },
		);
	}

	// The endpoint takes no search, so the box narrows the page on screen.
	let query = $state('');
	let status = $state('');
	const STATUSES = [
		{ value: '', label: 'All' },
		{ value: 'active', label: 'Active' },
		{ value: 'revoked', label: 'Revoked' },
	];
	const visible = $derived(
		keys.filter(
			(k) =>
				narrows(query, k.name, k.roles.join(' '), k.schemas.join(' ')) &&
				(status === '' || (status === 'active') === k.enabled)
		)
	);

	const create = submitter(() => (showCreate = false));
	const limit = submitter(() => (limitOpen = false));
</script>

<PageShell
	title="API keys"
	description="Create machine-to-machine credentials, each limited to the content types, routes and request limits you choose."
	width="wide"
>
	{#snippet actions()}
		{#if data.keys.ok}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New key
			</Button>
		{/if}
	{/snippet}

	<p class="text-sm text-muted">
		For automation that calls the admin API, such as a deploy script that creates content types, use an
		<a href="/admin/admin-tokens" class="text-brand hover:underline">admin token</a> instead. It has scoped grants, an expiry and a request log.
	</p>

	<FormErrors message={pageFailure?.error} refused={pageRefused} />

	<!-- The kit's empty state titles itself as an h3. This names the list
	     under the page title so a heading list never skips a level. -->
	<h2 class="sr-only">Keys</h2>

	{#if !data.keys.ok}
		<GateNotice gate={data.keys.gate} title="API keys" absent="API keys are not included in this build." />
	{:else if keys.length === 0}
		<EmptyState
			title="No API keys yet"
			description="Create a key to allow external services to authenticate."
		>
			{#snippet iconSnippet()}
				<Key size={ICON.lg} />
			{/snippet}
			{#snippet action()}
				<Button variant="secondary" onclick={openCreate}>
					<Plus size={ICON.sm} /> New key
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		{#if neverExpiring > 0}
			<Alert tone="warn" title="{neverExpiring} admin {plural(neverExpiring, 'key never expires', 'keys never expire')}">
				A key with the admin or super admin role expires within {MAX_PRIVILEGED_KEY_DAYS} days. A key marked No expiry keeps working until it is revoked. Replace each with one that expires, then revoke it.
			</Alert>
		{/if}
		{#if adminRoleKeys > 0}
			<Alert tone="warn" title="{adminRoleKeys} {plural(adminRoleKeys, 'key carries', 'keys carry')} an admin role">
				The admin API refuses a key with an admin role. Move automation that calls it to <a class="underline" href="/admin/admin-tokens">admin tokens</a>. These keys still work on the content API.
			</Alert>
		{/if}
		<ListToolbar label="Filter API keys">
			{#snippet search()}
				<label for="key-search" class="sr-only">Search this page</label>
				<SearchInput id="key-search" bind:value={query} placeholder="Name, role or content type on this page" />
			{/snippet}
			{#snippet filters()}
				<SegmentedControl label="Status" labelHidden bind:value={status} options={STATUSES} />
			{/snippet}
		</ListToolbar>

		{#if visible.length === 0}
			<EmptyState
				title="No keys on this page match these filters"
				description="Clear the search and the status filter, or go to another page."
			/>
		{:else}
		<Table label="API keys">
			<thead>
				<tr>
					<th scope="col">Name</th>
					<th scope="col">Roles</th>
					<th scope="col">Scopes</th>
					<th scope="col">Content types</th>
					<th scope="col">Status</th>
					<th scope="col">Created</th>
					<th scope="col">Expires</th>
					<th scope="col">Usage (this month)</th>
					<th scope="col" class="text-right">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each visible as key (key.id)}
					{@const pct = usagePct(key.id)}
					{@const u = data.usageMap?.[key.id]}
					<tr>
						<td data-cell="nowrap" class="font-medium">{key.name}</td>
						<td data-cell="nowrap">
							<div class="flex flex-wrap gap-1">
								{#each key.roles as role (role)}
									<Badge tone={roleTone(role)} size="sm">{role}</Badge>
								{/each}
								{#if key.roles.length === 0}
									<span class="text-xs text-faint">none</span>
								{/if}
								{#if isPrivilegedKey(key.roles)}
									<Badge tone="neutral" size="sm">Admin API: refused</Badge>
								{/if}
							</div>
						</td>
						<td class="text-xs text-muted">
							{#if scopesOf(key).length === 0}
								<span class="text-faint">none</span>
							{:else}
								<ul class="flex flex-col gap-0.5">
									{#each describeScopes(scopesOf(key)) as line (line)}
										<li class="font-mono">{line}</li>
									{/each}
								</ul>
							{/if}
						</td>
						<td class="text-xs text-muted">
							{#if key.schemas.length === 0}
								<span class="text-faint">all</span>
							{:else}
								{key.schemas.join(', ')}
							{/if}
						</td>
						<td>
							{#if key.enabled}
								<Badge tone="success" dot>Active</Badge>
							{:else}
								<Badge tone="danger" dot>Revoked</Badge>
							{/if}
						</td>
						<td data-cell="nowrap" class="text-xs text-faint">{formatDate(key.created_at, 'Never')}</td>
						<td data-cell="nowrap" class="text-xs text-faint">
							{#if !key.expires_at && isPrivilegedKey(key.roles)}
								<Badge tone="warn">No expiry</Badge>
							{:else}
								{formatDate(key.expires_at, 'Never')}
							{/if}
						</td>
						<td>
							{#if pct >= 0}
								<div class="min-w-24">
									<Progress
										value={pct}
										tone={usageTone(pct)}
										label={`${u?.requests ?? 0} req`}
										showValue
									/>
								</div>
							{:else if u}
								<span class="text-xs text-faint">{u.requests} req</span>
							{:else if data.usageUnknown.includes(key.id)}
								<span class="text-xs text-faint">Could not load usage</span>
							{:else}
								<span class="text-xs text-faint">None</span>
							{/if}
							{#if windowNote(key)}
								<span class="mt-1 block text-xs text-faint">Also {windowNote(key)}</span>
							{/if}
						</td>
						<td>
							<div class="flex justify-end gap-2">
								<Button variant="ghost" size="sm" onclick={() => openLimit(key)} aria-label="Request limits for {key.name}" title="Request limits">
									<Gauge size={ICON.sm} />
								</Button>
								{#if key.enabled}
									<form method="POST" action="?/revoke" use:enhance={revokeKey(key.name)}>
										<input type="hidden" name="id" value={key.id} />
										<Button
											variant="ghost"
											size="sm"
											type="submit"
											aria-label="Revoke {key.name}"
										>
											<Ban size={ICON.sm} />
										</Button>
									</form>
								{/if}
								<form
									method="POST"
									action="?/delete"
									use:enhance={deleteKey(key.name)}
								>
									<input type="hidden" name="id" value={key.id} />
									<Button
										variant="ghost"
										size="sm"
										type="submit"
										aria-label="Delete {key.name}"
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
		<!-- The search narrows this page only, so the pager stays when nothing on
		     it matches: the next page may hold the key. -->
		<Pagination
			page={pageNumber(data.offset, data.limit)}
			perPage={data.limit}
			count={keys.length}
			total={data.total ?? undefined}
			noun="keys"
			href={pageHref('/admin/api-keys', data.limit)}
		/>
	{/if}
</PageShell>

<Drawer bind:open={showCreate} title="New key">
		<form method="POST" action="?/create" id="key-form" use:enhance={create.enhance} class="flex flex-col gap-4">
			<FormErrors message={createFailure?.error} fields={errors} {refused} />

			<Input
				id="key-name"
				label="Name"
				name="name"
				required
				bind:value={createName}
				placeholder="my-service"
				error={errors.name}
			/>

			<CheckboxGroup name="roles" label="Roles" options={ROLE_OPTIONS} bind:value={createRoles} error={errors.roles ?? (roleProblem || undefined)} />

			<KeyAccess
				bind:access={createAccess}
				schemas={data.schemaNames ?? []}
				schemasFailed={data.schemasFailed}
				catalogFailed={data.catalogFailed}
				{groups}
				{privileged}
				error={errors.scopes ?? (scopeProblem || undefined)}
			/>

			<!-- DatePicker is a button and a popover rather than a form control, so
			     the chosen day reaches the action through a field of its own. -->
			<DatePicker
				id="key-expires"
				label="Expires"
				bind:value={createExpires}
				placeholder={privileged ? 'Choose a day' : 'No expiry'}
				required={privileged}
				min={privileged ? bounds.min : undefined}
				max={privileged ? bounds.max : undefined}
				hint={privileged ? `A key with the admin or super admin role expires within ${MAX_PRIVILEGED_KEY_DAYS} days, and the admin API refuses it.` : undefined}
				error={errors.expires_at ?? (createExpires ? expiryProblem || undefined : undefined)}
			/>
			<input type="hidden" name="expires_at" value={createExpires} />

			<RequestLimits bind:limits={createLimits} idPrefix="key" {errors} />
		</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (showCreate = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="key-form" disabled={!createName.trim() || !!expiryProblem || !!scopeProblem || !!roleProblem || accessProblem(createAccess) || !!limitOrderProblem(createLimits)} loading={create.pending}>Create</Button>
	{/snippet}
</Drawer>

<!-- Raw key reveal modal. Shown once -->
{#if showRawKey}
	<Modal open title="API key created" onclose={() => (showRawKey = false)}>
		<div class="flex flex-col gap-4">
			<p class="text-sm text-fg">
				Your API key <strong class="text-fg">{rawKeyName}</strong> is ready. Copy it now. It is not shown
				again.
			</p>
			<CopyField
				id="raw-api-key"
				label="API key"
				labelHidden
				value={rawKey}
				mono
				wrap
				copyLabel="Copy key"
				hint="If the copy fails, select the key and copy it yourself."
			/>
			<p class="text-xs text-faint">
				Send this key in the <code class="text-muted">X-API-Key</code> header of your requests.
			</p>
			<div class="flex justify-end">
				<Button variant="secondary" onclick={() => (showRawKey = false)}>Close</Button>
			</div>
		</div>
	</Modal>
{/if}

<Drawer bind:open={limitOpen} title="Request limits for {limitKey?.name ?? ''}">
	{#if limitKey}
		<form method="POST" action="?/limit" id="limit-form" use:enhance={limit.enhance} class="flex flex-col gap-4">
			<FormErrors message={limitFailure?.error} fields={limitErrors} refused={limitRefused} />
			<input type="hidden" name="id" value={limitKey.id} />
			<RequestLimits bind:limits={limitValues} idPrefix="key-limit" errors={limitErrors} />
		</form>
	{/if}
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (limitOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="limit-form" disabled={!!limitOrderProblem(limitValues)} loading={limit.pending}>Save</Button>
	{/snippet}
</Drawer>
