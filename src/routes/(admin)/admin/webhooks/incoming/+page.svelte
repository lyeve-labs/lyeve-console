<script lang="ts">
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		Alert,
		Badge,
		Button,
		Card,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		Pagination,
		PasswordInput,
		SearchInput,
		SegmentedControl,
		Select,
		Textarea,
		Toggle
	} from '@lyeve-labs/ui-kit';
	import type { PageData, ActionData } from './$types';
	import type { IncomingWebhook } from '@lyeve-labs/client';
	import { enhance } from '$app/forms';
	import { confirmed, drawerFailure, fieldErrors, submitter } from '$lib/forms.svelte';
	import { Plus, Pencil, Trash2, ArrowDownToLine } from '@lucide/svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { narrows } from '$lib/narrow';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Failure = { action?: string; error?: string } | null;
	const failure = drawerFailure(() => form as Failure, ['create', 'update']);
	const drawerForm = $derived(failure.drawer);
	const pageForm = $derived(failure.page);

	const submit = submitter(() => (open = false));

	// The webhook plugin serves create, update and delete to a super admin
	// only. An admin reads the endpoints and is told the rest.
	const isSuperAdmin = $derived(data.user?.roles?.includes('super_admin') ?? false);

	// The plugin reports whether its license opens create and update. Only a
	// stated false holds them, so an older plugin that says nothing keeps both
	// live and lets the write answer.
	const held = $derived(data.licensed === false);

	const rows = $derived(data.incomingWebhooks.ok ? data.incomingWebhooks.value : []);
	const schemaNames = $derived(data.schemas.ok ? data.schemas.value.map((s) => s.name) : []);

	// One drawer for both writes: a null target is a new endpoint.
	let open = $state(false);
	let editing = $state<IncomingWebhook | null>(null);
	let name = $state('');
	let schema = $state('');
	let secret = $state('');
	let fieldMap = $state('{}');
	let enabled = $state(true);
	let allowedIPs = $state('');

	// The endpoint's own schema stays among the options even when the schema
	// list could not be read, so saving an edit never moves it.
	const schemaOptions = $derived(
		[...new Set([...schemaNames, ...(schema ? [schema] : [])])].map((name) => ({ value: name, label: name }))
	);

	function openCreate() {
		failure.opened();
		editing = null;
		name = '';
		schema = schemaNames[0] ?? '';
		secret = '';
		fieldMap = '{\n  "external_field": "schema_field"\n}';
		enabled = true;
		allowedIPs = '';
		open = true;
	}

	function openEdit(wh: IncomingWebhook) {
		failure.opened();
		editing = wh;
		name = wh.name;
		schema = wh.schema_name;
		secret = '';
		fieldMap = JSON.stringify(wh.field_map ?? {}, null, 2);
		enabled = wh.enabled;
		allowedIPs = (wh.allowed_ips ?? []).join('\n');
		open = true;
	}

	// The endpoint takes no search, so the box narrows what is on screen.
	let query = $state('');
	let status = $state('');
	const STATUSES = [
		{ value: '', label: 'All' },
		{ value: 'enabled', label: 'Enabled' },
		{ value: 'disabled', label: 'Disabled' },
	];
	const visible = $derived(
		rows.filter(
			(wh) =>
				narrows(query, wh.name, wh.schema_name, wh.id) &&
				(status === '' || (status === 'enabled') === wh.enabled)
		)
	);
</script>

<PageShell
	title="Incoming webhooks"
	description="Create public endpoints that turn payloads from external services into content records."
	width="wide"
