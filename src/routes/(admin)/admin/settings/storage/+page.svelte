<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Card,
		Drawer,
		EmptyState,
		Input,
		NumberInput,
		PageShell,
		PasswordInput,
		SectionHeading,
		Select,
		Table,
		Textarea,
		Toggle,
		toast,
	} from '@lyeve-labs/ui-kit';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Copy, HardDrive, Pencil, Plug, Plus, Trash2 } from '@lucide/svelte';
	import { duplicateRow } from '$lib/duplicate';
	import { plural } from '$lib/format';
	import { confirmed, drawerFailure, submitter } from '$lib/forms.svelte';
	import {
		PROVIDER_FIELDS,
		PROVIDER_LABELS,
		PROVIDER_TYPES,
		activeProvider,
		brokenCredentials,
		isCredential,
		providerLabel,
		providerState,
		providerTone,
		providerValues,
		publiclyReadable,
		targetLabel,
		type ProviderField,
		type ProviderType,
		type StorageProvider,
	} from '$lib/api/storage';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	// Create and update share one drawer, so it shows only a failure of the
	// action it is showing. A failed create never shows in the next edit.
	type Failure = { action?: string; providerError?: string } | null;
	const failure = drawerFailure(() => form as Failure, ['create', 'update']);
	const providerError = $derived.by(() =>
		failure.drawer?.action === (editing ? 'update' : 'create') ? (failure.drawer.providerError ?? '') : '',
	);

	// One drawer for create and edit. A null target is a new provider.
	let drawerOpen = $state(false);
	let editing = $state<StorageProvider | null>(null);
	let kind = $state<ProviderType>('s3');
	let name = $state('');
	let values = $state<Record<string, string>>(providerValues());
	let useSSL = $state(true);
	let pathStyle = $state(false);
	let enabled = $state(true);
	let priority = $state(0);
	let publicUnsigned = $state(false);

	const typeOptions = PROVIDER_TYPES.map((t) => ({ value: t, label: PROVIDER_LABELS[t] ?? t }));
	const fields = $derived(PROVIDER_FIELDS[kind]);

	function openCreate() {
		editing = null;
		kind = 's3';
		name = '';
		values = providerValues();
		useSSL = true;
		pathStyle = false;
		enabled = true;
		priority = 0;
		publicUnsigned = false;
		failure.opened();
		drawerOpen = true;
	}

	function openEdit(p: StorageProvider) {
		editing = p;
		kind = (PROVIDER_TYPES as readonly string[]).includes(p.provider_type) ? (p.provider_type as ProviderType) : 's3';
		name = p.name;
		values = providerValues({ region: p.region ?? '', bucket: p.bucket ?? '', endpoint: p.endpoint ?? '', cdn_base_url: p.cdn_base_url ?? '' });
		useSSL = p.use_ssl;
		pathStyle = p.path_style;
		enabled = p.enabled;
		priority = p.priority;
		publicUnsigned = p.local_public_unsigned;
		failure.opened();
		drawerOpen = true;
	}

	/**
	 * Copy a provider into the create drawer.
	 *
	 * The credentials do not travel, and could not: they are stored encrypted
	 * and never sent back to this page, so the copy starts with empty boxes
	 * and the operator supplies a key for the bucket they are pointing at.
	 * The copy also arrives disabled, so a provider does not begin receiving
	 * uploads before anyone has checked where it writes.
	 */
	function openDuplicate(source: StorageProvider) {
		const draft = duplicateRow(source as unknown as Record<string, unknown>, {
			taken: data.providers.map((x) => x.name),
		});
		editing = null;
		kind = (PROVIDER_TYPES as readonly string[]).includes(source.provider_type)
			? (source.provider_type as ProviderType)
			: 's3';
		name = String(draft.name ?? source.name);
		values = providerValues({
			region: source.region ?? '',
			bucket: source.bucket ?? '',
			endpoint: source.endpoint ?? '',
			cdn_base_url: source.cdn_base_url ?? '',
		});
		useSSL = source.use_ssl;
		pathStyle = source.path_style;
		enabled = false;
		priority = source.priority;
		publicUnsigned = source.local_public_unsigned;
		failure.opened();
		drawerOpen = true;
	}

	// A credential is never sent back, so on an edit its box is empty and
	// leaving it empty keeps the stored value.
	function hintFor(f: ProviderField): string {
		return editing && isCredential(f) ? `${f.hint} Leave empty to keep the stored one.` : f.hint;
	}

	const save = submitter(() => (drawerOpen = false));
	const active = $derived(activeProvider(data.providers));
	const broken = $derived(brokenCredentials(data.providers));
	const open = $derived(publiclyReadable(data.providers));

	function test(p: StorageProvider): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`${p.name} passed the test.`);
			};
	}

	function remove(p: StorageProvider): SubmitFunction {
		return confirmed(
			`Delete provider ${p.name}?`,
			'Files already stored there stay where they are, but this engine can no longer read them.',
			{ confirmLabel: 'Delete', success: `${p.name} deleted.` },
		);
	}
