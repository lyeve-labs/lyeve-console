<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		CheckboxGroup,
		Collapsible,
		CopyField,
		Drawer,
		EmptyState,
		FilterChips,
		Input,
		Modal,
		PageShell,
		Pagination,
		Panel,
		SearchInput,
		Select,
		Table,
		Textarea,
		confirm as confirmDialog,
		toast,
	} from '@lyeve-labs/ui-kit';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';
	import { applyAction, enhance } from '$app/forms';
	import { CONFIRM_FIELD, CONFIRMED } from '$lib/confirmation';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { Ban, KeySquare, Plus, RefreshCw, ScrollText } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import StepUpField from '$lib/components/admin-tokens/StepUpField.svelte';
	import TokenExpiryField from '$lib/components/admin-tokens/TokenExpiryField.svelte';
	import { tracked } from '$lib/forms.svelte';
	import { narrows } from '$lib/narrow';
	import { formatCount, formatDate, formatDateTime, plural, relativeTime } from '$lib/format';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';
	import {
		MAX_TOKEN_DAYS,
		STATUS_LABEL,
		STATUS_TONE,
		allowedIPsProblem,
		curlExample,
		droppedCount,
		expiryDistance,
		expiryTone,
		groupGrants,
		replacedIds,
		requestStatusTone,
		tokenStatus,
		type AdminToken,
		type TokenStatus,
	} from '$lib/api/admin-tokens';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	interface Failure {
		action: string;
		error: string;
		fields: Record<string, string>;
		needsMfa?: boolean;
	}
	interface Issued {
		token: string;
		name: string;
		expires_at: string;
		rotated: boolean;
	}

	function asFailure(value: unknown): Failure | null {
		if (!value || typeof value !== 'object' || !('action' in value) || !('error' in value)) return null;
		const v = value as Partial<Failure>;
		return { action: String(v.action), error: String(v.error), fields: v.fields ?? {}, needsMfa: v.needsMfa };
	}

	// The last refusal, per action. It follows `form`, which a post from the
	// layout's confirmation banner sets, and the handlers below overwrite it: a
	// success never goes through `form` (see issue below), so `form` would
	// keep showing a refusal the operator has already fixed.
	let failure = $derived<Failure | null>(asFailure(form));
	const createFailure = $derived(failure?.action === 'create' ? failure : null);
	const rotateFailure = $derived(failure?.action === 'rotate' ? failure : null);
	const pageFailure = $derived(failure?.action === 'revoke' ? failure : null);

	const superAdmin = $derived(data.user.roles.includes('super_admin'));
	const tokens = $derived(data.tokens.ok ? data.tokens.value : []);
	const tenants = $derived(data.tenants.ok ? data.tenants.value : []);
	const successors = $derived(replacedIds(tokens));
	const now = new Date();
	const statusOf = (t: AdminToken): TokenStatus => tokenStatus(t, successors, now);

	// Which confirmation the engine asks for. A refusal that names the code
	// switches it, which covers an MFA status the load could not read.
	// svelte-ignore state_referenced_locally
	let mfa = $state(data.mfaEnrolled || !!asFailure(form)?.needsMfa);
	let secret = $state('');

	// The token lives in this variable and nowhere else: not in the URL, not in
	// `form` (which outlives the dialog until the next submit), not in storage.
	// Closing the dialog drops it.
	let issued = $state<Issued | null>(null);
	let oldTokenUntil = $state('');

	/**
	 * A create or a rotate. The success path takes the token out of the result
	 * and reloads the list without applying the result, so the token never
	 * reaches `form`. A refusal goes to `failure`, which the fields read.
	 */
	function issue(close: () => void): SubmitFunction {
		return () =>
			async ({ result }) => {
				secret = '';
				if (result.type === 'success' && result.data && 'issued' in result.data) {
					issued = result.data.issued as Issued;
					failure = null;
					close();
					await invalidateAll();
					return;
				}
				if (result.type === 'failure') {
					const f = asFailure(result.data);
					if (f?.needsMfa) mfa = true;
					failure = f;
					return;
				}
				await applyAction(result);
			};
	}

	// The create drawer.
	let showCreate = $state(false);
	let createKey = $state(0);
	let name = $state('');
	let picked = $state<Record<string, string[]>>({});
	let ipText = $state('');
	// Empty sends no tenant, and the engine binds the token to the tenant the
	// session acts in. The session does not say which one that is.
	let tenant = $state('');
	let createExpiryValid = $state(true);
	const groups = $derived(groupGrants(data.grants.ok ? data.grants.value : []));
	const pickedCount = $derived(Object.values(picked).reduce((n, list) => n + list.length, 0));
	const ipProblem = $derived(allowedIPsProblem(ipText));
	const tenantOptions = $derived([
		{ value: '', label: 'Your current tenant' },
		...tenants.map((t) => ({ value: t.slug, label: t.name && t.name !== t.slug ? `${t.name} (${t.slug})` : t.slug })),
	]);

	function openCreate() {
		name = '';
		picked = {};
		ipText = '';
		secret = '';
		tenant = '';
		failure = null;
		createKey += 1;
		showCreate = true;
	}
	const create = tracked(issue(() => (showCreate = false)));

	// The rotate dialog.
	let rotating = $state<AdminToken | null>(null);
	let rotateKey = $state(0);
	let rotateExpiryValid = $state(true);
	function openRotate(t: AdminToken) {
		secret = '';
		failure = null;
		rotateKey += 1;
		rotating = t;
		const overlap = Date.now() + 7 * 24 * 60 * 60 * 1000;
		oldTokenUntil = new Date(Math.min(new Date(t.expires_at).getTime(), overlap)).toISOString();
	}
	const rotate = tracked(
		issue(() => {
			rotating = null;
		})
	);

	/** Revoking asks first and names the token, then the row stays as revoked. */
	function revokeToken(t: AdminToken): SubmitFunction {
		return async ({ cancel, formData }) => {
			const ok = await confirmDialog(
				`Revoke token ${t.name} (lyat_${t.display_prefix})?`,
				'Anything calling the admin API with it is refused from now on. The token stays listed as revoked and cannot be used again.',
				{ confirmLabel: 'Revoke' }
			);
			if (!ok) {
				cancel();
				return;
			}
			formData.set(CONFIRM_FIELD, CONFIRMED);
			return async ({ result }) => {
				if (result.type === 'success') {
					failure = null;
					toast.success(`Revoked ${t.name}`);
					await invalidateAll();
					return;
				}
				if (result.type === 'failure') {
					failure = asFailure(result.data);
					return;
				}
				await applyAction(result);
			};
		};
	}

	// The request log drawer, named by the URL so the load reads it.
	const logToken = $derived(data.log ? (tokens.find((t) => t.id === data.log?.token) ?? null) : null);
	function closeLog() {
		const next = new URL(page.url);
		next.searchParams.delete('log');
		next.searchParams.delete('log_offset');
		goto(`${next.pathname}${next.search}`, { noScroll: true, keepFocus: true });
	}
	function logHref(id: string, offset = 0): string {
		const next = new URL(page.url);
		next.searchParams.set('log', id);
		if (offset > 0) next.searchParams.set('log_offset', String(offset));
		else next.searchParams.delete('log_offset');
		return `${next.pathname}${next.search}`;
	}

	// The endpoint takes no search, so the box narrows the page on screen.
	let query = $state('');
	let status = $state('');
	const STATUSES = [
		{ value: '', label: 'All' },
		{ value: 'active', label: 'Active' },
		{ value: 'replaced', label: 'Replaced' },
		{ value: 'expired', label: 'Expired' },
		{ value: 'revoked', label: 'Revoked' },
	];
	const visible = $derived(
		tokens.filter(
			(t) =>
				narrows(query, t.name, t.display_prefix, t.owner_email ?? '', t.grants.join(' ')) &&
				(status === '' || statusOf(t) === status)
		)
	);

	const isOwner = (t: AdminToken) => t.owner_user_id === data.user.id;
