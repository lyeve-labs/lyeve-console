<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		PasswordInput,
		RadioGroup,
		SearchInput,
		SectionHeading,
		Select,
		Stat,
		Table,
		Toggle,
		toast,
		Pagination,
		CopyField,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { confirmed, drawerFailure, tracked } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { KeyRound, Plus, RefreshCw, Trash2 } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { narrows } from '$lib/narrow';
	import {
		MIN_TOKEN_LENGTH,
		SCIM_BASE_PATH,
		deprovisionLabel,
		deprovisionTone,
		type ScimProvider,
	} from '$lib/api/scim';
	import { formatDateTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The create and rotate drawers each show their own failure, and the rest
	// show above the list.
	type Failure = { error?: string; action?: string } | null;
	const failure = drawerFailure(() => form as Failure, ['create', 'rotate']);
	const failedIn = (action: string) => (failure.drawer?.action === action ? failure.drawer.error : undefined);

	// An admin may read the connections. Every write is the super admin's, so an
	// admin is shown the list and no control that would only be refused.
	const canWrite = $derived(data.user.roles.includes('super_admin'));

	// The endpoint takes no search, so the box narrows the page on screen and
	// the pager below still walks every connection.
	let query = $state('');
	const visible = $derived(data.providers.filter((p) => narrows(query, p.name)));

	const DEPROVISION_OPTIONS = [
		{
			value: 'disable',
			label: 'Disable the account',
			description: 'The account stays, with its history, and can no longer sign in.',
		},
		{
			value: 'delete',
			label: 'Delete the account',
			description: 'The account and its history are removed. This cannot be undone.',
		},
	];

	let creating = $state(false);
	let name = $state('');
	let token = $state('');
	let action = $state('disable');
	let samlProvider = $state('');
	const samlOptions = $derived([
		{ value: '', label: 'None' },
		...(data.saml?.state === 'ok' ? data.saml.providers.map((p) => ({ value: p.id, label: p.name })) : []),
	]);

	// One rotation panel at a time, keyed by the connection it belongs to. The
	// token is write-only, so this is a field with no current value to show.
	let rotating = $state<ScimProvider | null>(null);
	let newToken = $state('');

	function openCreate() {
		name = '';
		token = '';
		action = 'disable';
		samlProvider = '';
		failure.opened();
		creating = true;
	}

	function openRotate(p: ScimProvider) {
		failure.opened();
		rotating = p;
		newToken = '';
	}

	const saveConnection: SubmitFunction = () => {
		const subject = name;
		return async ({ result, update }) => {
			if (result.type !== 'failure') creating = false;
			await update();
			if (result.type === 'success') toast.success(`Created ${subject}`);
		};
	};

	const saveToken: SubmitFunction = () => {
		const subject = rotating?.name ?? '';
		return async ({ result, update }) => {
			if (result.type !== 'failure') rotating = null;
			await update();
			if (result.type === 'success') toast.success(`Rotated the token for ${subject}`);
		};
	};

	/**
	 * Removing a connection stops the identity provider from provisioning at
	 * all. Nothing happens to the accounts it already created, which is worth
	 * saying: an operator expecting a cleanup would otherwise get none.
	 */
	function removeConnection(p: ScimProvider): SubmitFunction {
		return confirmed(
			`Delete SCIM connection ${p.name}?`,
			'The identity provider stops being able to create or remove accounts here. Accounts it already created are left as they are.',
			{ confirmLabel: 'Delete', success: `${p.name} deleted.` },
		);
	}

	const saveConnectionSubmit = tracked(saveConnection);
	const saveTokenSubmit = tracked(saveToken);
</script>

<PageShell
	title="SCIM provisioning"
	description="Let identity providers create and remove accounts here without anyone signing in."
	width="wide"
>
	{#snippet actions()}
		{#if data.gate.state === 'ok' && canWrite}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New connection
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="SCIM provisioning"
			absent="SCIM provisioning is not included in this build."
		/>
	{:else}
		{#if failure.page?.error}
			<Alert tone="danger">{failure.page.error}</Alert>
		{/if}
		{#if !canWrite}
			<Alert tone="brand">Only a super admin can add or remove a connection, or rotate its token.</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-2">
			<Stat size="sm" mono label="Connections" value={data.providers.length} />
		</div>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Where the directory sends its requests</SectionHeading>
			<CopyField label="Base path" labelHidden value={SCIM_BASE_PATH} copyLabel="Copy base path" />
			<p class="text-xs text-muted">
				Give the directory this path, added to this engine's URL, and the bearer token from a connection below. The token is the only authentication these endpoints use.
			</p>
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Connections</SectionHeading>

			{#if data.providers.length === 0}
				<EmptyState
					title="No connections yet"
					description={canWrite ? 'Add a connection to let an identity provider manage accounts here.' : 'Ask a super admin to add a connection, which lets an identity provider manage accounts here.'}
				>
					{#snippet iconSnippet()}
						<KeyRound size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						{#if canWrite}
							<Button variant="secondary" onclick={openCreate}>
								<Plus size={ICON.sm} /> New connection
							</Button>
						{/if}
					{/snippet}
				</EmptyState>
			{:else}
				<ListToolbar label="Filter connections">
					{#snippet search()}
						<label for="scim-search" class="sr-only">Search this page</label>
						<SearchInput id="scim-search" bind:value={query} placeholder="Connection name on this page" />
					{/snippet}
				</ListToolbar>
				{#if visible.length === 0}
					<EmptyState
						title="No connections match this search"
						description="The search covers this page only. Clear it, or go to the next page."
					/>
				{:else}
					<Table label="Connections">
						<thead>
							<tr>
								<th scope="col">Connection</th>
								<th scope="col">Deprovisioned accounts are</th>
								<th scope="col">Created</th>
								<th scope="col"><span class="sr-only">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{#each visible as p (p.id)}
								<tr>
									<td data-cell="nowrap">
										<div class="flex items-center gap-2">
											<span class="font-medium text-fg">{p.name}</span>
											<Badge tone={p.enabled ? 'success' : 'neutral'} dot>
												{p.enabled ? 'Enabled' : 'Disabled'}
											</Badge>
										</div>
									</td>
									<td data-cell="nowrap">
										<Badge tone={deprovisionTone(p)}>{deprovisionLabel(p)}</Badge>
									</td>
									<td data-cell="nowrap" class="text-xs text-faint">
										{formatDateTime(p.created_at)}
									</td>
									<td data-cell="nowrap">
										{#if canWrite}
											<div class="flex items-center justify-end gap-1">
												<Button
													variant="ghost"
													size="sm"
													aria-label="Rotate the token for {p.name}"
													title="Rotate token"
													onclick={() => openRotate(p)}
												>
													<RefreshCw size={ICON.sm} />
												</Button>
												<form method="POST" action="?/delete" use:enhance={removeConnection(p)}>
													<input type="hidden" name="id" value={p.id} />
													<Button
														variant="ghost"
														size="sm"
														type="submit"
														aria-label="Delete {p.name}"
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
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.providers.length}
					total={data.total ?? undefined}
					hasNext={data.hasMore}
					noun="connections"
					href={pageHref('/admin/settings/scim', data.limit)}
				/>
			{/if}
		</section>
	{/if}
</PageShell>

<Drawer bind:open={creating} title="New connection">
	<form id="scim-connection-form" method="POST" action="?/create" use:enhance={saveConnectionSubmit.enhance}>
		<div class="flex flex-col gap-4">
			<!-- A refused save keeps the drawer open, so the reason has to be in
			     it and not behind the panel on the page. -->
			<FormErrors message={failedIn('create')} />
			<Input
				id="scim-name"
				name="name"
				label="Name"
				hint="Which directory this is. It is shown only on this screen."
				bind:value={name}
				required
			/>
			<PasswordInput
				id="scim-token"
				name="bearer_token"
				label="Bearer token"
				hint="At least {MIN_TOKEN_LENGTH} characters. It is stored as a hash, so you cannot see it again. Copy it into the directory now."
				bind:value={token}
				required
			/>
			<!-- The engine has no way to change the link later, so the hint says
			     what changing it takes. -->
			{#if data.saml?.state === 'ok'}
				<Select
					id="scim-saml"
					name="saml_provider_id"
					label="SAML provider"
					bind:value={samlProvider}
					options={samlOptions}
					hint="Sign-in through this provider uses this connection's attribute mapping. The link is set when the connection is created. To change it, create a new connection and remove this one."
				/>
			{:else if data.saml?.state === 'failed'}
				<Alert tone="warn">Could not load the SAML providers, so you cannot link one now. Reload the page to try again.</Alert>
			{/if}
			<RadioGroup
				name="deprovision_action"
				label="When the directory removes somebody"
				bind:value={action}
				options={DEPROVISION_OPTIONS}
			/>
			<!-- The plugin acts on every removal whatever this field says, so the
			     switch shows that fact rather than offering a choice that does
			     nothing. The field still says true, which is what gets stored. -->
			<input type="hidden" name="deprovision_on_delete" value="true" />
			<Toggle
				id="scim-deprovision"
				label="Act on removals"
				hint="Always on. When a directory deletes a person, the account is handled the way you chose above. Okta and Microsoft Entra mark the person inactive instead, which always disables the account, whatever you chose."
				checked={true}
				disabled
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (creating = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="scim-connection-form" loading={saveConnectionSubmit.pending}>Create</Button>
	{/snippet}
</Drawer>

<Drawer
	open={rotating !== null}
	onclose={() => (rotating = null)}
	title={rotating ? `Rotate the token for ${rotating.name}` : 'Rotate token'}
>
	<form id="scim-rotate-form" method="POST" action="?/rotate" use:enhance={saveTokenSubmit.enhance}>
		<input type="hidden" name="id" value={rotating?.id ?? ''} />
		<div class="flex flex-col gap-4">
			<FormErrors message={failedIn('rotate')} />
			<Alert tone="warn">
				The old token stops working as soon as the new one is saved. Provisioning fails until you update the directory with the new token.
			</Alert>
			<PasswordInput
				id="scim-new-token"
				name="new_token"
				label="New bearer token"
				hint="At least {MIN_TOKEN_LENGTH} characters."
				bind:value={newToken}
				required
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (rotating = null)}>Cancel</Button>
		<Button variant="primary" type="submit" form="scim-rotate-form" loading={saveTokenSubmit.pending}>Save</Button>
	{/snippet}
</Drawer>
