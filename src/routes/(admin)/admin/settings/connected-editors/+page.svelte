<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { navigating, page } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		Alert,
		Banner,
		Button,
		Card,
		CheckboxGroup,
		DescriptionList,
		Drawer,
		EmptyState,
		Field,
		Indicator,
		Input,
		MultiSelect,
		NumberInput,
		PageShell,
		Pagination,
		SectionHeading,
		SegmentedControl,
		Skeleton,
		Table,
		Toggle,
		confirm,
	} from '@lyeve-labs/ui-kit';
	import { Link2, RefreshCw } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import StepUpField from '$lib/components/admin-tokens/StepUpField.svelte';
	import { confirmed, tracked } from '$lib/forms.svelte';
	import { expiresIn, normalizeUserCode, rolesLabel } from '$lib/device-login';
	import { formatDate, formatDateTime, relativeTime } from '$lib/format';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';
	import { FORM_SUBMISSIONS, flowOptions } from '$lib/api/form-destinations';
	import {
		SAID,
		lifetimesUpTo,
		personOf,
		shortLabel,
		statusOf,
		type Connection,
		type ConnectionRequest,
		type Settings,
	} from '$lib/api/connected-editors';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const PATH = '/admin/settings/connected-editors';

	/** Whatever the drawer's last submit answered. */
	interface DrawerAnswer {
		code?: string;
		request?: ConnectionRequest | null;
		codeError?: string;
		expired?: boolean;
		decided?: boolean;
		keyChanged?: boolean;
		lifetimeChanged?: boolean;
		stepUp?: { field: string; needsMfa: boolean };
		approvalUnavailable?: boolean;
		checkUnavailable?: boolean;
		withheld?: boolean;
		error?: string;
	}

	/** Every key an action answers with, each optional. */
	interface Answer {
		drawer?: DrawerAnswer;
		approved?: { expires_at: string };
		declined?: boolean;
		revoked?: string;
		revokeError?: string;
		revokedAll?: number;
		revokeAllFailed?: boolean;
		saved?: { field: string; settings: Settings };
		presetApplied?: { created: boolean; settings: Settings };
		presetMissing?: boolean;
		presetError?: string;
		settingError?: { field: string; message: string };
	}

	const answer = $derived((form ?? {}) as Answer);
	const drawer = $derived(answer.drawer ?? null);

	/** The request a lookup found, for as long as it is still the one the code names. */
	type Held = { code: string; request: ConnectionRequest } | null;

	function nextHeld(prev: Held, d: DrawerAnswer | null): Held {
		if (!d) return prev;
		if (d.request && d.code) return { code: d.code, request: d.request };
		if (d.codeError || d.expired || d.decided || d.request === null) return null;
		return prev;
	}

	function initialDrawer(): DrawerAnswer | null {
		return (form as Answer | null)?.drawer ?? null;
	}

	function initiallyOpen(): boolean {
		return data.openApprove || initialDrawer() !== null;
	}

	let open = $state(initiallyOpen());
	let held = $state<Held>(nextHeld(null, initialDrawer()));
	let codeInput = $state(initialDrawer()?.code ?? '');
	let secret = $state('');
	let lifetimePick = $state('');
	let pending = $state<'lookup' | 'approve' | 'decline' | null>(null);
	let lookupForm = $state<HTMLFormElement | null>(null);
	let lastLooked = '';

	// A later answer moves what the drawer holds. The first one was read above,
	// so a page rendered without scripts shows it too.
	$effect(() => {
		const d = drawer;
		untrack(() => {
			held = nextHeld(held, d);
		});
	});

	const request = $derived(held && normalizeUserCode(codeInput) === held.code ? held.request : null);
	// The last answer, only while the field still shows the code it answered. Cancel
	// clears the field but not the answer, which would otherwise greet the next open.
	const answered = $derived(
		drawer && (drawer.code === codeInput || normalizeUserCode(codeInput) === drawer.code) ? drawer : null,
	);
	const lifetimes = $derived(request ? lifetimesUpTo(request.lifetime_days) : []);
	const lifetime = $derived(
		lifetimes.includes(Number(lifetimePick)) ? lifetimePick : String(request?.lifetime_days ?? ''),
	);
	const mfa = $derived(answered?.stepUp ? answered.stepUp.needsMfa : data.mfaEnrolled);

	/** The browser's own word on whether it is online. Approve, Decline and Revoke wait while it is not. */
	let online = $state(true);
	$effect(() => {
		online = navigator.onLine;
		const up = () => (online = true);
		const down = () => (online = false);
		window.addEventListener('online', up);
		window.addEventListener('offline', down);
		return () => {
			window.removeEventListener('online', up);
			window.removeEventListener('offline', down);
		};
	});

	// Focus lands in the code field whenever the drawer opens, the builder's
	// "Open your admin" link included.
	$effect(() => {
		if (!open) return;
		tick().then(() => document.getElementById('connected-editors-code')?.focus());
	});

	const approveReady = $derived(!!request && online && !answered?.approvalUnavailable);

	/** When a connection approved now with the chosen lifetime would end, never past what the engine said. */
	function expiryOf(r: ConnectionRequest, days: number): string {
		if (days >= r.lifetime_days) return r.would_expire_at;
		const chosen = Date.now() + days * 86_400_000;
		const cap = Date.parse(r.would_expire_at);
		return new Date(Number.isNaN(cap) ? chosen : Math.min(chosen, cap)).toISOString();
	}

	/** The code as typed, read the way the engine reads it, and looked up once the eighth character lands. */
	async function typed() {
		const code = normalizeUserCode(codeInput);
		if (!code) return;
		codeInput = code;
		if (code === held?.code || code === lastLooked || !online) return;
		lastLooked = code;
		await tick();
		lookupForm?.requestSubmit();
	}

	function close() {
		open = false;
		held = null;
		codeInput = '';
		secret = '';
		lastLooked = '';
	}

	const drawerSubmit: SubmitFunction = ({ action }) => {
		const kind = action.search.includes('decline') ? 'decline' : action.search.includes('approve') ? 'approve' : 'lookup';
		pending = kind;
		return async ({ result, update }) => {
			try {
				// The password goes after every decision, refused or not, so it never
				// outlives the submit that used it.
				if (kind !== 'lookup') secret = '';
				await update({ reset: false });
				if (kind !== 'lookup' && result.type === 'success') close();
				// A request someone else decided changed the list behind the drawer.
				if (result.type === 'failure' && (result.data as Answer | undefined)?.drawer?.decided) await invalidateAll();
			} finally {
				pending = null;
			}
		};
	};

	const revokeAll = tracked(
		confirmed('Revoke all builder connections?', 'Every connected browser stops editing immediately, and every waiting request is declined.', {
			confirmLabel: 'Revoke all',
			cancelLabel: 'Cancel',
		}),
	);

	function revokeOne(c: Connection): SubmitFunction {
		return confirmed(
			`Revoke ${personOf(c)}'s builder connection?`,
			'That browser stops editing immediately.',
			{ confirmLabel: 'Revoke' },
		);
	}

	const anyActive = $derived(
		data.connections.some((c) => c.status === 'approved') || (data.total ?? 0) > data.connections.length,
	);

	const loading = $derived(navigating.to?.url.pathname === PATH);

	// The settings card.
	const settings = $derived(data.settings?.ok ? data.settings.value : null);
	const settingError = $derived(answer.settingError ?? null);
	const savedField = $derived(answer.saved?.field ?? '');

	let allowedOn = $derived(settings?.allowed ?? false);
	let lifetimeSetting = $derived(String(settings?.lifetime_days ?? 90));
	let writes = $derived(settings?.writes_per_minute ?? 120);
	// A schema allowed earlier and deleted since is not offered, so the next save drops it.
	let shown = $derived((settings?.show_schemas ?? []).filter((s) => data.schemas.includes(s)));

	let allowedForm = $state<HTMLFormElement | null>(null);
	const saveAllowed = tracked(() => {});
	const saveLimits = tracked(() => {});

	// The switch applies at once, so it sits in a card of its own. Everything
	// else in the settings saves together under one Save.
	async function allowedChanged(on: boolean) {
		if (!on && settings?.allowed) {
			const ok = await confirm('Turn off the builder?', 'Connected browsers stop saving immediately.', {
				confirmLabel: 'Turn off',
			});
			if (!ok) {
				allowedOn = true;
				return;
			}
		}
		await tick();
		allowedForm?.requestSubmit();
	}

	function errorOn(field: string): string | undefined {
		return settingError?.field === field ? settingError.message : undefined;
	}

	const schemaOptions = $derived(data.schemas.map((s) => ({ value: s, label: s })));

	// Where forms may send.
	const formSchemaOptions = $derived(data.formSchemas.map((s) => ({ value: s.name, label: s.label })));
	// A type allowed earlier and deleted or opened to delivery since is not offered, so the next save drops it.
	let formSchemas = $derived((settings?.form_schemas ?? []).filter((n) => data.formSchemas.some((s) => s.name === n)));
	const goneFormSchemas = $derived(
		data.schemasFailed ? [] : (settings?.form_schemas ?? []).filter((n) => !data.formSchemas.some((s) => s.name === n)),
	);
	const flows = $derived(data.flows?.ok ? data.flows.value : null);
	const formFlowOptions = $derived(flows ? flowOptions(flows, settings?.form_flows ?? []) : []);
	let formFlows = $derived([...(settings?.form_flows ?? [])]);
	const flowNotes = $derived(formFlowOptions.filter((o) => o.description && formFlows.includes(o.value)));
	const submissionsExist = $derived(data.formSchemas.some((s) => s.name === FORM_SUBMISSIONS));
	// Offered while forms cannot send to the preset's submissions type yet.
	const presetWanted = $derived(!!settings && !data.schemasFailed && !(settings.form_schemas ?? []).includes(FORM_SUBMISSIONS));
	const presetAvailable = $derived(data.formsPreset && !answer.presetMissing);
	const saveForms = tracked(() => {});
	const applyPreset = tracked(() => {});