</script>

<PageShell
	title="Admin tokens"
	description="Create scoped credentials for scripts and CI jobs that call the admin API. Each one expires within {MAX_TOKEN_DAYS} days."
	width="wide"
>
	{#snippet actions()}
		{#if data.tokens.ok}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New token
			</Button>
		{/if}
	{/snippet}

	<FormErrors message={pageFailure?.error} />

	{#if !data.tokens.ok}
		<GateNotice level={2} gate={data.tokens.gate} title="Admin tokens" absent="Admin tokens are not included in this build." />
	{:else if tokens.length === 0}
		<EmptyState
			level={2}
			title="No admin tokens yet"
			description="Create a token to let a script or CI job call the admin API with only the grants you choose. Tokens expire within {MAX_TOKEN_DAYS} days."
		>
			{#snippet iconSnippet()}
				<KeySquare size={ICON.lg} />
			{/snippet}
			{#snippet action()}
				<Button variant="secondary" onclick={openCreate}>
					<Plus size={ICON.sm} /> New token
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<ListToolbar label="Filter admin tokens">
			{#snippet search()}
				<label for="token-search" class="sr-only">Search this page</label>
				<SearchInput id="token-search" bind:value={query} placeholder="Name, prefix, owner or grant on this page" />
			{/snippet}
			{#snippet filters()}
				<FilterChips label="Status" bind:value={status} options={STATUSES} />
			{/snippet}
		</ListToolbar>

		{#if visible.length === 0}
			<EmptyState
				level={2}
				title="No tokens on this page match these filters"
				description="Clear the search and the status filter, or go to another page."
			/>
		{:else}
			<Table label="Admin tokens">
				<thead>
					<tr>
						<th scope="col">Name and prefix</th>
						{#if superAdmin}<th scope="col">Owner</th>{/if}
						<th scope="col">Grants</th>
						<th scope="col">Allowed addresses</th>
						<th scope="col">Expires</th>
						<th scope="col">Last used</th>
						<th scope="col">Status</th>
						<th scope="col" class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each visible as t (t.id)}
						{@const st = statusOf(t)}
						{@const tone = expiryTone(t.expires_at, now)}
						<tr>
							<td data-cell="nowrap">
								<span class="block font-medium">{t.name}</span>
								<span class="block font-mono text-xs text-muted">lyat_{t.display_prefix}</span>
							</td>
							{#if superAdmin}
								<td data-cell="nowrap" class="text-xs text-muted">
									{isOwner(t) ? 'You' : t.owner_email || t.owner_user_id}
								</td>
							{/if}
							<td>
								<div class="flex flex-wrap gap-1">
									{#each t.grants as g (g)}
										<Badge size="sm" tone="brand"><span class="font-mono">{g}</span></Badge>
									{/each}
								</div>
							</td>
							<td class="font-mono text-xs text-muted">
								{#if t.allowed_ips && t.allowed_ips.length > 0}
									{#each t.allowed_ips as ip (ip)}<span class="block whitespace-nowrap">{ip}</span>{/each}
								{:else}
									<span class="font-sans text-faint">Any</span>
								{/if}
							</td>
							<td data-cell="nowrap" class="text-xs">
								{#if st === 'revoked'}
									<span class="text-faint">{formatDate(t.expires_at)}</span>
								{:else}
									<span class={tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-fg'}>
										{expiryDistance(t.expires_at, now)}
									</span>
									<span class="block text-faint">{formatDateTime(t.expires_at)}</span>
								{/if}
							</td>
							<td data-cell="nowrap" class="text-xs text-muted">
								{#if t.last_used_at}
									<span title={formatDateTime(t.last_used_at)}>{relativeTime(t.last_used_at, now)}</span>
								{:else}
									<span class="text-faint">Never</span>
								{/if}
							</td>
							<td data-cell="nowrap">
								<Badge tone={STATUS_TONE[st]} dot>{STATUS_LABEL[st]}</Badge>
							</td>
							<td>
								<div class="flex justify-end gap-1">
									<Button variant="ghost" size="sm" href={logHref(t.id)} aria-label="Request log of {t.name}">
										<ScrollText size={ICON.sm} />
									</Button>
									{#if st === 'active' && isOwner(t)}
										<Button variant="ghost" size="sm" onclick={() => openRotate(t)} aria-label="Rotate {t.name}">
											<RefreshCw size={ICON.sm} />
										</Button>
									{/if}
									{#if (st === 'active' || st === 'replaced') && (isOwner(t) || superAdmin)}
										<form method="POST" action="?/revoke" use:enhance={revokeToken(t)}>
											<input type="hidden" name="id" value={t.id} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Revoke {t.name}">
												<Ban size={ICON.sm} class="text-danger" />
											</Button>
										</form>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
		<Pagination
			page={pageNumber(data.offset, data.limit)}
			perPage={data.limit}
			count={tokens.length}
			total={data.total}
			noun="tokens"
			href={pageHref('/admin/admin-tokens', data.limit)}
		/>
	{/if}
</PageShell>

<Drawer bind:open={showCreate} title="New admin token" description="The token acts as you, limited to the grants you choose.">
	{#key createKey}
		<form method="POST" action="?/create" id="token-form" use:enhance={create.enhance} class="flex flex-col gap-5">
			<FormErrors message={createFailure?.error} fields={createFailure?.fields} />

			<Input
				id="token-name"
				label="Name"
				name="name"
				required
				bind:value={name}
				placeholder="ci-deploy"
				hint="Name what uses this token, so you can tell tokens apart."
				error={createFailure?.fields.name}
			/>

			<section class="flex flex-col gap-3" aria-labelledby="token-grants-label">
				<div class="flex flex-col gap-1">
					<p id="token-grants-label" class="text-sm font-medium text-fg">Grants</p>
					<p class="text-xs text-muted">
						A token can call only the routes its grants cover. Everything else, including users, keys and settings, needs a signed-in session.
					</p>
					{#if createFailure?.fields.grants}
						<p class="text-xs text-danger" role="alert">{createFailure.fields.grants}</p>
					{/if}
				</div>
				{#if !data.grants.ok}
					<GateNotice gate={data.grants.gate} title="Grants" absent="No grants are available, so you cannot create a token." />
				{/if}
				<div class="grid gap-4 sm:grid-cols-2">
					{#each groups as group (group.id)}
						{@const routes = group.grants.flatMap((g) => g.routes.map((r) => ({ grant: g.name, ...r })))}
						<Panel pad="sm">
							<div class="flex flex-col gap-2">
								<CheckboxGroup
									name="grants"
									label={group.label}
									options={group.grants.map((g) => ({ value: g.name, label: g.name, description: g.description }))}
									bind:value={() => picked[group.id] ?? [], (v) => (picked = { ...picked, [group.id]: v })}
								/>
								<Collapsible label="Routes" badge={routes.length}>
									{#if routes.length === 0}
										<p class="text-xs text-faint">No routes use these grants yet.</p>
									{:else}
										<ul class="flex flex-col gap-1">
											{#each routes as r (r.grant + r.method + r.pattern)}
												<li class="font-mono text-xs text-muted">
													<span class="text-fg">{r.method}</span> {r.pattern}
												</li>
											{/each}
										</ul>
									{/if}
								</Collapsible>
							</div>
						</Panel>
					{/each}
				</div>
			</section>

			<TokenExpiryField id="token-expiry" error={createFailure?.fields.expires_at} bind:valid={createExpiryValid} />

			<Textarea
				id="token-ips"
				name="allowed_ips"
				label="Allowed addresses"
				bind:value={ipText}
				rows={3}
				mono
				placeholder={'203.0.113.7\n198.51.100.0/24'}
				hint="One IP address or CIDR range per line. Leave it empty to accept the token from any address."
				error={createFailure?.fields.allowed_ips ?? (ipProblem || undefined)}
			/>

			{#if superAdmin && !data.tenants.ok}
				<Alert tone="warn" title="Could not load the tenants">
					The token will act in your current tenant. Reload the page to choose another.
				</Alert>
			{:else if superAdmin && tenants.length > 1}
				<Select
					id="token-tenant"
					name="tenant_id"
					label="Tenant"
					searchable
					bind:value={tenant}
					options={tenantOptions}
					hint="The token acts in this tenant only."
					error={createFailure?.fields.tenant_id}
				/>
			{/if}

			<StepUpField id="token-step" {mfa} bind:value={secret} error={createFailure?.fields.password ?? createFailure?.fields.mfa_code} />
		</form>
	{/key}
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (showCreate = false)}>Cancel</Button>
		<Button
			variant="primary"
			type="submit"
			form="token-form"
			disabled={!name.trim() || pickedCount === 0 || !createExpiryValid || !!ipProblem || !secret}
			loading={create.pending}
		>
			Create
		</Button>
	{/snippet}
</Drawer>

{#if rotating}
	<!-- A drawer like the create form: rotating asks for an expiry and the
	     step-up, and a form of several fields reads as one panel here. -->
	<Drawer
		open
		title="Rotate {rotating.name}"
		description="A new token replaces this one, with the same grants and addresses. The old token keeps working until {formatDateTime(oldTokenUntil)}, seven days at most, so a deployment can switch without a gap."
		onclose={() => (rotating = null)}
	>
		{#key rotateKey}
			<form method="POST" action="?/rotate" id="rotate-form" use:enhance={rotate.enhance} class="flex flex-col gap-4">
				<FormErrors message={rotateFailure?.error} fields={rotateFailure?.fields} />
				<input type="hidden" name="id" value={rotating.id} />
				<TokenExpiryField id="rotate-expiry" error={rotateFailure?.fields.expires_at} bind:valid={rotateExpiryValid} />
				<StepUpField id="rotate-step" {mfa} bind:value={secret} error={rotateFailure?.fields.password ?? rotateFailure?.fields.mfa_code} />
			</form>
		{/key}
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (rotating = null)}>Cancel</Button>
			<Button variant="primary" type="submit" form="rotate-form" disabled={!rotateExpiryValid || !secret} loading={rotate.pending}>
				Rotate
			</Button>
		{/snippet}
	</Drawer>
{/if}

{#if issued}
	<Modal open title={issued.rotated ? `Rotated ${issued.name}` : `Token ${issued.name} issued`} onclose={() => (issued = null)}>
		<div class="flex flex-col gap-4">
			<Alert tone="warn" title="Copy it now">
				It is not shown again. Store it where the script that uses it runs, such as a CI secret.
			</Alert>
			<CopyField id="issued-token" label="Admin token" value={issued.token} secret copyLabel="Copy the token" />
			<p class="text-xs text-muted">
				It expires {formatDateTime(issued.expires_at)}.
				{#if issued.rotated}The token it replaces stops working by {formatDateTime(oldTokenUntil)}.{/if}
			</p>
			<CopyField
				id="issued-example"
				label="Try it"
				value={curlExample(data.adminOrigin)}
				hint="Set LYEVE_ADMIN_TOKEN to the token first. This lists the content types if the token has schemas:read."
				copyLabel="Copy the example"
			/>
		</div>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (issued = null)}>Close</Button>
		{/snippet}
	</Modal>
{/if}

{#if data.log}
	{@const log = data.log}
	<Drawer open title="Request log" description={logToken ? `${logToken.name} (lyat_${logToken.display_prefix})` : undefined} size="xl" onclose={closeLog}>
		{#if log.gate}
			<GateNotice gate={log.gate} title="Request log" absent="This token does not exist, or you cannot view it." />
		{:else if log.rows.length === 0}
			<EmptyState title="No requests yet" description="Calls made with this token appear here, including refused ones." />
		{:else}
			<div class="flex flex-col gap-3">
				<Table label="Requests made with this token">
					<thead>
						<tr>
							<th scope="col">Time</th>
							<th scope="col">Method</th>
							<th scope="col">Route</th>
							<th scope="col">Status</th>
							<th scope="col">Address</th>
						</tr>
					</thead>
					<tbody>
						{#each log.rows as r (r.id)}
							{@const dropped = droppedCount(r)}
							<tr>
								<td data-cell="nowrap" class="text-xs text-muted">{formatDateTime(r.created_at)}</td>
								{#if dropped !== null}
									<td colspan="4" class="text-xs text-warn">
										{formatCount(dropped)} {plural(dropped, 'request')} not logged (the log queue was full)
									</td>
								{:else}
									<td data-cell="nowrap" class="font-mono text-xs">{r.method}</td>
									<td data-cell="nowrap" class="font-mono text-xs text-muted">{r.route_pattern || '-'}</td>
									<td data-cell="nowrap"><Badge size="sm" tone={requestStatusTone(r.status)}>{r.status}</Badge></td>
									<td data-cell="nowrap" class="font-mono text-xs text-muted">{r.client_ip}</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(log.offset, log.limit)}
					perPage={log.limit}
					count={log.rows.length}
					total={log.total}
					noun="requests"
					href={(p) => logHref(log.token, (p - 1) * log.limit)}
				/>
			</div>
		{/if}
	</Drawer>
{/if}