>
	{#snippet actions()}
		<!-- A list that could not be read offers no write against it. -->
		{#if data.incomingWebhooks.ok && isSuperAdmin}
			<Button variant="primary" size="sm" onclick={openCreate} disabled={held}>
				<Plus size={ICON.sm} />
				New incoming webhook
			</Button>
		{/if}
	{/snippet}

	<FormErrors message={(pageForm as Failure)?.error || undefined} refused={formRefusal(pageForm)} />

	{#if data.incomingWebhooks.ok && !isSuperAdmin}
		<Alert tone="brand">You can view incoming webhooks. Only a super admin can create, change or delete them.</Alert>
	{/if}

	{#if data.incomingWebhooks.ok && isSuperAdmin && held}
		<Alert tone="warn">
			Creating and changing incoming webhooks is not enabled on this engine. You can still delete them.
		</Alert>
	{/if}

	{#if !data.incomingWebhooks.ok}
		<GateNotice
			level={2}
			gate={data.incomingWebhooks.gate}
			title="Incoming webhooks"
			absent="Incoming webhooks are not included in this build."
		/>
	{:else if data.incomingWebhooks.value.length === 0}
		<EmptyState
			level={2}
			title="No incoming webhooks yet"
			description="Create an incoming webhook to receive payloads from external services."
		>
			{#snippet iconSnippet()}<ArrowDownToLine size={ICON.lg} />{/snippet}
			{#snippet action()}
				{#if isSuperAdmin}
					<Button variant="secondary" onclick={openCreate} disabled={held}>
						<Plus size={ICON.sm} />
						New incoming webhook
					</Button>
				{/if}
			{/snippet}
		</EmptyState>
	{:else}
		<ListToolbar label="Filter incoming webhooks">
			{#snippet search()}
				<label for="incoming-search" class="sr-only">Narrow the list</label>
				<SearchInput id="incoming-search" bind:value={query} placeholder="Name, content type or id" />
			{/snippet}
			{#snippet filters()}
				<SegmentedControl label="Status" labelHidden bind:value={status} options={STATUSES} />
			{/snippet}
		</ListToolbar>

		{#if visible.length === 0}
			<EmptyState level={2} title="No incoming webhooks match these filters" description="Clear the search or widen the status to see every endpoint." />
		{:else}
		<div class="flex flex-col gap-3">
			{#each visible as wh (wh.id)}
				<Card>
					<div class="flex items-center gap-4">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate font-semibold text-fg">{wh.name}</span>
								<Badge tone={wh.enabled ? 'success' : 'neutral'} dot>
									{wh.enabled ? 'Enabled' : 'Disabled'}
								</Badge>
							</div>
							<div class="mt-1 flex flex-wrap items-center gap-4 text-xs text-muted">
								<span>Content type: <span class="font-mono text-fg">{wh.schema_name}</span></span>
								<span>
									POST /api/v1/webhooks/in/<span class="font-mono text-fg">{wh.id}</span>
								</span>
							</div>
							{#if wh.allowed_ips && wh.allowed_ips.length > 0}
								<div class="mt-1 flex flex-wrap gap-1">
									{#each wh.allowed_ips as ip (ip)}
										<Badge tone="neutral">
											<span class="font-mono">{ip}</span>
										</Badge>
									{/each}
								</div>
							{/if}
						</div>
						{#if isSuperAdmin}
						<div class="flex shrink-0 items-center gap-2">
							<Button
								variant="ghost"
								size="sm"
								onclick={() => openEdit(wh)}
								disabled={held}
								title="Edit"
								aria-label="Edit {wh.name}"
							>
								<Pencil size={ICON.sm} />
							</Button>
							<form
								method="POST"
								action="?/delete"
								use:enhance={confirmed(
									`Delete incoming webhook ${wh.name}?`,
									'External services can no longer send payloads to this endpoint.',
									{ confirmLabel: 'Delete' }
								)}
							>
								<input type="hidden" name="id" value={wh.id} />
								<Button variant="ghost" size="sm" type="submit" title="Delete" aria-label="Delete {wh.name}">
									<Trash2 size={ICON.sm} class="text-danger" />
								</Button>
							</form>
						</div>
						{/if}
					</div>
				</Card>
			{/each}
		</div>
		{/if}
		<Pagination
			page={pageNumber(data.offset, data.limit)}
			perPage={data.limit}
			count={data.incomingWebhooks.value.length}
			total={data.total ?? undefined}
			hasNext={data.hasMore}
			noun="incoming webhooks"
			href={pageHref('/admin/webhooks/incoming', data.limit)}
		/>
	{/if}
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New incoming webhook'}>
	<form
		method="POST"
		action={editing ? '?/update' : '?/create'}
		id="incoming-form"
		use:enhance={submit.enhance}
		class="flex flex-col gap-4"
	>
		<FormErrors
			message={(drawerForm as Failure)?.error || undefined}
			fields={fieldErrors(drawerForm)}
			refused={formRefusal(drawerForm)}
		/>
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
		<Input id="incoming-name" name="name" label="Name" required bind:value={name} placeholder="Stripe events" />
		{#if !data.schemas.ok}
			<p class="text-xs text-muted">Could not load content types. Only the one this endpoint already uses is listed.</p>
		{/if}
		<Select
			id="incoming-schema"
			name="schema_name"
			label="Target content type"
			required
			searchable
			options={schemaOptions}
			value={schema}
			onvaluechange={(v) => (schema = v)}
		/>
		<PasswordInput
			id="incoming-secret"
			name="secret"
			label={editing ? 'New signing secret' : 'Signing secret'}
			hint={editing ? 'Leave empty to keep the current secret.' : 'Leave empty to skip signature verification.'}
			bind:value={secret}
		/>
		<Textarea
			id="incoming-fieldmap"
			name="field_map"
			label="Field map"
			required
			hint="A JSON map of external keys to content type fields. Add at least one mapping."
			rows={4}
			bind:value={fieldMap}
			mono
		/>
		<Textarea
			id="incoming-allowed-ips"
			name="allowed_ips"
			label="IP allowlist"
			hint="One IP or CIDR per line. Leave empty to allow all."
			rows={3}
			bind:value={allowedIPs}
			placeholder="10.0.0.0/8"
		/>
		<div>
			<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
			<Toggle id="incoming-enabled" label="Enabled" bind:checked={enabled} />
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="incoming-form" loading={submit.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>
