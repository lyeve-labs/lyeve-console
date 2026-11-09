<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Card,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		PasswordInput,
		SectionHeading,
		RadioGroup,
		Select,
		Table,
		Textarea,
		Toggle,
	} from '@lyeve-labs/ui-kit';
	import { Database, MessageSquare, Pencil, PlugZap, Plus, Trash2 } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { flowBack } from '$lib/flow/back';
	import { untrack } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';
	import type { Datasource, DatasourceKind } from '$lib/api/flows';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { useInstance } from '$lib/instance.svelte';
	import InlineUpgradeLink from '$lib/components/InlineUpgradeLink.svelte';
	import { confirmed, submitter } from '$lib/forms.svelte';
	import { formatDuration } from '$lib/flow/time';
	import { AUTH_TYPES, EMPTY_AUTH, SSL_MODES, authFieldsOf, isAuthType, isSqlKind, secretKept, sslModeFor, type AuthFields } from '$lib/flow/datasources';
	import { relativeTime, formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const submit = submitter(() => (open = false));

	// The shell shows why the page is unavailable while the flow plugin does
	// not run. A plugin that runs and refuses its routes is said here.
	const enabled = $derived(!data.locked);
	// The plugin says whether this instance may use datasources. Without that
	// the list is empty by design and a create is refused, so the button is
	// disabled and the page says the feature is not enabled rather than that
	// there are none yet.
	const available = $derived(data.available !== false);
	// The plugin refuses an edit and a connection test as it refuses a create
	// while datasources are not enabled. A delete it still takes.
	const UNAVAILABLE = 'Datasources are not enabled on this engine';
	// Only a super admin may grant writes or private addresses, or change
	// either grant. An admin sees both and the reason they are fixed.
	const superAdmin = $derived(data.user.roles.includes('super_admin'));
	const GRANT_HINT = 'Only a super admin can change this.';

	const instance = useInstance();
	const enableLink = $derived(instance.upgradeLink());

	const KIND_OPTIONS = [
		{ value: 'postgres', label: 'Postgres' },
		{ value: 'mysql', label: 'MySQL' },
		{ value: 'mssql', label: 'SQL Server' },
		{ value: 'http', label: 'HTTP base' },
		{ value: 'google_sheets', label: 'Google Sheets' },
	];

	const DEFAULT_PORT: Record<string, string> = { postgres: '5432', mysql: '3306', mssql: '1433' };

	// A row keeps its own id so a removal never hands one row's fields, and
	// the secret typed into them, to the row that moves up into its place.
	type HeaderRow = { id: number; key: string; value: string; secret: boolean };
	let headerSeq = 0;
	function headerRow(key = '', value = '', secret = false): HeaderRow {
		headerSeq += 1;
		return { id: headerSeq, key, value, secret };
	}

	let open = $state(false);
	let editing = $state<Datasource | null>(null);
	let kind = $state<string | null>('postgres');
	let host = $state('');
	let port = $state('');
	let database = $state('');
	let user = $state('');
	let ssl = $state<string | null>('require');
	let baseUrl = $state('');
	let chatId = $state('');
	let headers = $state<HeaderRow[]>([]);
	let apiBase = $state('');
	let auth = $state<AuthFields>({ ...EMPTY_AUTH });
	let allowWrites = $state(false);
	let allowPrivate = $state(false);

	function str(v: unknown): string {
		return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
	}

	/*
	 * The drawer and the row actions share one `form` result. A save shows its
	 * failure in the drawer, and a delete or a test on the page, so a failed
	 * delete never reads as a failed save in the next drawer opened. Opening
	 * the drawer clears what an earlier attempt left.
	 */
	let cleared = $state<unknown>(null);
	const failure = $derived.by(() => {
		const f = form as { action?: unknown; error?: unknown; refused?: unknown; nameError?: unknown } | null;
		if (!f || f === cleared || typeof f.error !== 'string' || !f.error) return null;
		return {
			action: String(f.action ?? ''),
			error: f.error,
			refused: f.refused === true,
			nameError: typeof f.nameError === 'string' ? f.nameError : '',
		};
	});
	const saveFailure = $derived(failure?.action === 'save' ? failure : null);
	const pageFailure = $derived(failure && failure.action !== 'save' ? failure : null);

	function openCreate() {
		cleared = form;
		editing = null;
		kind = 'postgres';
		host = '';
		port = '5432';
		database = '';
		user = '';
		ssl = sslModeFor('postgres', undefined);
		baseUrl = '';
		chatId = '';
		headers = [];
		apiBase = '';
		auth = { ...EMPTY_AUTH };
		allowWrites = false;
		allowPrivate = false;
		open = true;
	}

	function openEdit(ds: Datasource) {
		cleared = form;
		editing = ds;
		kind = ds.kind;
		host = str(ds.config.host);
		port = str(ds.config.port) || DEFAULT_PORT[ds.kind] || '';
		database = str(ds.config.database);
		user = str(ds.config.user);
		ssl = isSqlKind(ds.kind) ? sslModeFor(ds.kind, ds.config.ssl) : null;
		baseUrl = str(ds.config.base_url);
		chatId = str(ds.config.chat_id);
		// The plugin keeps secret headers in the encrypted half and never
		// returns them, so only the plain headers come back to edit.
		const h = ds.config.headers;
		headers =
			h && typeof h === 'object'
				? Object.entries(h as Record<string, unknown>).map(([key, value]) => headerRow(key, str(value)))
				: [];
		apiBase = str(ds.config.api_base);
		auth = authFieldsOf(ds.config);
		allowWrites = ds.allow_writes;
		allowPrivate = ds.allow_private;
		open = true;
	}

	function onKindChange(next: string) {
		kind = next;
		if (DEFAULT_PORT[next] && !port) port = DEFAULT_PORT[next];
		// Each driver spells its TLS modes its own way, so a kind change resets
		// the mode to that driver's default rather than carrying a word over.
		if (isSqlKind(next)) ssl = sslModeFor(next, undefined);
	}

	// The stored scheme decides whether a blank secret means "keep it": only
	// the scheme the engine holds a secret for can be left blank. A new
	// datasource, or a scheme change, needs the secret typed.
	const storedAuth = $derived(editing ? { has_secret: editing.has_secret, type: authFieldsOf(editing.config).type } : null);
	const keepSecret = $derived(secretKept(storedAuth, auth.type));
	const schemeChanged = $derived(storedAuth !== null && storedAuth.type !== auth.type && auth.type !== 'none');
	const secretHint = $derived(
		keepSecret
			? 'Stored and never shown. Leave every secret field empty to keep it.'
			: schemeChanged
				? 'Enter the secret for the new scheme.'
				: 'Encrypted at rest.'
	);

	const sqlKind = $derived(isSqlKind(kind) ? kind : null);
	const isSql = $derived(sqlKind !== null);
	const sslOptions = $derived(sqlKind ? SSL_MODES[sqlKind] : []);

	/*
	 * A row granted writes or private addresses keeps its target for a super
	 * admin to change: the plugin refuses an admin who moves its host, port or
	 * any address origin, because the grant was given for that target. Those
	 * fields are fixed for an admin on such a row, with the reason, and still
	 * post their stored values.
	 */
	const targetFixed = $derived(!!editing && (editing.allow_writes || editing.allow_private) && !superAdmin);
	// The token URL is a target too, so an OAuth2 row keeps its scheme.
	const authFixed = $derived(targetFixed && !!editing && authFieldsOf(editing.config).type === 'oauth2_client_credentials');

	// What each TLS mode tells the driver, keyed by the value the driver takes.
	const SSL_SAYS: Record<string, string> = {
		require: 'Encrypts the connection, and fails when the server does not support encryption.',
		prefer: 'Encrypts when the server supports it, and connects without encryption when it does not.',
		disable: 'Connects without encryption.',
		true: 'Encrypts the connection and checks the server certificate.',
		'skip-verify': 'Encrypts the connection without checking the server certificate. Use it only for a server you trust by its address alone.',
		false: 'Connects without encryption.',
	};
	const sslChoices = $derived(sslOptions.map((m) => ({ ...m, description: SSL_SAYS[m.value] })));

	// What each scheme sends, so the choice says it before the fields appear.
	const AUTH_SAYS: Record<string, string> = {
		none: 'Sends no credential beyond the headers below.',
		bearer: 'Sends a token in the Authorization header.',
		basic: 'Sends a user and a password in the Authorization header.',
		oauth2_client_credentials: 'Asks a token URL for a token with a client id and secret, and sends that token.',
	};
	const authChoices = AUTH_TYPES.map((t) => ({ ...t, description: AUTH_SAYS[t.value] }));

	function deleteDatasource(name: string): SubmitFunction {
		return confirmed(`Delete datasource ${name}?`, 'Flows that use it fail at that node until you create it again.', {
			confirmLabel: 'Delete',
			success: `Datasource ${name} deleted.`,
		});
	}

	// Keyed by row so a second test does not erase the first row's answer. The
	// map is read untracked: a tracked read of what the effect writes re-runs it
	// forever.
	let testResults = $state<Record<string, { ok: boolean; latency_ms: number; error: string }>>({});
	$effect(() => {
		if (form && 'testResult' in form && form.testResult) {
			const r = form.testResult;
			testResults = { ...untrack(() => testResults), [r.id]: r };
		}
	});

	function kindLabel(k: DatasourceKind): string {
		return KIND_OPTIONS.find((o) => o.value === k)?.label ?? k;
	}
</script>

{#if enabled}
	<PageShell
		title="Datasources"
		documentTitle="Datasources - Flows"
		description="Store the encrypted connections your flows use by name, such as an external database, an HTTP API or a Google service account."
		width="wide"
		back={flowBack(page.url)}
	>
		{#snippet actions()}
			<Badge tone="violet" size="sm">Beta</Badge>
			<!-- Stored rows outlive the feature and fill the body, so the header
			     says the feature is not enabled. An empty page says so in its body. -->
			{#if !available && data.datasources.length > 0}
				<NotEnabled compact title="Datasources" />
			{/if}
			{#if data.gate.state === 'ok'}
				<Button variant="primary" size="sm" onclick={openCreate} disabled={!available} title={available ? undefined : 'Not enabled on this engine'}>
					<Plus size={ICON.sm} />
					New datasource
				</Button>
			{/if}
		{/snippet}

		<!-- Chat lives here because a chat channel is a datasource and nothing
		     else: there is no chat setting to store, only the webhook or bot
		     API this page already holds. -->
		<Card>
			<div class="flex items-start gap-4">
				<span
					class="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-brand/15 text-brand"
					aria-hidden="true"
				>
					<MessageSquare size={ICON.lg} />
				</span>
				<div class="min-w-0 flex-1">
					<p class="text-sm text-muted">
						To post to Slack, Discord or Telegram, use the
						<code class="font-mono text-xs">chat.notify</code> node in a flow. It sends through an
						HTTP datasource whose base URL is the service's incoming webhook, or its bot API with
						the chat id set on the datasource. The
						<code class="font-mono text-xs">chat-notify</code> template posts a message when a
						record is created, and is the quickest way to start.
					</p>
					<p class="mt-2 text-xs text-faint">
						<code class="font-mono">EVENT_BUS</code> sets the engine's message bus, not a chat
						service. Setting it to <code class="font-mono">discord</code>,
						<code class="font-mono">slack</code> or <code class="font-mono">telegram</code> stops
						the engine from starting.
					</p>
				</div>
			</div>
		</Card>

		{#if data.gate.state !== 'ok'}
			<GateNotice level={2} gate={data.gate} title="datasources" absent="Datasources are not included in this build." />
		{/if}

		{#if pageFailure?.refused}
			<Alert tone="warn" title="Not enabled on this engine">
				{#snippet children()}
					{pageFailure.error}
					{#if enableLink}
						<InlineUpgradeLink link={enableLink} />
					{/if}
				{/snippet}
			</Alert>
		{:else if pageFailure}
			<Alert tone="danger">
				{#snippet children()}{pageFailure.error}{/snippet}
			</Alert>
		{/if}

		{#if data.gate.state !== 'ok'}
			<!-- Nothing: the empty state would say there are none. -->
		{:else if !available && data.datasources.length === 0}
			<NotEnabled level={2} title="Datasources" description="A flow that uses a datasource cannot be saved." />
		{:else if data.datasources.length === 0}
			<EmptyState
				level={2}
				title="No datasources yet"
				description="Create a datasource to use it in a db.query, http.request or sheets node."
			>
				{#snippet iconSnippet()}<Database size={ICON.lg} />{/snippet}
				{#snippet action()}
					<Button variant="secondary" onclick={openCreate}>
						<Plus size={ICON.sm} />
						New datasource
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Datasources">
				<thead>
					<tr>
						<th scope="col">Name</th>
						<th scope="col">Kind</th>
						<th scope="col">Secret</th>
						<th scope="col">Writes</th>
						<th scope="col">Private ranges</th>
						<th scope="col">Connection</th>
						<th scope="col">Updated</th>
						<th scope="col">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.datasources as ds (ds.id)}
						<tr>
							<td data-cell="nowrap" class="font-mono text-sm text-fg">{ds.name}</td>
							<td data-cell="nowrap" class="text-muted">{kindLabel(ds.kind)}</td>
							<td data-cell="nowrap">
								{#if ds.has_secret}<Badge tone="success" dot>Stored</Badge>{:else}<span class="text-xs text-faint">none</span>{/if}
							</td>
							<td data-cell="nowrap">
								{#if ds.allow_writes}<Badge tone="warn" size="sm">allowed</Badge>{:else}<span class="text-xs text-faint">read only</span>{/if}
							</td>
							<td data-cell="nowrap">
								{#if ds.allow_private}<Badge tone="warn" size="sm">allowed</Badge>{:else}<span class="text-xs text-faint">refused</span>{/if}
							</td>
							<td data-cell="nowrap">
								{#if testResults[ds.id]}
									{@const r = testResults[ds.id]}
									<span class="flex items-center gap-2">
										<Badge tone={r.ok ? 'success' : 'danger'} size="sm">{r.ok ? 'connected' : 'failed'}</Badge>
										<span class="text-xs {r.ok ? 'text-muted' : 'text-danger'}">{r.ok ? formatDuration(r.latency_ms) : r.error || 'Connection failed'}</span>
									</span>
								{:else}
									<span class="text-xs text-faint">not tested</span>
								{/if}
							</td>
							<td data-cell="nowrap" class="text-xs text-muted" title={formatDateTime(ds.updated_at)}>{relativeTime(ds.updated_at)}</td>
							<td>
								<div class="flex items-center gap-2">
									<form method="POST" action="?/test" use:enhance>
										<input type="hidden" name="id" value={ds.id} />
										<Button variant="ghost" size="sm" type="submit" title={available ? 'Test connection' : UNAVAILABLE} aria-label="Test {ds.name}" disabled={!available}>
											<PlugZap size={ICON.sm} />
										</Button>
									</form>
									<Button variant="ghost" size="sm" onclick={() => openEdit(ds)} title={available ? 'Edit' : UNAVAILABLE} aria-label="Edit {ds.name}" disabled={!available}>
										<Pencil size={ICON.sm} />
									</Button>
									<form method="POST" action="?/delete" use:enhance={deleteDatasource(ds.name)}>
										<input type="hidden" name="id" value={ds.id} />
										<Button variant="ghost" size="sm" type="submit" title="Delete" aria-label="Delete {ds.name}">
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
	</PageShell>

	<!-- A target field an admin may not move on a granted row: shown, fixed,
	     with the reason, and posted as stored. -->
	{#snippet fixedTarget(id: string, name: string, label: string, value: string)}
		<input type="hidden" {name} {value} />
		<Input {id} {label} {value} disabled hint={GRANT_HINT} />
	{/snippet}

	<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New datasource'}>
		<form
			method="POST"
			action={editing ? '?/update' : '?/create'}
			id="datasource-form"
			use:enhance={submit.enhance}
			class="flex flex-col gap-4"
		>
			<FormErrors message={saveFailure?.error} />
			{#if saveFailure?.refused && enableLink}
				<InlineUpgradeLink link={enableLink} standalone />
			{/if}
			{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
			<Input
				id="ds-name"
				name="name"
				label="Name"
				hint="Nodes use this name to refer to the datasource. Use lower case letters, digits, dashes and underscores, starting with a letter."
				error={saveFailure?.nameError || undefined}
				value={editing?.name ?? ''}
				required
			/>
			<Select
				id="ds-kind"
				name="kind"
				label="Kind"
				options={KIND_OPTIONS}
				value={kind}
				disabled={!!editing}
				onvaluechange={onKindChange}
			/>
			{#if editing}<input type="hidden" name="kind" value={kind} />{/if}

			{#if isSql}
				{#if targetFixed}
					{@render fixedTarget('ds-host', 'host', 'Host', host)}
					{@render fixedTarget('ds-port', 'port', 'Port', port)}
				{:else}
					<Input id="ds-host" name="host" label="Host" bind:value={host} required />
					<Input id="ds-port" name="port" label="Port" inputmode="numeric" bind:value={port} />
				{/if}
				<Input id="ds-database" name="database" label="Database" bind:value={database} required />
				<Input id="ds-user" name="user" label="User" bind:value={user} />
				<PasswordInput
					id="ds-password"
					name="password"
					label="Password"
					hint={editing?.has_secret ? 'Stored and never shown. Leave blank to keep it.' : 'Encrypted at rest.'}
				/>
				<RadioGroup
					name="ssl"
					label="TLS"
					hint="How the connection is encrypted."
					options={sslChoices}
					value={ssl ?? ''}
					onchange={(v) => (ssl = v)}
				/>
			{:else if kind === 'http'}
				{#if targetFixed}
					{@render fixedTarget('ds-base-url', 'base_url', 'Base URL', baseUrl)}
				{:else}
					<Input id="ds-base-url" name="base_url" label="Base URL" placeholder="https://api.example.com" bind:value={baseUrl} required />
				{/if}
				<Input
					id="ds-chat-id"
					name="chat_id"
					label="Chat id (optional)"
					placeholder="@channel or a numeric id"
					hint="For a Telegram bot API base. A chat.notify node posts to this chat unless the node sets its own."
					bind:value={chatId}
				/>
				{#if editing?.has_secret}
					<!-- The plugin stores the token, password, client secret and
					     secret headers as one sealed value and replaces it whole. A
					     plain header turned secret carries its value into that half,
					     so the switch replaces them as typing does. -->
					<p class="text-xs text-muted" data-testid="secret-rule">
						Stored secrets, including secret headers, are never shown. Leave every secret field empty to keep
						them all. If you type a secret or turn on Secret for a header, all stored secrets are replaced, so enter every secret this
						datasource needs.
					</p>
				{/if}
				<div class="flex flex-col gap-3 rounded-md border border-line p-3" data-testid="auth-section">
					<SectionHeading level={3} variant="eyebrow">Authentication</SectionHeading>
					{#if authFixed}<input type="hidden" name="auth_type" value={auth.type} />{/if}
					<RadioGroup
						name={authFixed ? undefined : 'auth_type'}
						label="Type"
						hint={authFixed
							? `Sent with every request of an http.request node. ${GRANT_HINT}`
							: 'Sent with every request of an http.request node. An explicit Authorization header on the node wins.'}
						options={authChoices}
						value={auth.type}
						disabled={authFixed}
						onchange={(v) => {
							if (isAuthType(v)) auth = { ...auth, type: v };
						}}
					/>
					{#if auth.type === 'bearer'}
						<PasswordInput id="ds-auth-token" name="auth_token" label="Token" hint={secretHint} required={!keepSecret} autocomplete="off" />
					{:else if auth.type === 'basic'}
						<Input id="ds-auth-user" name="auth_user" label="User" bind:value={auth.user} required />
						<PasswordInput id="ds-auth-password" name="auth_password" label="Password" hint={secretHint} required={!keepSecret} autocomplete="off" />
					{:else if auth.type === 'oauth2_client_credentials'}
						{#if authFixed}
							{@render fixedTarget('ds-auth-token-url', 'auth_token_url', 'Token URL', auth.token_url)}
						{:else}
							<Input id="ds-auth-token-url" name="auth_token_url" label="Token URL" placeholder="https://auth.example.com/oauth/token" bind:value={auth.token_url} required />
						{/if}
						<Input id="ds-auth-client-id" name="auth_client_id" label="Client id" bind:value={auth.client_id} required />
						<PasswordInput id="ds-auth-client-secret" name="auth_client_secret" label="Client secret" hint={secretHint} required={!keepSecret} autocomplete="off" />
						<Input id="ds-auth-scopes" name="auth_scopes" label="Scopes" placeholder="read write" hint="Space separated." bind:value={auth.scopes} />
						<Input id="ds-auth-audience" name="auth_audience" label="Audience" hint="Optional. Sent as audience in the token request." bind:value={auth.audience} />
					{:else}
						<p class="text-xs text-muted">No credential beyond the headers below.</p>
					{/if}
				</div>
				<fieldset class="flex flex-col gap-2">
					<legend class="text-xs font-semibold uppercase tracking-wide text-faint">Headers</legend>
					{#each headers as h, i (h.id)}
						<div class="flex items-end gap-2">
							<Input id="ds-header-key-{h.id}" name="header_key" label="Header" bind:value={h.key} class="min-w-0 flex-1" />
							{#if h.secret}
								<PasswordInput id="ds-header-value-{h.id}" name="header_value" label="Value" bind:value={h.value} class="min-w-0 flex-1" />
							{:else}
								<Input id="ds-header-value-{h.id}" name="header_value" label="Value" bind:value={h.value} class="min-w-0 flex-1" />
							{/if}
							<input type="hidden" name="header_secret" value={h.secret ? 'true' : 'false'} />
							<Toggle id="ds-header-secret-{h.id}" label="Secret" size="sm" bind:checked={h.secret} />
							<Button variant="ghost" size="sm" aria-label="Remove header {h.key || i + 1}" onclick={() => (headers = headers.filter((row) => row.id !== h.id))}>
								<Trash2 size={ICON.sm} class="text-danger" />
							</Button>
						</div>
					{/each}
					<div>
						<Button variant="secondary" size="sm" onclick={() => (headers = [...headers, headerRow()])}>
							<Plus size={ICON.sm} />
							Add header
						</Button>
					</div>
				</fieldset>
			{:else}
				<Textarea
					id="ds-sa"
					name="service_account_json"
					label="Service account JSON"
					rows={8}
					hint={editing?.has_secret ? 'Stored and never shown. Leave blank to keep it.' : 'The key file Google issued for the service account. Encrypted at rest.'}
					mono
				/>
				{#if targetFixed}
					{@render fixedTarget('ds-api-base', 'api_base', 'API base', apiBase)}
				{:else}
					<Input id="ds-api-base" name="api_base" label="API base (optional)" placeholder="https://sheets.googleapis.com" bind:value={apiBase} />
				{/if}
			{/if}

			<div>
				<input type="hidden" name="allow_writes" value={allowWrites ? 'true' : 'false'} />
				<Toggle
					id="ds-allow-writes"
					label="Allow writes"
					hint={superAdmin ? 'A db.query node may commit when this is on.' : `A db.query node may commit when this is on. ${GRANT_HINT}`}
					disabled={!superAdmin}
					bind:checked={allowWrites}
				/>
			</div>
			<div>
				<input type="hidden" name="allow_private" value={allowPrivate ? 'true' : 'false'} />
				<Toggle
					id="ds-allow-private"
					label="Allow private addresses"
					hint={superAdmin ? 'When on, hosts that resolve to a private address range are allowed.' : `When on, hosts that resolve to a private address range are allowed. ${GRANT_HINT}`}
					disabled={!superAdmin}
					bind:checked={allowPrivate}
				/>
			</div>
		</form>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			<Button variant="primary" type="submit" form="datasource-form" loading={submit.pending}>{editing ? 'Save' : 'Create'}</Button>
		{/snippet}
	</Drawer>
{:else}
	<PageShell title="Flows" documentTitle="Datasources - Flows" width="wide">
		<NotEnabled level={2} title="Flows" description="Datasources are not enabled on this engine." />
	</PageShell>
{/if}
