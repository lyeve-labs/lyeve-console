<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		CopyButton,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		SearchInput,
		SectionHeading,
		Select,
		Stat,
		Table,
		Textarea,
		Toggle,
		toast,
		Pagination,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { confirmed, drawerFailure, tracked } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import {
		certTone,
		expiryLabel,
		metadataPath,
		providerHealth,
		signInPath,
		type SamlProvider,
	} from '$lib/api/saml';
	import { NO_VALUE, formatDate } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The drawer shows a failed save, and the rest show above the list.
	type Failure = { error?: string; action?: string } | null;
	const failure = drawerFailure(() => form as Failure, ['create', 'update']);

	// An admin may read the providers. Every write is the super admin's, so an
	// admin is shown the list and no control that would only be refused.
	const canWrite = $derived(data.user.roles.includes('super_admin'));

	let narrow = $state('');
	const visible = $derived(
		narrow.trim()
			? data.providers.filter((p) =>
					`${p.name} ${p.entity_id}`.toLowerCase().includes(narrow.trim().toLowerCase()),
				)
			: data.providers,
	);

	const enabledCount = $derived(data.providers.filter((p) => p.enabled).length);
	// A certificate nobody renews takes the instance down on a date. This is the
	// number that should make somebody act, so it counts expired ones too.
	const needingAttention = $derived(
		data.providers.filter((p) => providerHealth(p) === 'expired' || providerHealth(p) === 'expiring')
			.length,
	);
	const staged = $derived(data.providers.filter((p) => !!p.sp_cert_next));

	// One drawer for both writes: a null target is a new provider.
	let open = $state(false);
	let editing = $state<SamlProvider | null>(null);

	let name = $state('');
	let entityId = $state('');
	let ssoUrl = $state('');
	let sloUrl = $state('');
	let idpCert = $state('');
	let nameIdFormat = $state('');
	let attributes = $state('');
	let wantAssertionsSigned = $state(true);
	let wantResponseSigned = $state(true);
	let signAuthnRequests = $state(true);
	let encryptAssertions = $state(false);
	let enabled = $state(true);

	const EMAIL_NAME_ID = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';

	// A template fills the settings a vendor usually takes. What names the
	// customer's own account with the vendor stays theirs to paste.
	let templateKey = $state('');
	let certHint = $state('');
	const templates = $derived(data.templates ?? []);
	const templateOptions = $derived([
		{ value: '', label: 'None' },
		...templates.map((t) => ({ value: t.key, label: t.name })),
	]);
	const chosenTemplate = $derived(templates.find((t) => t.key === templateKey));

	function applyTemplate(key: string) {
		templateKey = key;
		const config = templates.find((t) => t.key === key)?.config;
		certHint = config?.idp_cert_hint ?? '';
		// The settings a template fills start from a new provider's again, so
		// None or another template leaves nothing of the last one behind.
		nameIdFormat = EMAIL_NAME_ID;
		attributes = 'email=email\nroles=groups';
		encryptAssertions = false;
		if (!config) return;
		if (config.entity_id) entityId = config.entity_id;
		if (config.sso_url) ssoUrl = config.sso_url;
		if (config.slo_url) sloUrl = config.slo_url;
		if (config.name_id_format) nameIdFormat = config.name_id_format;
		if (config.attributes_mapping) {
			attributes = Object.entries(config.attributes_mapping)
				.map(([k, v]) => `${k}=${v}`)
				.join('\n');
		}
		encryptAssertions = config.encrypt_assertions ?? false;
	}

	function openCreate() {
		editing = null;
		name = '';
		entityId = '';
		ssoUrl = '';
		sloUrl = '';
		idpCert = '';
		nameIdFormat = EMAIL_NAME_ID;
		attributes = 'email=email\nroles=groups';
		wantAssertionsSigned = true;
		wantResponseSigned = true;
		signAuthnRequests = true;
		encryptAssertions = false;
		enabled = true;
		templateKey = '';
		certHint = '';
		failure.opened();
		open = true;
	}

	function openEdit(p: SamlProvider) {
		editing = p;
		name = p.name;
		entityId = p.entity_id;
		ssoUrl = p.sso_url;
		sloUrl = p.slo_url ?? '';
		// Left empty on purpose: the engine never sends the stored certificate
		// back, and an empty field means "keep it" rather than "clear it".
		idpCert = '';
		nameIdFormat = p.name_id_format;
		attributes = Object.entries(p.attributes_mapping ?? {})
			.map(([k, v]) => `${k}=${v}`)
			.join('\n');
		wantAssertionsSigned = p.want_assertions_signed;
		wantResponseSigned = p.want_response_signed;
		signAuthnRequests = p.sign_authn_requests;
		encryptAssertions = p.encrypt_assertions;
		enabled = p.enabled;
		failure.opened();
		open = true;
	}

	/** Closes the drawer once the write lands. A failure keeps it open beside the message. */
	const saveProvider: SubmitFunction = () => {
		const subject = name;
		const verb = editing ? 'Saved' : 'Created';
		return async ({ result, update }) => {
			if (result.type !== 'failure') open = false;
			await update();
			if (result.type === 'success') toast.success(`${verb} ${subject}`);
		};
	};

	/**
	 * Removing a provider ends every sign-in that goes through it, and there is
	 * no undo: the private key is deleted with the row.
	 */
	function removeProvider(p: SamlProvider): SubmitFunction {
		return confirmed(
			`Delete SAML provider ${p.name}?`,
			'People who sign in through this provider lose access, and its private key is deleted. This cannot be undone.',
			{ confirmLabel: 'Delete', success: `${p.name} deleted.` },
		);
	}

	/**
	 * Promoting is the step that changes what signatures carry, so it asks
	 * first and says what has to be true before it is safe.
	 */
	function promote(p: SamlProvider): SubmitFunction {
		return confirmed(
			`Promote the new certificate for ${p.name}?`,
			'Every request is signed with it from now on. Promote it only after the identity provider trusts the new certificate from the metadata document.',
			{ confirmLabel: 'Promote', success: `${p.name} is using the new certificate` },
		);
	}

	const saveProviderSubmit = tracked(saveProvider);