</script>

<PageShell
	title="Storage"
	description="Choose where uploads are stored, and see which provider receives them."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#snippet actions()}
		{#if data.canConfigure && data.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New provider
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Storage"
			absent="Storage is not included in this build. Uploads do not work without it."
		/>
	{:else}
		{#if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}
		{#if !data.canConfigure}
			<Alert tone="info">
				Only a super admin can add, change or delete a provider. An administrator can test one.
			</Alert>
		{/if}

		{#if broken.length > 0}
			<!-- A row whose secrets will not decrypt looks configured and fails
			     every write. The failure surfaces as a media error far from
			     here, so this is the only place it is named. -->
			<Alert tone="danger">
				{broken.length}
				{plural(broken.length, 'provider has', 'providers have')} credentials that can no longer be decrypted, so every upload
				to {plural(broken.length, 'it', 'them')} fails. Enter {plural(broken.length, 'its', 'their')} credentials again.
			</Alert>
		{/if}

		{#if open.length > 0}
			<!-- Deliberate with a CDN in front of the directory, a data leak
			     anywhere else. Either way it belongs on the page. -->
			<Alert tone="warn">
				{open.length}
				{plural(open.length, 'provider hands', 'providers hand')} out unsigned URLs that never expire. Anyone who has an object's key can read it. A CDN in front of the directory needs this, but without one it is a data leak.
			</Alert>
		{/if}

		{#if active}
			<p class="text-xs text-muted">
				New uploads go to <span class="font-medium text-fg">{active.name}</span>, which has
				{active.cost_weight > 0 ? 'the lowest cost weight' : 'the lowest priority number'} among
				the providers that can take them.
			</p>
		{:else if data.providers.length > 0}
			<Alert tone="danger">
				No provider can receive uploads. Each one is disabled or has credentials that cannot be decrypted.
			</Alert>
		{/if}

		<Card>
			<div class="flex flex-col gap-3 text-sm text-muted">
				<SectionHeading level={2}>How storage works</SectionHeading>
				<p>
					With no provider configured, uploads are written to a directory on the engine host, set by
					<span class="font-mono text-xs">STORAGE_LOCAL_PATH</span> (<span class="font-mono text-xs">./uploads</span>
					by default). That works for one engine. With more than one replica, the directory must be shared storage, or each replica keeps its own files.
				</p>
				<p>
					You can store files in an object store instead: Amazon S3, any S3-compatible service (Cloudflare
					R2, Wasabi, Backblaze B2, DigitalOcean Spaces) through S3 with its endpoint, MinIO, Google
					Cloud Storage or Azure Blob Storage. Credentials are stored encrypted and never shown
					again. Test a provider before you enable it, because a provider with wrong credentials fails every upload it receives.
				</p>
				<p>
					Each tenant uploads to its own providers. A tenant with none uses the default tenant's providers, and if there are none, the engine's directory. Among the providers that can take an upload, one with a cost weight set through the API is preferred, lowest weight first. Otherwise the lowest priority number receives it. Every store keeps each tenant's files under a separate prefix.
				</p>
				<p>
					Providers are saved in this engine's database. While this page is available,
					<span class="font-mono text-xs">STORAGE_DRIVER</span> and
					<span class="font-mono text-xs">STORAGE_S3_*</span>
					have no effect, because the providers below replace them.
					<span class="font-mono text-xs">STORAGE_LOCAL_PATH</span> still sets the directory the fallback writes to.
				</p>
				<p>
					On the first start with no providers, an engine that already had
					<span class="font-mono text-xs">STORAGE_S3_BUCKET</span>
					set gets one provider built from those variables, so it keeps writing to its bucket. This happens only once. After that, you manage providers on this page.
				</p>
			</div>
		</Card>

		{#if data.providers.length === 0}
			<EmptyState
				title="No providers yet"
				description="Uploads are written to the engine's own directory. Add an object store to keep them elsewhere."
			>
				{#snippet iconSnippet()}
					<HardDrive size={ICON.lg} />
				{/snippet}
				{#snippet action()}
					{#if data.canConfigure}
						<Button variant="secondary" onclick={openCreate}><Plus size={ICON.sm} /> New provider</Button>
					{/if}
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Storage">
				<thead>
					<tr>
						<th scope="col">Provider</th>
						<th scope="col">Writes to</th>
						<th scope="col">State</th>
						<th scope="col">Priority</th>
						<th scope="col"><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.providers as p (p.id)}
						<tr>
							<td data-cell="nowrap">
								<div class="flex items-center gap-2">
									<span class="font-medium text-fg">{p.name}</span>
									{#if active && active.id === p.id}
										<Badge tone="brand">Receiving uploads</Badge>
									{/if}
								</div>
								<div class="text-xs text-faint">{providerLabel(p.provider_type)}</div>
							</td>
							<td data-cell="nowrap" class="font-mono text-xs text-faint">{targetLabel(p)}</td>
							<td data-cell="nowrap">
								<Badge tone={providerTone(p)} dot>{providerState(p)}</Badge>
							</td>
							<td data-cell="nowrap" class="font-mono text-xs">{p.priority}</td>
							<td data-cell="nowrap">
								<div class="flex items-center justify-end gap-1">
									<form method="POST" action="?/test" use:enhance={test(p)}>
										<input type="hidden" name="id" value={p.id} />
										<Button
											variant="ghost"
											size="sm"
											type="submit"
											aria-label="Test {p.name}"
											title="Ask the provider whether it accepts the stored credentials"
										>
											<Plug size={ICON.sm} />
										</Button>
									</form>
									{#if data.canConfigure}
										<Button variant="ghost" size="sm" onclick={() => openEdit(p)} aria-label="Edit {p.name}">
											<Pencil size={ICON.sm} />
										</Button>
										<Button variant="ghost" size="sm" onclick={() => openDuplicate(p)} aria-label="Duplicate {p.name}">
											<Copy size={ICON.sm} />
										</Button>
									{/if}
									{#if data.canConfigure}
										<form method="POST" action="?/delete" use:enhance={remove(p)}>
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
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
	{/if}
</PageShell>

<Drawer bind:open={drawerOpen} title={editing ? `Edit ${editing.name}` : 'New provider'}>
	<form method="POST" action={editing ? '?/update' : '?/create'} id="provider-form" use:enhance={save.enhance} class="flex flex-col gap-4">
		<FormErrors message={providerError || undefined} />
		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
			<!-- The plugin replaces the whole row on a save and the form has no
			     cost field, so the stored weight goes back as it was read. -->
			<input type="hidden" name="cost_weight" value={String(editing.cost_weight ?? 0)} />
		{/if}
		<input type="hidden" name="use_ssl" value={useSSL ? 'true' : 'false'} />
		<input type="hidden" name="path_style" value={pathStyle ? 'true' : 'false'} />
		<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
		<input type="hidden" name="local_public_unsigned" value={publicUnsigned ? 'true' : 'false'} />
		<Select
			id="provider-type"
			name="provider_type"
			label="Type"
			required
			options={typeOptions}
			value={kind}
			onvaluechange={(v) => (kind = v as ProviderType)}
			hint="S3 covers any S3-compatible service: set its endpoint."
		/>
		<Input id="provider-name" name="name" label="Name" required placeholder="Uploads bucket" bind:value={name} />
		{#each fields as f (f.key)}
			{#if f.multiline}
				<Textarea id="provider-{f.key}" name={f.key} label={f.label} required={f.required && !(editing && isCredential(f))} rows={6} mono hint={hintFor(f)} bind:value={values[f.key]} />
			{:else if f.secret}
				<PasswordInput
					id="provider-{f.key}"
					name={f.key}
					label={f.label}
					autocomplete="off"
					required={f.required && !editing}
					hint={hintFor(f)}
					bind:value={values[f.key]}
				/>
			{:else}
				<Input
					id="provider-{f.key}"
					name={f.key}
					label={f.label}
					required={f.required && !(editing && isCredential(f))}
					placeholder={f.placeholder}
					mono={f.key !== 'bucket'}
					hint={hintFor(f)}
					bind:value={values[f.key]}
				/>
			{/if}
		{/each}
		<NumberInput id="provider-priority" name="priority" label="Priority" min={0} hint="Lower numbers receive uploads first." bind:value={priority} />
		{#if kind === 's3' || kind === 'minio'}
			<Toggle id="provider-ssl" label="Use TLS" hint="Talk to the endpoint over HTTPS." bind:checked={useSSL} />
			<Toggle id="provider-path-style" label="Path-style addresses" hint="Needed by MinIO and some S3-compatible services that do not serve bucket subdomains." bind:checked={pathStyle} />
		{/if}
		{#if kind === 'local'}
			<Toggle
				id="provider-public"
				label="Unsigned public URLs"
				hint="Serve files at the public base URL plus the key, with no signature or expiry. Use this only when a CDN serves the directory."
				bind:checked={publicUnsigned}
			/>
		{/if}
		<Toggle id="provider-enabled" label="Enabled" hint="A disabled provider receives nothing and keeps its settings." bind:checked={enabled} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (drawerOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="provider-form" loading={save.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>
