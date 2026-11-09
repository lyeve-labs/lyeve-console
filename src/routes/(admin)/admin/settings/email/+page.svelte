<script lang="ts">
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		Badge,
		Button,
		Drawer,
		EmptyState,
		Input,
		NumberInput,
		PageShell,
		PasswordInput,
		SectionHeading,
		Card,
		SegmentedControl,
		Select,
		Table,
		Textarea,
		Toggle,
	} from '@lyeve-labs/ui-kit';
	import { Copy, FileText, Lock, Mail, Pencil, Plus, Terminal, Trash2, MailPlus } from '@lucide/svelte';
	import { duplicateRow } from '$lib/duplicate';
	import SettingRow from '$lib/components/SettingRow.svelte';
	import type { ConfigSetting } from './+page.server';
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { API_METHODS, BODY_PLACEHOLDERS, WEBHOOK_EVENTS, webhookPath, type EmailProvider } from '$lib/api/email';
	import { confirmed, drawerFailure, submitter } from '$lib/forms.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/*
	 * The provider drawer, the delete and every mail setting report through the
	 * one `form`. The drawer shows only a failed save, and only one that came
	 * back after it opened, so a failed delete never reads as a failure of the
	 * next form opened. A failed delete shows above the list. A setting's
	 * outcome carries its key, and its own row shows it.
	 */
	const failure = drawerFailure(() => form as { action?: string; error?: string; key?: string } | null, ['provider']);
	const saveFailure = $derived(failure.drawer);
	// A setting's failure that names no key, such as an ended session, has no
	// row to show in, so it shows above the list with a failed delete.
	const deleteFailure = $derived(
		failure.page?.action === 'delete' || (failure.page && !failure.page.action && !failure.page.key) ? failure.page : null,
	);
	const pageRefusal = $derived(deleteFailure ? formRefusal(deleteFailure) : null);

	const submit = submitter(() => (open = false));

	const providers = $derived(data.providers.ok ? data.providers.value : []);
	const mail = $derived(data.mail?.ok ? data.mail.value : []);

	// SettingRow matches a save's outcome to a row by key, and the provider
	// actions on this page report through the same `form`. A provider failure
	// carries no key, so it cannot be mistaken for a setting's.
	const settingResult = $derived(
		(form ?? null) as { key?: string; error?: string; success?: boolean } | null
	);

	function settingLabel(key: string): string {
		return key.replace(/^SMTP_/, '').toLowerCase();
	}

	function settingHint(setting: ConfigSetting): string {
		if (setting.source === 'env') return 'Set by an environment variable, which always wins.';
		if (setting.source === 'file') {
			return setting.origin
				? `Set in ${setting.origin}. Tag the value !overridable there to edit it here.`
				: 'Set in the configuration file. Tag the value !overridable there to edit it here.';
		}
		return '';
	}

	const TRANSPORT_OPTIONS = [
		{ value: 'smtp', label: 'SMTP' },
		{ value: 'api', label: 'Provider API' },
	];
	const STATUS_OPTIONS = [
		{ value: 'active', label: 'Active' },
		{ value: 'paused', label: 'Paused' },
	];
	const METHOD_OPTIONS = API_METHODS.map((m) => ({ value: m, label: m }));
	const EVENT_OPTIONS = WEBHOOK_EVENTS.map((e) => ({ value: e, label: e }));

	type Row = { key: string; value: string };

	let open = $state(false);
	let editing = $state<EmailProvider | null>(null);
	let transport = $state('smtp');
	let status = $state('active');
	let host = $state('');
	let port = $state(587);
	// The name is state rather than read from `editing`: a duplicate has a
	// name and no row behind it, so a field reading the row opens blank.
	let providerName = $state('');
	let username = $state('');
	let useTLS = $state(false);
	let apiBaseUrl = $state('');
	let apiMethod = $state('POST');
	let apiPath = $state('');
	let apiHeaders = $state<Row[]>([]);
	let apiBody = $state('');
	let apiMessageIdPath = $state('');
	let webhookEventPath = $state('');
	let webhookRecipientPath = $state('');
	let webhookMessageIdPath = $state('');
	let webhookReasonPath = $state('');
	let eventMap = $state<Row[]>([]);

	function rows(map: Record<string, string> | undefined): Row[] {
		return Object.entries(map ?? {}).map(([key, value]) => ({ key, value }));
	}

	/** Opens the drawer on a provider's fields, or on empty ones for a new provider. */
	function fill(p: EmailProvider | null, name: string, initialStatus: string) {
		providerName = name;
		transport = p?.transport ?? 'smtp';
		status = initialStatus;
		host = p?.host ?? '';
		port = p?.port || 587;
		username = p?.username ?? '';
		useTLS = p?.use_tls ?? false;
		apiBaseUrl = p?.api_base_url ?? '';
		apiMethod = p?.api_method || 'POST';
		apiPath = p?.api_path ?? '';
		apiHeaders = rows(p?.api_headers);
		apiBody = p?.api_body ?? '';
		apiMessageIdPath = p?.api_message_id_path ?? '';
		webhookEventPath = p?.api_webhook_event_path ?? '';
		webhookRecipientPath = p?.api_webhook_recipient_path ?? '';
		webhookMessageIdPath = p?.api_webhook_message_id_path ?? '';
		webhookReasonPath = p?.api_webhook_reason_path ?? '';
		eventMap = rows(p?.api_webhook_event_map);
		failure.opened();
		open = true;
	}

	function openCreate() {
		editing = null;
		fill(null, '', 'active');
	}

	function openEdit(p: EmailProvider) {
		editing = p;
		fill(p, p.name, p.status === 'paused' ? 'paused' : 'active');
	}

	/**
	 * Copy a provider into the create drawer.
	 *
	 * Everything about how mail leaves travels. The credential does not: the
	 * plugin holds it encrypted and never sends it back, so the copy asks for
	 * one. The copy also arrives paused, because a second provider in the pool
	 * starts taking sends as soon as it is active and nobody has checked yet
	 * that this one authenticates.
	 */
	function openDuplicate(source: EmailProvider) {
		const draft = duplicateRow(source as unknown as Record<string, unknown>, {
			taken: providers.map((x) => x.name),
		});
		editing = null;
		fill(source, String(draft.name ?? source.name), 'paused');
	}

	const isApi = $derived(transport === 'api');

	// The plugin holds a secret only for the stored transport, so only that
	// one can be left blank: a new row or a transport change needs it typed.
	const passwordKept = $derived(editing !== null && editing.transport === 'smtp');
	const keyKept = $derived(editing !== null && editing.transport === 'api');
	const keptHint = 'Stored and never shown. Leave blank to keep it.';
	const keyHint = $derived(
		keyKept ? keptHint : editing ? 'Enter a key for the new transport.' : 'Encrypted at rest and never shown again.',
	);

	function confirmDelete(p: EmailProvider) {
		return confirmed(`Delete provider ${p.name}?`, 'Mail that would go through it goes to the next provider instead.', {
			confirmLabel: 'Delete',
		});
	}

	function endpoint(p: EmailProvider): string {
		return p.transport === 'api' ? p.api_base_url ?? '' : p.host;
	}

	const placeholderHint = `A JSON template. ${BODY_PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')} are filled in at send time. {{to}} is an array of addresses, {{to_first}} its first address and {{to_objects}} the same list as objects with an email key.`;