</script>

{#snippet keyDetail()}
	{#if request}
		<span class="font-mono text-fg">{request.fingerprint}</span>
		<span class="block text-xs text-muted">Check that the builder shows the same key.</span>
	{/if}
{/snippet}

{#snippet fromDetail()}
	{#if request}
		<span class="break-all text-fg">{request.origin || 'No address reported'}</span>
		<span class="block text-xs text-muted">Sent by the browser and not verified.</span>
	{/if}
{/snippet}

{#snippet nameDetail()}
	{#if request}
		<span dir="auto" title={request.label}>{shortLabel(request.label)}</span>
	{/if}
{/snippet}

<PageShell
	title="Builder connections"
	description="Approve and revoke the browsers that edit pages from the builder."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#if !online}
		<Banner tone="warn">You're offline. Changes on this page wait until you reconnect.</Banner>
	{/if}

	{#if data.gate.state === 'withheld'}
		<NotEnabled
			level={2}
			title="Builder connections"
			description="A super admin turned off builder connections for this tenant. Ask them to turn it back on."
		/>
	{:else if data.gate.state !== 'ok'}
		<GateNotice level={2} gate={data.gate} title="Builder connections" absent="Builder connections are not included in this build." />
	{:else}
		{#if answer.approved}
			<Alert tone="success" autoDismiss>Connection approved. That browser can edit pages now.</Alert>
		{:else if answer.declined}
			<Alert tone="success" autoDismiss>Request declined.</Alert>
		{:else if answer.revoked !== undefined}
			<Alert tone="success" autoDismiss>{answer.revoked}'s connection revoked.</Alert>
		{:else if answer.revokedAll !== undefined}
			<Alert tone="success" autoDismiss>
				{answer.revokedAll} builder connection{answer.revokedAll === 1 ? '' : 's'} revoked.
			</Alert>
		{:else if answer.revokeError}
			<Alert tone="danger">{answer.revokeError}</Alert>
		{:else if answer.revokeAllFailed}
			<Alert tone="danger" dismissible>
				<p>{SAID.revokeAllFailed}</p>
				<div class="mt-3">
					<Button variant="secondary" size="sm" type="submit" form="revoke-all" disabled={!online}>
						<RefreshCw size={ICON.sm} aria-hidden="true" /> Try again
					</Button>
				</div>
			</Alert>
		{/if}

		<section class="flex flex-col gap-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex flex-wrap items-center gap-3">
					<Button
						variant="primary"
						href="{PATH}?approve"
						onclick={(e) => {
							e.preventDefault();
							open = true;
						}}
					>
						<Link2 size={ICON.sm} aria-hidden="true" /> Approve a connection
					</Button>
					<span class="text-sm text-muted">Enter the code the builder shows you.</span>
				</div>
				{#if data.owner}
					<form id="revoke-all" method="POST" action="?/revokeAll" use:enhance={revokeAll.enhance}>
						<Button variant="danger" type="submit" loading={revokeAll.pending} disabled={!anyActive || !online}>
							Revoke all
						</Button>
					</form>
				{/if}
			</div>

			{#if loading}
				<div class="flex flex-col gap-2" data-testid="connections-loading">
					{#each [1, 2, 3, 4, 5] as row (row)}
						<Skeleton height="2.5rem" />
					{/each}
				</div>
			{:else if data.connections.length === 0}
				<EmptyState
					level={2}
					title="No builder connections yet"
					description="Connect from the builder, then approve the connection here with the code it shows."
				>
					{#snippet iconSnippet()}
						<Link2 size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Builder connections">
					<thead>
						<tr>
							<th scope="col">Person</th>
							<th scope="col">Key</th>
							<th scope="col">Approved</th>
							<th scope="col">Last used</th>
							<th scope="col">Expires</th>
							<th scope="col">Status</th>
							<th scope="col"><span class="sr-only">Revoke</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.connections as c (c.id)}
							{@const status = statusOf(c.status)}
							<tr>
								<td data-cell="nowrap">
									<span class="font-medium text-fg">{personOf(c)}</span>
									{#if c.label}
										<div class="text-xs text-faint" dir="auto" title={c.label}>{shortLabel(c.label)}</div>
									{/if}
								</td>
								<td data-cell="nowrap"><span class="font-mono text-xs">{c.fingerprint}</span></td>
								<td data-cell="nowrap" class="text-xs text-faint" title={formatDateTime(c.approved_at)}>
									{formatDate(c.approved_at)}
								</td>
								<td data-cell="nowrap" class="text-xs text-faint" title={formatDateTime(c.last_used_at)}>
									{c.last_used_at ? relativeTime(c.last_used_at) : 'Never'}
								</td>
								<td data-cell="nowrap" class="text-xs text-faint" title={formatDateTime(c.expires_at)}>
									{formatDate(c.expires_at)}
								</td>
								<td data-cell="nowrap">
									<span class="inline-flex items-center gap-2">
										<Indicator tone={status.tone} />
										{status.label}
									</span>
								</td>
								<td data-cell="nowrap">
									{#if c.status === 'approved'}
										<div class="flex justify-end">
											<form method="POST" action="?/revoke" use:enhance={revokeOne(c)}>
												<input type="hidden" name="id" value={c.id} />
												<input type="hidden" name="person" value={personOf(c)} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													disabled={!online}
													aria-label="Revoke {personOf(c)}'s connection"
												>
													Revoke
												</Button>
											</form>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.connections.length}
					total={data.total ?? undefined}
					hasNext={data.hasMore}
					noun="connections"
					href={pageHref(PATH, data.limit)}
				/>
			{/if}
		</section>

		{#if data.owner && data.settings}
			<section class="flex flex-col gap-4" aria-label="Builder settings">
				<SectionHeading level={2}>Builder</SectionHeading>
				{#if !data.settings.ok}
					<GateNotice gate={data.settings.gate} title="Builder settings" absent="Builder settings need a newer version of the builder plugin." />
				{:else if loading}
					<Card>
						<div class="flex flex-col gap-3" data-testid="settings-loading">
							{#each [1, 2, 3, 4] as row (row)}
								<Skeleton height="2rem" />
							{/each}
						</div>
					</Card>
				{:else if settings}
					<Card>
						<form bind:this={allowedForm} method="POST" action="?/setting" use:enhance={saveAllowed.enhance} class="flex flex-col gap-4">
							<input type="hidden" name="field" value="allowed" />
							<input type="hidden" name="allowed" value={allowedOn ? 'on' : 'off'} />
							{#if !settings.allowed}
								<Alert tone="warn">The builder is off. Connected browsers cannot save.</Alert>
							{/if}
							{#if savedField === 'allowed'}
								<Alert tone="success" autoDismiss>Setting saved.</Alert>
							{/if}
							<Toggle
								label="Allow the builder"
								hint="Lets connected browsers save pages. Changes apply immediately."
								bind:checked={allowedOn}
								disabled={saveAllowed.pending || !online}
								onchange={allowedChanged}
							/>
							{#if errorOn('allowed')}
								<Alert tone="danger">{errorOn('allowed')}</Alert>
							{/if}
						</form>
					</Card>

					<Card>
						<form method="POST" action="?/setting" use:enhance={saveLimits.enhance} class="flex flex-col items-start gap-6">
							<input type="hidden" name="field" value="limits" />
							{#if savedField === 'limits'}
								<Alert tone="success" autoDismiss>Settings saved.</Alert>
							{/if}
							{#if answer.saved?.settings.note}
								<Alert tone="brand">{answer.saved.settings.note}</Alert>
							{/if}

							<SegmentedControl
								label="Valid for"
								name="lifetime_days"
								bind:value={lifetimeSetting}
								options={[
									{ value: '30', label: '30 days' },
									{ value: '90', label: '90 days' },
									{ value: '180', label: '180 days' },
								]}
								hint="Applies to connections approved from now on."
								error={errorOn('lifetime_days')}
							/>

							{#if data.schemasFailed}
								<Alert tone="danger">
									<p>Could not load schemas. Pages keep showing the schemas saved before.</p>
									<div class="mt-3">
										<Button variant="secondary" size="sm" href="{page.url.pathname}{page.url.search}" data-sveltekit-reload>
											<RefreshCw size={ICON.sm} aria-hidden="true" /> Try again
										</Button>
									</div>
								</Alert>
							{:else if data.schemas.length === 0}
								<p class="text-sm text-muted">Create a schema to show its entries on pages.</p>
							{:else}
								<!-- Only a form that offered the schemas saves them, so a schema list that failed to load clears nothing. -->
								<input type="hidden" name="schemas_offered" value="1" />
								{#if data.schemas.length <= 12}
									<CheckboxGroup
										label="Pages may show"
										name="show_schemas"
										bind:value={shown}
										options={schemaOptions}
										orientation="horizontal"
										hint="Pages can show entries from the schemas you choose."
										error={errorOn('show_schemas')}
									/>
								{:else}
									<MultiSelect
										id="show-schemas"
										label="Pages may show"
										bind:value={shown}
										options={schemaOptions}
										searchable
										hint="Pages can show entries from the schemas you choose."
										error={errorOn('show_schemas')}
									/>
									{#each shown as name (name)}
										<input type="hidden" name="show_schemas" value={name} />
									{/each}
								{/if}
							{/if}

							<NumberInput
								id="writes-per-minute"
								name="writes_per_minute"
								label="Writes a minute for each connection"
								bind:value={writes}
								min={1}
								max={settings.max_writes_per_minute}
								hint="When a connection reaches this limit, the builder waits and saves again."
								error={errorOn('writes_per_minute')}
							/>

							{#if settingError && !['allowed', 'lifetime_days', 'show_schemas', 'writes_per_minute', 'forms', 'form_schemas', 'form_flows'].includes(settingError.field)}
								<Alert tone="danger">{settingError.message}</Alert>
							{/if}

							<Button variant="primary" type="submit" loading={saveLimits.pending} disabled={!online}>Save</Button>
						</form>
					</Card>

					<Card>
						<div class="flex flex-col items-start gap-6">
							<SectionHeading level={3}>Where forms can send</SectionHeading>
							{#if answer.presetApplied}
								<Alert tone="success" autoDismiss>
									{answer.presetApplied.created ? 'Form submissions set up. Forms can send to it now.' : 'Forms can send to Form submissions now.'}
								</Alert>
							{/if}
							{#if answer.presetError}
								<Alert tone="danger">{answer.presetError}</Alert>
							{/if}
							{#if presetWanted && presetAvailable}
								<div class="flex flex-col items-start gap-3" data-testid="forms-preset">
									<p class="text-sm text-muted">
										{#if submissionsExist}
											Let forms save posts into the Form submissions content type you already have.
										{:else}
											Add the Forms and Form submissions content types, and let forms save posts into Form submissions. You manage what arrives on the Content screens.
										{/if}
									</p>
									<form method="POST" action="?/formsPreset" use:enhance={applyPreset.enhance}>
										<Button variant="secondary" type="submit" loading={applyPreset.pending} disabled={!online}>Set up form submissions</Button>
									</form>
								</div>
							{:else if presetWanted && !submissionsExist}
								<p class="text-sm text-muted" data-testid="forms-preset-link">
									Create a content type for form posts in the <a class="text-brand underline" href="/admin/schema">schema builder</a>, then
									choose it here.
								</p>
							{/if}

							<form method="POST" action="?/setting" use:enhance={saveForms.enhance} class="flex flex-col items-start gap-6">
								<input type="hidden" name="field" value="forms" />
								{#if savedField === 'forms'}
									<Alert tone="success" autoDismiss>Settings saved.</Alert>
								{/if}

								{#if data.schemasFailed}
									<Alert tone="danger">
										<p>Could not load content types. Forms keep sending to the content types saved before.</p>
										<div class="mt-3">
											<Button variant="secondary" size="sm" href="{page.url.pathname}{page.url.search}" data-sveltekit-reload>
												<RefreshCw size={ICON.sm} aria-hidden="true" /> Try again
											</Button>
										</div>
									</Alert>
								{:else}
									<input type="hidden" name="form_schemas_offered" value="1" />
									{#if formSchemaOptions.length === 0}
										<p class="text-sm text-muted">No content types forms can send to yet.</p>
									{:else if formSchemaOptions.length <= 12}
										<CheckboxGroup
											label="Content types"
											name="form_schemas"
											bind:value={formSchemas}
											options={formSchemaOptions}
											orientation="horizontal"
											hint="Forms can save posts into the content types you choose. Content types anyone can read through the delivery API are not listed."
											error={errorOn('form_schemas')}
										/>
									{:else}
										<MultiSelect
											id="form-schemas"
											label="Content types"
											bind:value={formSchemas}
											options={formSchemaOptions}
											searchable
											hint="Forms can save posts into the content types you choose. Content types anyone can read through the delivery API are not listed."
											error={errorOn('form_schemas')}
										/>
										{#each formSchemas as name (name)}
											<input type="hidden" name="form_schemas" value={name} />
										{/each}
									{/if}
									{#if goneFormSchemas.length > 0}
										<Alert tone="warn">
											Forms cannot send to {goneFormSchemas.join(', ')} any more. Save to clear {goneFormSchemas.length === 1 ? 'it' : 'them'}.
										</Alert>
									{/if}
								{/if}

								{#if data.flows === null}
									<p class="text-sm text-muted">The flow plugin is not running on this instance, so forms cannot start flows.</p>
								{:else if !data.flows.ok}
									<GateNotice gate={data.flows.gate} title="Flows" absent="Flows are not included in this build." />
								{:else}
									<input type="hidden" name="form_flows_offered" value="1" />
									{#if formFlowOptions.length === 0}
										<p class="text-sm text-muted">
											No flow starts from a builder form yet. <a class="text-brand underline" href="/admin/flows">Create a flow</a> whose
											trigger is the builder form event.
										</p>
									{:else if formFlowOptions.length <= 12}
										<CheckboxGroup
											label="Flows"
											name="form_flows"
											bind:value={formFlows}
											options={formFlowOptions}
											hint="Forms can start the flows you choose. Only flows that start from a builder form are listed."
											error={errorOn('form_flows')}
										/>
									{:else}
										<MultiSelect
											id="form-flows"
											label="Flows"
											bind:value={formFlows}
											options={formFlowOptions.map((o) => ({ value: o.value, label: o.label }))}
											searchable
											hint="Forms can start the flows you choose. Only flows that start from a builder form are listed."
											error={errorOn('form_flows')}
										/>
										{#each formFlows as slug (slug)}
											<input type="hidden" name="form_flows" value={slug} />
										{/each}
										{#if flowNotes.length > 0}
											<ul class="flex flex-col gap-1 text-sm text-warn">
												{#each flowNotes as note (note.value)}
													<li><span class="font-mono">{note.value}</span>: {note.description}</li>
												{/each}
											</ul>
										{/if}
									{/if}
								{/if}

								{#if settingError?.field === 'forms'}
									<Alert tone="danger">{settingError.message}</Alert>
								{/if}

								<Button variant="primary" type="submit" loading={saveForms.pending} disabled={!online}>Save</Button>
							</form>
						</div>
					</Card>
				{/if}
			</section>
		{/if}
	{/if}
</PageShell>

{#if data.gate.state === 'ok'}
<Drawer bind:open title="Approve a connection" onclose={close}>
	<div class="flex flex-col gap-5">
		<p class="text-sm text-muted">
			Approve only a code you started in the builder in the last 10 minutes. If someone sends you a code, they
			are asking for access to your pages.
		</p>

		<form bind:this={lookupForm} method="POST" action="?/lookup" use:enhance={drawerSubmit}>
			<!-- The label sits above the row and the message under the input alone,
			     so Find request stays level with the input box whatever shows under it. -->
			<Field id="connected-editors-code" label="Code">
				{#snippet children(field)}
					<div class="flex items-start gap-3">
						<Input
							id={field.id}
							name="code"
							class="min-w-0 flex-1"
							placeholder="K7F3-A2M9"
							autocomplete="off"
							spellcheck={false}
							bind:value={codeInput}
							oninput={typed}
							error={answered?.codeError}
							hint={request ? undefined : 'Enter the code the builder shows, then choose Find request.'}
						/>
						<Button variant="secondary" type="submit" loading={pending === 'lookup'}>Find request</Button>
					</div>
				{/snippet}
			</Field>
		</form>

		{#if answered?.withheld}
			<Alert tone="warn">{SAID.withheld}</Alert>
		{/if}
		{#if answered?.expired}
			<Alert tone="warn">{SAID.expired}</Alert>
		{/if}
		{#if answered?.decided}
			<Alert tone="warn">{SAID.decided}</Alert>
		{/if}
		{#if answered?.keyChanged}
			<Alert tone="warn">{SAID.keyChanged}</Alert>
		{/if}
		{#if answered?.lifetimeChanged}
			<Alert tone="warn">{SAID.lifetime}</Alert>
		{/if}
		{#if answered?.error}
			<Alert tone="danger">{answered.error}</Alert>
		{/if}

		{#if request}
			<form
				id="connected-editors-approve"
				method="POST"
				action="?/approve"
				use:enhance={drawerSubmit}
				class="flex flex-col gap-4 border-t border-line pt-5"
			>
				<input type="hidden" name="code" value={held?.code ?? ''} />
				<input type="hidden" name="fingerprint" value={request.fingerprint} />
				<input type="hidden" name="code_expires_at" value={request.code_expires_at} />

				<SectionHeading level={3}>Check this request</SectionHeading>

				{#if !request.same_network}
					<Alert tone="warn">
						This request came from a different network than this browser. Approve it only if you started it yourself.
					</Alert>
				{/if}

				<DescriptionList
					items={[
						{ term: 'Browser name', value: request.label, detail: nameDetail },
						{ term: 'Key', value: request.fingerprint, detail: keyDetail },
						{ term: 'From', value: request.origin, detail: fromDetail },
						{ term: 'Requested from', value: request.requester_network || 'Unknown address' },
						{ term: 'Your address', value: request.approver_address || 'Unknown address' },
						{ term: 'Code expires', value: expiresIn(request.code_expires_at) },
						{ term: 'Access', value: 'read and write pages, sections and the theme, and listed data only with consent' },
						{
							term: 'Approved as',
							value: `${data.email}, with the ${rolesLabel(data.roles)} role${data.roles.length === 1 ? '' : 's'}`,
						},
						...(data.tenant ? [{ term: 'Tenant', value: data.tenant }] : []),
						{ term: 'Expires', value: formatDate(expiryOf(request, Number(lifetime))) },
					]}
				/>

				<SegmentedControl
					label="Valid for"
					name="lifetime_days"
					value={lifetime}
					options={lifetimes.map((d) => ({ value: String(d), label: `${d} days` }))}
					onchange={(v) => (lifetimePick = v)}
				/>

				{#if answered?.approvalUnavailable}
					<Alert tone="warn">{SAID.approvalUnavailable}</Alert>
				{:else}
					<StepUpField id="connected-editors-step-up" {mfa} bind:value={secret} error={answered?.stepUp?.field} />
				{/if}

				{#if answered?.checkUnavailable}
					<Alert tone="warn">{SAID.checkUnavailable}</Alert>
				{/if}

				{#if !online}
					<p id="approve-blocked" class="text-sm text-muted">You're offline.</p>
				{/if}
			</form>
			<!-- Decline posts from a form of its own, so Approve is the approve form's
			     only submit button: Enter in the password field approves, and the
			     password never travels with a decline. -->
			<form id="connected-editors-decline" method="POST" action="?/decline" use:enhance={drawerSubmit} hidden>
				<input type="hidden" name="code" value={held?.code ?? ''} />
				<input type="hidden" name="code_expires_at" value={request.code_expires_at} />
			</form>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="secondary" onclick={close}>Cancel</Button>
		<!-- Approve and Decline appear once a lookup found a request, so the
		     footer never offers a decision about nothing. -->
		{#if request}
			<Button
				variant="secondary"
				type="submit"
				form="connected-editors-decline"
				loading={pending === 'decline'}
				disabled={!online}
			>
				Decline
			</Button>
			<Button
				variant="primary"
				type="submit"
				form="connected-editors-approve"
				loading={pending === 'approve'}
				disabled={!approveReady}
				aria-describedby={online ? undefined : 'approve-blocked'}
			>
				Approve
			</Button>
		{/if}
	{/snippet}
</Drawer>
{/if}
