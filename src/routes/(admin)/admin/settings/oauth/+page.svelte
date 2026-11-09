<script lang="ts">
	import { formRefusal } from '$lib/api/refusal';
	import {
		Badge,
		Button,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		PasswordInput,
		SearchInput,
		SectionHeading,
		Stat,
		Table,
		Toggle,
		toast,
	} from '@lyeve-labs/ui-kit';
	import type { PageData, ActionData } from './$types';
	import type { OAuthProvider } from '@lyeve-labs/client';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { confirmed, drawerFailure, tracked } from '$lib/forms.svelte';
	import { KeyRound, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The drawer shows a failed save, and a failed delete shows above the list.
	type Failure = { error?: string; action?: string } | null;
	const failure = drawerFailure(() => form as Failure, ['create', 'update']);

	// One drawer for both writes: a null target is a new provider.
	let open = $state(false);
	let editing = $state<OAuthProvider | null>(null);

	/** The provider name as the list shows it, rather than its stored form. */
	const providerLabel = (name: string) => name.replace(/_/g, ' ');

	const providers = $derived(data.providers.ok ? data.providers.value : []);
	const enabledCount = $derived(providers.filter((p) => p.enabled).length);
	let narrow = $state('');
	const visible = $derived(
		narrow.trim()
			? providers.filter((p) =>
					[p.name, p.issuer_url, p.client_id].some((v) => v.toLowerCase().includes(narrow.trim().toLowerCase())),
				)
			: providers,
	);

	/**
	 * Removing a provider ends every sign-in that goes through it, so the card
	 * asks first and names the provider. enhance awaits this before it sends
	 * anything, so canceling here means the request is never made.
	 */
	function deleteProvider(name: string): SubmitFunction {
		return confirmed(
			`Delete provider ${providerLabel(name)}?`,
			'People who sign in through it can no longer sign in this way.',
			{ confirmLabel: 'Delete', success: `${providerLabel(name)} deleted.` },
		);
	}

	let name = $state('');
	let clientId = $state('');
	let clientSecret = $state('');
	let issuerUrl = $state('');
	let scopes = $state('');
	let rolesClaim = $state('');
	let defaultRoles = $state('');
	let enabled = $state(false);

	function openCreate() {
		editing = null;
		name = '';
		clientId = '';
		clientSecret = '';
		issuerUrl = '';
		scopes = 'openid, email, profile';
		rolesClaim = 'roles';
		defaultRoles = 'editor';
		enabled = false;
		failure.opened();
		open = true;
	}

	function openEdit(p: OAuthProvider) {
		editing = p;
		name = p.name;
		clientId = p.client_id;
		clientSecret = '';
		issuerUrl = p.issuer_url;
		scopes = p.scopes.join(', ');
		rolesClaim = p.roles_claim;
		defaultRoles = p.default_roles.join(', ');
		enabled = p.enabled;
		failure.opened();
		open = true;
	}

	/** Closes the drawer once the write lands. A failure keeps it open beside the message. */
	const saveProvider: SubmitFunction = () => {
		const subject = providerLabel(name);
		const verb = editing ? 'Updated' : 'Created';
		return async ({ result, update }) => {
			if (result.type !== 'failure') open = false;
			await update();
			if (result.type === 'success') toast.success(`${verb} ${subject}`);
		};
	};

	const saveProviderSubmit = tracked(saveProvider);
</script>

<PageShell
	title="OAuth providers"
	description="Set up the OpenID Connect and OAuth 2.0 providers people can sign in with."
	width="wide"
>
	{#snippet actions()}
		{#if data.providers.ok}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New provider
			</Button>
		{/if}
	{/snippet}

	<FormErrors message={failure.page?.error ?? ''} refused={formRefusal(failure.page)} />

	{#if data.providers.ok}
		<div class="grid gap-4 sm:grid-cols-3">
			<Stat size="sm" mono label="Providers" value={providers.length} />
			<Stat size="sm" mono label="Enabled" value={enabledCount} />
		</div>
	{/if}

	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>Providers</SectionHeading>
		{#if !data.providers.ok}
			<GateNotice gate={data.providers.gate} title="OAuth providers" absent="OAuth sign-in is not included in this build." />
		{:else if providers.length === 0}
			<EmptyState
				title="No OAuth providers yet"
				description="Add an OpenID Connect provider to offer single sign-on on the sign-in page."
			>
				{#snippet iconSnippet()}
					<KeyRound size={ICON.lg} />
				{/snippet}
				{#snippet action()}
					<Button variant="secondary" onclick={openCreate}>
						<Plus size={ICON.sm} /> New provider
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<ListToolbar label="Filter providers">
				{#snippet search()}
					<label for="oauth-search" class="sr-only">Search providers</label>
					<SearchInput id="oauth-search" bind:value={narrow} placeholder="Name, issuer or client ID" />
				{/snippet}
			</ListToolbar>

			{#if visible.length === 0}
				<EmptyState
					title="No providers match this search"
					description="The search covers each provider's name, issuer and client ID."
				/>
			{:else}
				<Table label="Providers">
					<thead>
						<tr>
							<th scope="col">Provider</th>
							<th scope="col">Issuer</th>
							<th scope="col">Scopes</th>
							<th scope="col">Roles</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each visible as provider (provider.id)}
							<tr>
								<td data-cell="nowrap">
									<div class="flex items-center gap-2">
										<span class="font-medium text-fg">{providerLabel(provider.name)}</span>
										<Badge tone={provider.enabled ? 'success' : 'neutral'} dot>
											{provider.enabled ? 'Enabled' : 'Disabled'}
										</Badge>
									</div>
									<div class="font-mono text-xs text-faint">/api/admin/auth/oauth/{provider.name}</div>
								</td>
								<td class="max-w-xs truncate text-xs text-muted" title={provider.issuer_url}>
									{provider.issuer_url}
								</td>
								<td class="text-xs text-muted">{provider.scopes.join(', ')}</td>
								<td class="text-xs text-muted">
									<span class="font-mono">{provider.roles_claim}</span>, default
									{provider.default_roles.join(', ')}
								</td>
								<td data-cell="nowrap">
									<div class="flex items-center justify-end gap-1">
										<Button
											variant="ghost"
											size="sm"
											aria-label="Edit {provider.name}"
											onclick={() => openEdit(provider)}
										>
											<Pencil size={ICON.sm} />
										</Button>
										<form method="POST" action="?/delete" use:enhance={deleteProvider(provider.name)}>
											<input type="hidden" name="id" value={provider.id} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Delete {provider.name}">
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
		{/if}
	</section>
</PageShell>

<Drawer bind:open title={editing ? `Edit ${providerLabel(editing.name)}` : 'New provider'}>
	<form
		method="POST"
		action={editing ? '?/update' : '?/create'}
		id="provider-form"
		use:enhance={saveProviderSubmit.enhance}
		class="flex flex-col gap-4"
	>
		<!-- A refused save keeps the drawer open, so the reason has to be in it
		     and not behind the panel on the page. -->
		<FormErrors message={failure.drawer?.error} refused={formRefusal(failure.drawer)} />
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
		<Input
			id="provider-name"
			name="name"
			label="Provider name"
			required
			bind:value={name}
			placeholder="google"
			hint="Lowercase slug used in the sign-in URL. google gives /api/admin/auth/oauth/google."
		/>
		<Input
			id="provider-issuer"
			name="issuer_url"
			label="Issuer URL"
			required
			bind:value={issuerUrl}
			placeholder="https://accounts.google.com"
		/>
		<Input id="provider-client-id" name="client_id" label="Client ID" required bind:value={clientId} />
		<!-- The hint, not a placeholder: a placeholder is gone the moment the
		     operator types, which is exactly when the difference between an
		     intended blank and a stray keystroke starts to matter. -->
		<PasswordInput
			id="provider-client-secret"
			name="client_secret"
			label={editing ? 'New client secret' : 'Client secret'}
			required={!editing}
			hint={editing ? 'Leave blank to keep the current secret.' : undefined}
			bind:value={clientSecret}
		/>
		<Input id="provider-scopes" name="scopes" label="Scopes" hint="Comma separated." bind:value={scopes} />
		<Input
			id="provider-roles-claim"
			name="roles_claim"
			label="Roles claim"
			bind:value={rolesClaim}
			placeholder="roles"
		/>
		<Input
			id="provider-default-roles"
			name="default_roles"
			label="Default roles"
			hint="Comma separated."
			bind:value={defaultRoles}
			placeholder="editor"
		/>
		<div>
			<!-- Toggle renders a button, and a button submits nothing. The state
			     reaches the action through this field, and the action reads the
			     absent case as true, so an unchecked box has to say so explicitly. -->
			<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
			<Toggle id="provider-enabled" bind:checked={enabled} label="Enabled" />
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="provider-form" loading={saveProviderSubmit.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>