</script>

<PageShell
	title="Email"
	documentTitle="Email providers"
	description="Set up how this engine sends mail."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#snippet actions()}
		<Badge tone="violet" size="sm">Beta</Badge>
		{#if data.providers.ok}
			<Button variant="secondary" size="sm" href="/admin/settings/email/templates">
				<FileText size={ICON.sm} />
				Templates
			</Button>
			<Button variant="secondary" size="sm" href="/admin/settings/email/triggers">
				<MailPlus size={ICON.sm} />
				Triggers
			</Button>
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} />
				New provider
			</Button>
		{/if}
	{/snippet}

	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>Provider pool</SectionHeading>
		<p class="text-sm text-muted">
			Each provider is an SMTP server or a provider's HTTP API with a key. The healthy provider with
			the lowest priority number sends first, and a provider you save here joins the rotation immediately.
		</p>

	{#if !data.providers.ok}
		<GateNotice gate={data.providers.gate} title="Email providers" absent="Email is not included in this build." />
	{:else}
		<FormErrors message={deleteFailure?.error} refused={pageRefusal} />

		{#if providers.length === 0}
			<EmptyState
				title="No providers yet"
				description="Until you create one, mail goes through the fallback transport below, if it is set."
			>
				{#snippet iconSnippet()}<Mail size={ICON.lg} />{/snippet}
				{#snippet action()}
					<Button variant="secondary" onclick={openCreate}>
						<Plus size={ICON.sm} />
						New provider
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Email providers">
				<thead>
					<tr>
						<th scope="col">Name</th>
						<th scope="col">Transport</th>
						<th scope="col">Endpoint</th>
						<th scope="col">From</th>
						<th scope="col">Delivery webhook</th>
						<th scope="col">Priority</th>
						<th scope="col">Status</th>
						<th scope="col">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each providers as p (p.id)}
						<tr>
							<td data-cell="nowrap" class="text-sm text-fg">{p.name}</td>
							<td data-cell="nowrap">
								<Badge tone={p.transport === 'api' ? 'brand' : 'neutral'} size="sm">{p.transport === 'api' ? 'API' : 'SMTP'}</Badge>
							</td>
							<td data-cell="nowrap" class="font-mono text-xs text-muted">{endpoint(p)}</td>
							<td data-cell="nowrap" class="text-sm text-muted">{p.from_addr}</td>
							<td data-cell="nowrap" class="font-mono text-xs text-muted">
								{#if p.transport === 'api'}{webhookPath(p.id)}{:else}<span class="text-faint">none</span>{/if}
							</td>
							<td data-cell="nowrap" class="text-sm text-muted">{p.priority}</td>
							<td data-cell="nowrap">
								<Badge tone={p.status === 'active' ? 'success' : p.status === 'degraded' ? 'danger' : 'neutral'} size="sm">{p.status}</Badge>
							</td>
							<td>
								<div class="flex items-center gap-2">
									<Button variant="ghost" size="sm" onclick={() => openEdit(p)} title="Edit" aria-label="Edit {p.name}">
										<Pencil size={ICON.sm} />
									</Button>
									<Button variant="ghost" size="sm" onclick={() => openDuplicate(p)} title="Duplicate" aria-label="Duplicate {p.name}">
										<Copy size={ICON.sm} />
									</Button>
									<form method="POST" action="?/delete" use:enhance={confirmDelete(p)}>
										<input type="hidden" name="id" value={p.id} />
										<Button variant="ghost" size="sm" type="submit" title="Delete" aria-label="Delete {p.name}">
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

	<!-- Not a second way to configure the pool above. The sign-in and reset
	     mailers dial these settings themselves when no provider can send, so
	     the section shows whether or not the pool is available. -->
	{#if data.mail && !data.mail.ok}
		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Fallback transport</SectionHeading>
			<GateNotice gate={data.mail.gate} title="Fallback transport" absent="The fallback transport needs a newer version of the engine." />
		</section>
	{:else if mail.length > 0}
		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Fallback transport</SectionHeading>
			<p class="text-sm text-muted">
				These engine settings are used when the pool is empty or every provider in it fails.
				Password resets and sign-in links use them when no provider can send, so those still arrive
				on an engine with no pool. A change takes effect at the next engine restart. A password
				is never shown again after you save it, and saving a new one replaces it.
			</p>

			<Card>
				<div class="divide-y divide-line">
					{#each mail as setting (setting.key)}
						<div class="py-3 first:pt-0 last:pb-0">
							<div class="flex flex-wrap items-baseline justify-between gap-2">
								<code class="font-mono text-sm text-fg">{setting.key}</code>
								{#if setting.source === 'env'}
									<span class="inline-flex items-center gap-1 text-xs text-faint">
										<Terminal size={ICON.xs} aria-hidden="true" /> environment
									</span>
								{/if}
							</div>

							{#if setting.editable}
								<div class="mt-2">
									<SettingRow
										id="set-{setting.key}"
										name={setting.key}
										label={settingLabel(setting.key)}
										value={setting.value}
										secret={setting.secret}
										action="?/saveSetting"
										saved="Saved. It applies at the next engine restart."
										result={settingResult}
									/>
								</div>
							{:else}
								<div class="mt-2 flex flex-wrap items-center gap-2">
									<Lock size={ICON.xs} class="text-faint" aria-hidden="true" />
									{#if setting.secret}
										<span class="flex-1 rounded-lg bg-surface-2 px-3 py-1.5 text-sm text-faint">
											Stored, not shown.
										</span>
									{:else}
										<code
											class="flex-1 rounded-lg bg-surface-2 px-3 py-1.5 font-mono text-sm text-muted"
										>
											{setting.value ?? ''}
										</code>
									{/if}
								</div>
								<p class="mt-1 text-xs text-faint">{settingHint(setting)}</p>
							{/if}
						</div>
					{/each}
				</div>
			</Card>
		</section>
	{/if}
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New provider'}>
	<form
		method="POST"
		action={editing ? '?/update' : '?/create'}
		id="provider-form"
		use:enhance={submit.enhance}
		class="flex flex-col gap-4"
	>
		<FormErrors message={saveFailure?.error} refused={saveFailure ? formRefusal(saveFailure) : null} />
		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
			<input type="hidden" name="stored_transport" value={editing.transport} />
		{/if}
		<Input id="ep-name" name="name" label="Name" hint="A label for the pool, such as Primary or Marketing." bind:value={providerName} required />
		<SegmentedControl
			label="Transport"
			name="transport"
			options={TRANSPORT_OPTIONS}
			bind:value={transport}
			hint="SMTP sends through a mail server. Provider API sends over HTTPS with a key."
		/>
		<Input id="ep-from" name="from_addr" label="From address" placeholder="noreply@example.com" value={editing?.from_addr ?? ''} required />

		{#if isApi}
			<div class="flex flex-col gap-3 rounded-md border border-line p-3" data-testid="api-section">
				<SectionHeading level={3} variant="eyebrow">Provider API</SectionHeading>
				<PasswordInput id="ep-api-key" name="api_key" label="API key" hint={keyHint} required={!keyKept} autocomplete="off" />
				<Input
					id="ep-api-base-url"
					name="api_base_url"
					label="API base URL"
					placeholder="https://api.example.com"
					hint="Where the send request goes. The path below is appended."
					bind:value={apiBaseUrl}
					required
				/>
				<SegmentedControl
					label="Method"
					name="api_method"
					options={METHOD_OPTIONS}
					bind:value={apiMethod}
					hint="The HTTP method of the send request. Nearly every provider uses POST."
				/>
				<Input id="ep-api-path" name="api_path" label="Path" placeholder="/v3/messages" hint="Added to the base URL. Start it with / and leave out any query string." bind:value={apiPath} />
				<fieldset class="flex flex-col gap-2">
					<legend class="text-xs font-semibold uppercase tracking-wide text-faint">Headers</legend>
					<p class="text-xs text-muted">
						Write <span class="font-mono">{'{{api_key}}'}</span> where the key goes, or <span class="font-mono">{'{{basic:<user>}}'}</span> for a basic-auth header built from that user and the key. Both are filled in at send time and never stored in the header.
					</p>
					{#each apiHeaders as h, i}
						<div class="flex items-end gap-2">
							<Input id="ep-header-key-{i}" name="api_header_key" label="Header" bind:value={h.key} class="min-w-0 flex-1" />
							<Input id="ep-header-value-{i}" name="api_header_value" label="Value" bind:value={h.value} class="min-w-0 flex-1" />
							<Button variant="ghost" size="sm" aria-label="Remove header {h.key || i + 1}" onclick={() => (apiHeaders = apiHeaders.filter((_, j) => j !== i))}>
								<Trash2 size={ICON.sm} class="text-danger" />
							</Button>
						</div>
					{/each}
					<div>
						<Button variant="secondary" size="sm" onclick={() => (apiHeaders = [...apiHeaders, { key: '', value: '' }])}>
							<Plus size={ICON.sm} />
							Add header
						</Button>
					</div>
				</fieldset>
				<Textarea id="ep-api-body" name="api_body" label="Body template" rows={8}  hint={placeholderHint} bind:value={apiBody} mono />
				<Input id="ep-api-message-id-path" name="api_message_id_path" label="Message id path (optional)" placeholder="data.id" hint="A dotted path to the provider's message id in the response." bind:value={apiMessageIdPath} />
			</div>

			<div class="flex flex-col gap-3 rounded-md border border-line p-3" data-testid="webhook-section">
				<SectionHeading level={3} variant="eyebrow">Delivery webhook</SectionHeading>
				<p class="text-xs text-muted">
					{#if editing && editing.transport === 'api'}
						Set the provider's webhook to <span class="font-mono">{webhookPath(editing.id)}</span> on this engine, and send the secret as the token in <span class="font-mono">X-Webhook-Token</span> or <span class="font-mono">?token=</span>.
					{:else}
						After you create the provider, the list shows its webhook path on this engine. Send the secret as the token in <span class="font-mono">X-Webhook-Token</span> or <span class="font-mono">?token=</span>.
					{/if}
					The paths below find each field in what the provider posts.
				</p>
				<PasswordInput id="ep-webhook-secret" name="webhook_secret" label="Webhook secret" hint={keyKept ? keptHint : 'Encrypted at rest.'} autocomplete="off" />
				<Input id="ep-webhook-event-path" name="api_webhook_event_path" label="Event path" placeholder="event" bind:value={webhookEventPath} />
				<Input id="ep-webhook-recipient-path" name="api_webhook_recipient_path" label="Recipient path" placeholder="recipient" bind:value={webhookRecipientPath} />
				<Input id="ep-webhook-message-id-path" name="api_webhook_message_id_path" label="Message id path" placeholder="message.id" bind:value={webhookMessageIdPath} />
				<Input id="ep-webhook-reason-path" name="api_webhook_reason_path" label="Reason path (optional)" placeholder="delivery-status.message" hint="Where the provider puts its text for a bounce. It is used to sort the bounce into a category." bind:value={webhookReasonPath} />
				<fieldset class="flex flex-col gap-2">
					<legend class="text-xs font-semibold uppercase tracking-wide text-faint">Event map</legend>
					<p class="text-xs text-muted">Map each event value the provider sends to what it means.</p>
					{#each eventMap as m, i}
						<div class="flex items-end gap-2">
							<Input id="ep-event-key-{i}" name="event_map_key" label="Provider value" bind:value={m.key} class="min-w-0 flex-1" />
							<div class="min-w-0 flex-1">
								<Select id="ep-event-value-{i}" name="event_map_value" label="Means" options={EVENT_OPTIONS} value={m.value || 'delivered'} onvaluechange={(v) => (m.value = v)} />
							</div>
							<Button variant="ghost" size="sm" aria-label="Remove mapping {m.key || i + 1}" onclick={() => (eventMap = eventMap.filter((_, j) => j !== i))}>
								<Trash2 size={ICON.sm} class="text-danger" />
							</Button>
						</div>
					{/each}
					<div>
						<Button variant="secondary" size="sm" onclick={() => (eventMap = [...eventMap, { key: '', value: 'delivered' }])}>
							<Plus size={ICON.sm} />
							Add mapping
						</Button>
					</div>
				</fieldset>
			</div>
		{:else}
			<div class="flex flex-col gap-3 rounded-md border border-line p-3" data-testid="smtp-section">
				<SectionHeading level={3} variant="eyebrow">SMTP server</SectionHeading>
				<Input id="ep-host" name="host" label="Host" placeholder="smtp.example.com" bind:value={host} required />
				<NumberInput id="ep-port" name="port" label="Port" min={1} max={65535} bind:value={port} />
				<Input id="ep-username" name="username" label="Username" bind:value={username} autocomplete="off" />
				<PasswordInput id="ep-password" name="password" label="Password" hint={passwordKept ? keptHint : 'Encrypted at rest.'} autocomplete="off" />
				<div>
					<input type="hidden" name="use_tls" value={useTLS ? 'true' : 'false'} />
					<Toggle id="ep-use-tls" label="Implicit TLS" hint="Encrypts the connection from the start, for port 465. When off, the connection switches to STARTTLS if the server offers it." bind:checked={useTLS} />
				</div>
			</div>
		{/if}

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
			<NumberInput id="ep-priority" name="priority" label="Priority" min={0} hint="0 sends first." value={editing?.priority ?? 0} />
			<NumberInput id="ep-max-per-hour" name="max_per_hour" label="Max per hour" min={0} hint="0 is unlimited." value={editing?.max_per_hour ?? 0} />
			<SegmentedControl label="Status" name="status" options={STATUS_OPTIONS} bind:value={status} />
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="provider-form" loading={submit.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>