</script>

<PageShell
	title="SAML SSO"
	description="Set up the identity providers people sign in through, and renew their certificates."
	width="wide"
>
	{#snippet actions()}
		{#if data.gate.state === 'ok' && canWrite}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New provider
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="SAML SSO"
			absent="SAML SSO is not included in this build."
		/>
	{:else}
		{#if failure.page?.error}
			<Alert tone="danger">{failure.page.error}</Alert>
		{/if}
		{#if !canWrite}
			<Alert tone="brand">Only a super admin can add, change or remove an identity provider, or renew its certificate.</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-3">
			<Stat size="sm" mono label="Providers" value={data.providers.length} />
			<Stat size="sm" mono label="Enabled" value={enabledCount} />
			<Stat
				size="sm"
				mono
				label="Certificates to renew"
				value={needingAttention}
				tone={needingAttention > 0 ? 'warn' : 'neutral'}
			/>
		</div>

		{#if staged.length > 0}
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Waiting to be promoted</SectionHeading>
				<p class="text-xs text-muted">
					A new certificate is ready and published in the metadata document beside the current one. Point the identity provider at the metadata URL or give it the certificate below, then promote it. Nothing changes until you promote.
				</p>
				<div class="flex flex-col gap-3">
					{#each staged as p (p.id)}
						<div class="rounded border border-line bg-surface-2 p-3">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<div class="min-w-0">
									<span class="font-medium text-fg">{p.name}</span>
									<span class="ml-2 text-xs text-faint">
										New certificate {expiryLabel(p.sp_cert_next_expires_at).toLowerCase()}
									</span>
								</div>
								<div class="flex items-center gap-2">
									<CopyButton value={p.sp_cert_next ?? ''} label="Copy certificate" />
									{#if canWrite}
										<form method="POST" action="?/rollover" use:enhance={promote(p)}>
											<input type="hidden" name="id" value={p.id} />
											<Button variant="primary" size="sm" type="submit">Promote</Button>
										</form>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Providers</SectionHeading>

			{#if data.providers.length === 0}
				<EmptyState
					title="No identity providers yet"
					description={canWrite ? 'Add one to put a sign-in button on the sign-in page.' : 'Ask a super admin to add one, which puts a sign-in button on the sign-in page.'}
				>
					{#snippet iconSnippet()}
						<KeyRound size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						{#if canWrite}
							<Button variant="secondary" onclick={openCreate}>
								<Plus size={ICON.sm} /> New provider
							</Button>
						{/if}
					{/snippet}
				</EmptyState>
			{:else}
				<ListToolbar label="Filter providers">
					{#snippet search()}
						<label for="saml-search" class="sr-only">Search providers</label>
						<SearchInput id="saml-search" bind:value={narrow} placeholder="Name or entity ID" />
					{/snippet}
				</ListToolbar>

				{#if visible.length === 0}
					<EmptyState
						title="No providers match this search"
						description="The search covers each provider's name and entity ID."
					>
						{#snippet iconSnippet()}
							<ShieldCheck size={ICON.lg} />
						{/snippet}
					</EmptyState>
				{:else}
					<Table label="Providers">
						<thead>
							<tr>
								<th scope="col">Provider</th>
								<th scope="col">Identity provider</th>
								<th scope="col">Our certificate</th>
								<th scope="col">Their certificate</th>
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
										<!-- Under a finger the separator widens, so the two links' hit
										     areas sit apart instead of overlapping on a short link. -->
										<div class="text-xs text-faint">
											<a class="relative hit-area underline" href={metadataPath(p.name)}>Metadata</a>
											<span class="mx-1 coarse:mx-4">·</span>
											<a class="relative hit-area underline" href={signInPath(p.name)}>Test sign-in</a>
										</div>
									</td>
									<td class="max-w-xs truncate text-xs text-faint" title={p.entity_id}>
										{p.entity_id || NO_VALUE}
									</td>
									<td data-cell="nowrap">
										<Badge tone={certTone(providerHealth({ ...p, idp_cert_expires_at: null }))}>
											{formatDate(p.sp_cert_expires_at)}
										</Badge>
										<div class="text-xs text-faint">{expiryLabel(p.sp_cert_expires_at)}</div>
									</td>
									<td data-cell="nowrap">
										<Badge tone={certTone(providerHealth({ ...p, sp_cert_expires_at: null }))}>
											{formatDate(p.idp_cert_expires_at)}
										</Badge>
										<div class="text-xs text-faint">{expiryLabel(p.idp_cert_expires_at)}</div>
									</td>
									<td data-cell="nowrap">
										{#if canWrite}
											<div class="flex items-center justify-end gap-1">
												{#if !p.sp_cert_next}
													<form method="POST" action="?/prepare" use:enhance>
														<input type="hidden" name="id" value={p.id} />
														<Button
															variant="ghost"
															size="sm"
															type="submit"
															aria-label="Prepare a new certificate for {p.name}"
															title="Prepare a new certificate"
														>
															<RefreshCw size={ICON.sm} />
														</Button>
													</form>
												{/if}
												<Button
													variant="ghost"
													size="sm"
													aria-label="Edit {p.name}"
													onclick={() => openEdit(p)}
												>
													<Pencil size={ICON.sm} />
												</Button>
												<form method="POST" action="?/delete" use:enhance={removeProvider(p)}>
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
					noun="providers"
					href={pageHref('/admin/settings/saml', data.limit)}
				/>
			{/if}
		</section>
	{/if}
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New provider'}>
	<form
		id="saml-provider-form"
		method="POST"
		action={editing ? '?/update' : '?/create'}
		use:enhance={saveProviderSubmit.enhance}
	>
		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
		{/if}

		<div class="flex flex-col gap-4">
			<!-- A refused save keeps the drawer open, so the reason has to be in
			     it and not behind the panel on the page. -->
			<FormErrors message={failure.drawer?.error} />
			{#if !editing && templates.length > 0}
				<Select
					id="saml-template"
					label="Start from"
					value={templateKey}
					options={templateOptions}
					onvaluechange={applyTemplate}
					hint={chosenTemplate?.description || 'Fills in the usual settings for this provider. You still copy the entity ID, sign-on URL and certificate from your account with the provider.'}
				/>
			{/if}
			<Input
				id="saml-name"
				name="name"
				label="Name"
				hint="Shown on the sign-in button. Use the name people know the provider by."
				bind:value={name}
				required
			/>
			<Input
				id="saml-entity-id"
				name="entity_id"
				label="Entity ID"
				hint="The identity provider's own identifier, from its metadata."
				bind:value={entityId}
				required
			/>
			<Input
				id="saml-sso-url"
				name="sso_url"
				label="Sign-on URL"
				hint="Where people are sent to authenticate."
				bind:value={ssoUrl}
				required
			/>
			<Input
				id="saml-slo-url"
				name="slo_url"
				label="Sign-out URL"
				hint="Optional. Leave empty when the provider does not offer single logout."
				bind:value={sloUrl}
			/>
			<Textarea
				id="saml-idp-cert"
				name="idp_cert"
				label="Their signing certificate"
				hint={editing
					? 'Leave empty to keep the stored certificate. Paste a new one to replace it.'
					: certHint || 'PEM from the identity provider. Every assertion is verified against this.'}
				rows={6}
				bind:value={idpCert}
			/>
			<Input
				id="saml-name-id"
				name="name_id_format"
				label="NameID format"
				hint="The identifier the assertion contains. Email address suits most providers."
				bind:value={nameIdFormat}
			/>
			<Textarea
				id="saml-attributes"
				name="attributes_mapping"
				label="Attribute mapping"
				hint="One per line, as claim=field. A line with no equals sign is ignored."
				rows={4}
				bind:value={attributes}
			/>

			<!-- Toggle renders a button, and a button submits nothing. Each state
			     reaches the action through the hidden field beside it, and every
			     one of these is a security setting, so an unchecked switch has to
			     say false rather than go missing. The plugin turns the first three
			     on for every new provider whatever the form sends, so a create shows
			     them on and fixed, and an edit can turn them off. -->
			<!-- Under a finger each switch takes a 44px hit area around its 20px
			     track. Rows 16px apart let two neighbors share 6px of it, and
			     24px apart they share none. -->
			<div class="flex flex-col gap-4 coarse:gap-6">
				<input
					type="hidden"
					name="want_assertions_signed"
					value={wantAssertionsSigned ? 'true' : 'false'}
				/>
				<Toggle
					id="saml-want-assertions-signed"
					label="Require signed assertions"
					bind:checked={wantAssertionsSigned}
					disabled={!editing}
				/>
				<input
					type="hidden"
					name="want_response_signed"
					value={wantResponseSigned ? 'true' : 'false'}
				/>
				<Toggle
					id="saml-want-response-signed"
					label="Require a signed response"
					bind:checked={wantResponseSigned}
					disabled={!editing}
				/>
				<input
					type="hidden"
					name="sign_authn_requests"
					value={signAuthnRequests ? 'true' : 'false'}
				/>
				<Toggle
					id="saml-sign-authn"
					label="Sign requests to the provider"
					bind:checked={signAuthnRequests}
					disabled={!editing}
					hint={editing ? undefined : 'A new provider starts with these three on. Edit it after creating to turn one off.'}
				/>
				<input
					type="hidden"
					name="encrypt_assertions"
					value={encryptAssertions ? 'true' : 'false'}
				/>
				<Toggle
					id="saml-encrypt"
					label="Expect encrypted assertions"
					bind:checked={encryptAssertions}
				/>
				<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
				<Toggle
					id="saml-enabled"
					label="Show on the sign-in page"
					bind:checked={enabled}
				/>
			</div>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="saml-provider-form" loading={saveProviderSubmit.pending}>
			{editing ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>
