<script lang="ts">
	import { formRefusal } from '$lib/api/refusal';
	import {
		Alert,
		Badge,
		Button,
		CopyField,
		Drawer,
		EmptyState,
		Input,
		Modal,
		PageShell,
		SectionHeading,
		Stat,
		Table,
		Toggle,
		toast,
		Pagination,
		RadioGroup,
		SearchInput,
		SegmentedControl,
	} from '@lyeve-labs/ui-kit';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { confirmed, submitter, tracked } from '$lib/forms.svelte';
	import AlertChannelFields from '$lib/components/AlertChannelFields.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { BellRing, Pencil, Play, Plus, Radar, Trash2 } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import {
		PROBE_HEALTH_LABELS,
		PROBE_TYPES,
		PROBE_TYPE_HINTS,
		PROBE_TYPE_LABELS,
		SECRET_MASK,
		everyLabel,
		intervalHint,
		maskedHeaders,
		probeHealth,
		probeTarget,
		probeTone,
		runGoingOnText,
		type Probe,
		type ProbeType,
	} from '$lib/api/synthetic';
	import { formatDateTime, plural } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	// A failure from a drawer stays in that drawer. The channels drawer marks
	// its own, and a probe save names the probe drawer. Every other failure is
	// the page's.
	const channelsFailed = $derived(!!form && 'channels' in form && form.channels === true);
	const probeFailed = $derived(!!form && 'drawer' in form && form.drawer === 'probe');
	const pageRefusal = $derived(channelsFailed || probeFailed ? null : formRefusal(form));
	const channelsRefusal = $derived(channelsFailed ? formRefusal(form) : null);
	const probeRefusal = $derived(probeFailed ? formRefusal(form) : null);

	const formError = $derived(
		channelsFailed || probeFailed ? '' : ((form as { error?: string } | null)?.error ?? ''),
	);
	const probeError = $derived(probeFailed ? ((form as { error?: string } | null)?.error ?? '') : '');
	const channelsError = $derived(channelsFailed ? ((form as { error?: string } | null)?.error ?? '') : '');

	// The notice channels drawer is addressable: `?channels=<id>` opens it on
	// that probe, and the load reads the channels only then.
	const base = '/admin/observability/synthetic';
	let channelsOpen = $state(false);
	$effect(() => {
		channelsOpen = !!data.channelsFor;
	});
	function channelsHref(id: string): string {
		const q = new URLSearchParams({ limit: String(data.limit), offset: String(data.offset), channels: id });
		return `${base}?${q}`;
	}
	function closeChannels() {
		channelsOpen = false;
		void goto(`${base}?${new URLSearchParams({ limit: String(data.limit), offset: String(data.offset) })}`, {
			replaceState: true,
			noScroll: true,
			keepFocus: true,
		});
	}
	const channelsSubmit = submitter(closeChannels);

	// The webhook's signing secret arrives once, in the answer to the write
	// that set the URL.
	let reveal = $state('');
	$effect(() => {
		if (form && 'signingSecret' in form && typeof form.signingSecret === 'string' && form.signingSecret) {
			reveal = form.signingSecret;
		}
	});
	// The load counts the states across every probe when it read them all.
	// Otherwise the state tiles count the rows read, and say so unless every
	// probe is on this page.
	const failing = $derived(
		data.counts?.failing ?? data.probes.filter((p) => probeHealth(p) === 'failing').length,
	);
	const paused = $derived(data.counts?.paused ?? data.probes.filter((p) => probeHealth(p) === 'paused').length);
	const wholeList = $derived(!!data.counts || (data.offset === 0 && !data.hasMore));
	const pageNote = $derived(wholeList ? undefined : `of the ${data.probes.length} on this page`);

	let narrow = $state('');
	let showing = $state<'all' | 'failing' | 'paused'>('all');
	const visible = $derived(
		data.probes.filter((p) => {
			if (showing !== 'all' && probeHealth(p) !== showing) return false;
			const term = narrow.trim().toLowerCase();
			return !term || `${p.name} ${probeTarget(p)}`.toLowerCase().includes(term);
		}),
	);

	let open = $state(false);
	let editing = $state<Probe | null>(null);

	let name = $state('');
	let type = $state<ProbeType>('health_check');
	let enabled = $state(true);
	// Input binds a string. These are held as text and coerced by the action,
	// which is the one place that has to defend against what a person typed.
	let intervalSeconds = $state('300');
	let timeoutSeconds = $state('10');
	let alertThreshold = $state('3');

	let url = $state('');
	let expectedStatus = $state('200');
	let endpointBase = $state('');
	let resourcePath = $state('');
	let resourceIdField = $state('id');
	let loginUrl = $state('');
	let username = $state('');
	let expectedRedirect = $state('');
	let webhookUrl = $state('');
	let secret = $state('');

	// The plugin replaces a probe's config whole on a save and masks its
	// secrets on every read, so a stored secret cannot be kept. The form says
	// so and asks for it again.
	const storedSecret = $derived(
		!!editing &&
			editing.type === type &&
			(type === 'login_flow' ? editing.config?.password : editing.config?.auth_token) === SECRET_MASK,
	);
	const droppedHeaders = $derived(editing ? maskedHeaders(editing.config) : []);

	function reset() {
		url = '';
		expectedStatus = '200';
		endpointBase = '';
		resourcePath = '';
		resourceIdField = 'id';
		loginUrl = '';
		username = '';
		expectedRedirect = '';
		webhookUrl = '';
		secret = '';
	}

	function openCreate() {
		editing = null;
		name = '';
		type = 'health_check';
		enabled = true;
		intervalSeconds = '300';
		timeoutSeconds = '10';
		alertThreshold = '3';
		reset();
		open = true;
	}

	function openEdit(p: Probe) {
		editing = p;
		name = p.name;
		type = p.type;
		enabled = p.enabled;
		intervalSeconds = String(p.interval_seconds);
		timeoutSeconds = String(p.timeout_seconds);
		alertThreshold = String(p.alert_threshold);
		reset();
		const c = p.config ?? {};
		url = c.url ?? '';
		expectedStatus = String(c.expected_status ?? 200);
		endpointBase = c.endpoint_base ?? '';
		resourcePath = c.resource_path ?? '';
		resourceIdField = c.resource_id_field ?? 'id';
		loginUrl = c.login_url ?? '';
		username = c.username ?? '';
		expectedRedirect = c.expected_redirect ?? '';
		webhookUrl = c.webhook_url ?? '';
		open = true;
	}

	const saveProbe: SubmitFunction = () => {
		const subject = name;
		const verb = editing ? 'saved' : 'created';
		return async ({ result, update }) => {
			if (result.type !== 'failure') open = false;
			await update();
			if (result.type === 'success') toast.success(`Probe ${subject} ${verb}.`);
		};
	};

	/** A run happens now and reports its own outcome, so the toast carries it. */
	function runNow(p: Probe): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				await update();
				if (result.type === 'success') {
					const out = result.data as
						| { status?: string | null; ms?: number; failed?: number; regions?: number; running?: string; already?: boolean }
						| undefined;
					if (out?.running) toast.info(runGoingOnText(p.name, out.already === true));
					else if (out?.status === 'fail') {
						const where = (out.regions ?? 0) > 1 ? ` in ${out.failed} of ${out.regions} regions` : '';
						toast.error(`${p.name} failed${where}`);
					} else if (out?.status === 'pass') toast.success(`${p.name} passed in ${out.ms ?? 0} ms`);
					else toast.warn(`${p.name} ran, and no result was recorded`);
				}
			};
	}

	function removeProbe(p: Probe): SubmitFunction {
		return confirmed(
			`Delete ${p.name}?`,
			'Its results and alert history are deleted. This cannot be undone.',
			{ confirmLabel: 'Delete', success: 'Probe deleted.' },
		);
	}

	const saveProbeSubmit = tracked(saveProbe);
</script>

<PageShell
	title="Synthetic monitoring"
	description="Run scheduled checks against this engine and see their results."
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	{#snippet actions()}
		{#if data.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New probe
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Synthetic monitoring"
			absent="Synthetic monitoring is not included in this build."
		/>
	{:else}
		<FormErrors message={formError || undefined} refused={pageRefusal} />

		<div class="grid gap-4 sm:grid-cols-3">
			<Stat size="sm" mono label="Probes" value={data.total ?? data.probes.length} sub={data.total === null ? pageNote : undefined} />
			<Stat
				size="sm"
				mono
				label="Failing"
				value={failing}
				sub={pageNote}
				tone={failing > 0 ? 'danger' : 'neutral'}
			/>
			<Stat size="sm" mono label="Paused" value={paused} sub={pageNote} />
		</div>

		{#if !data.alerts.ok}
			<GateNotice
				level={2}
				gate={data.alerts.gate}
				title="the open alerts"
				absent="The alert list needs a newer version of the synthetic monitoring plugin."
			/>
		{:else if data.alerts.value.length > 0}
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Unacknowledged alerts</SectionHeading>
				<div class="flex flex-col gap-3">
					{#each data.alerts.value as a (a.id)}
						<div class="rounded border border-line bg-surface-2 p-3">
							<div class="flex flex-wrap items-start justify-between gap-2">
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<BellRing size={ICON.sm} class="text-danger" aria-hidden="true" />
										<span class="font-medium text-fg">{a.probe_name}</span>
										<Badge tone="danger">
											{a.consecutive_failures} in a row
										</Badge>
									</div>
									<p class="mt-1 text-xs text-muted">{a.message}</p>
									{#if a.last_failure_error}
										<p class="mt-0.5 font-mono text-xs text-faint">{a.last_failure_error}</p>
									{/if}
									<p class="mt-0.5 text-xs text-faint">
										Last failure {formatDateTime(a.last_failure_at)}
									</p>
								</div>
								<form method="POST" action="?/acknowledge" use:enhance>
									<input type="hidden" name="id" value={a.id} />
									<Button variant="secondary" size="sm" type="submit">Acknowledge</Button>
								</form>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Probes</SectionHeading>

			{#if data.probes.length === 0}
				<EmptyState
					title="No probes yet"
					description="Create a probe to check this engine on a schedule."
				>
					{#snippet iconSnippet()}
						<Radar size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						<Button variant="secondary" onclick={openCreate}>
							<Plus size={ICON.sm} /> New probe
						</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<ListToolbar label="Filter probes">
					{#snippet search()}
						<label for="probe-narrow" class="sr-only">Search this page</label>
						<SearchInput id="probe-narrow" bind:value={narrow} placeholder="Name or target on this page" />
					{/snippet}
					{#snippet filters()}
						<SegmentedControl
							label="Show"
							labelHidden
							size="sm"
							bind:value={showing}
							options={[
								{ value: 'all', label: 'All' },
								{ value: 'failing', label: 'Failing' },
								{ value: 'paused', label: 'Paused' },
							]}
						/>
					{/snippet}
				</ListToolbar>
				{#if visible.length === 0}
					<EmptyState title="No probes on this page match these filters" description="Clear the filter to see the rest.">
						{#snippet iconSnippet()}
							<Radar size={ICON.lg} />
						{/snippet}
						{#snippet action()}
							<Button variant="secondary" onclick={() => { narrow = ''; showing = 'all'; }}>Clear the filter</Button>
						{/snippet}
					</EmptyState>
				{:else}
					<Table label="Probes">
						<thead>
							<tr>
								<th scope="col">Probe</th>
								<th scope="col">State</th>
								<th scope="col">Runs</th>
								<th scope="col">Last run</th>
								<th scope="col"><span class="sr-only">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{#each visible as p (p.id)}
								<tr>
									<td>
										<div class="font-medium text-fg">{p.name}</div>
										<div class="text-xs text-faint">
											{PROBE_TYPE_LABELS[p.type] ?? p.type}
										</div>
										<div class="max-w-md truncate font-mono text-xs text-faint" title={probeTarget(p)}>
											{probeTarget(p)}
										</div>
									</td>
									<td data-cell="nowrap">
										<Badge tone={probeTone(probeHealth(p))} dot>
											{PROBE_HEALTH_LABELS[probeHealth(p)]}
										</Badge>
										<div class="text-xs text-faint">
											Alerts after {p.alert_threshold}
										</div>
									</td>
									<td data-cell="nowrap" class="text-xs text-faint">
										{everyLabel(p.interval_seconds)}
									</td>
									<td data-cell="nowrap" class="text-xs text-faint">
										{p.last_run_at ? formatDateTime(p.last_run_at) : 'Never'}
									</td>
									<td data-cell="nowrap">
										<div class="flex items-center justify-end gap-1">
											<form method="POST" action="?/run" use:enhance={runNow(p)}>
												<input type="hidden" name="id" value={p.id} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													aria-label="Run {p.name} now"
													title="Run now"
												>
													<Play size={ICON.sm} />
												</Button>
											</form>
											<Button
												variant="ghost"
												size="sm"
												href={channelsHref(p.id)}
												aria-label="Notice channels for {p.name}"
												title="Notice channels"
											>
												<BellRing size={ICON.sm} />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												aria-label="Edit {p.name}"
												onclick={() => openEdit(p)}
											>
												<Pencil size={ICON.sm} />
											</Button>
											<form method="POST" action="?/delete" use:enhance={removeProbe(p)}>
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
									</td>
								</tr>
							{/each}
						</tbody>
					</Table>
					<Pagination
						page={pageNumber(data.offset, data.limit)}
						perPage={data.limit}
						count={data.probes.length}
						total={data.total ?? undefined}
						hasNext={data.hasMore}
						noun="probes"
						href={pageHref('/admin/observability/synthetic', data.limit)}
					/>
				{/if}
			{/if}
		</section>
	{/if}
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New probe'}>
	<form
		id="probe-form"
		method="POST"
		action={editing ? '?/update' : '?/create'}
		use:enhance={saveProbeSubmit.enhance}
	>
		<FormErrors message={probeError || undefined} refused={probeRefusal} />
		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
			<!-- What the read held beyond these fields travels back, because a
			     save replaces the stored config and regions whole. -->
			<input type="hidden" name="kept" value={JSON.stringify({ config: editing.config ?? {}, regions: editing.regions ?? [] })} />
		{/if}

		<div class="flex flex-col gap-4">
			{#if droppedHeaders.length > 0}
				<Alert tone="warn">
					Saving removes the {plural(droppedHeaders.length, 'header')} {droppedHeaders.join(', ')}. Their values
					are never shown, so this form cannot keep them. Set them again through the API after saving.
				</Alert>
			{/if}
			<Input id="probe-name" name="name" label="Name" bind:value={name} required />
			<!-- Each type needs a sentence to tell it from the others, so every
			     option carries its own rather than one hint that changes. -->
			<RadioGroup
				name="type"
				label="What it checks"
				bind:value={type}
				options={PROBE_TYPES.map((t) => ({ value: t, label: PROBE_TYPE_LABELS[t], description: PROBE_TYPE_HINTS[t] }))}
			/>

			<!-- The four probe types take different settings, so only the ones
			     the chosen type reads are shown. A form carrying all of them at
			     once would ask for a webhook URL to run a sign-in check. -->
			{#if type === 'health_check'}
				<Input id="probe-url" name="url" label="URL" bind:value={url} required />
				<Input
					id="probe-expected-status"
					name="expected_status"
					label="Expected status"
					hint="Anything else counts as a failure."
					bind:value={expectedStatus}
				/>
			{:else if type === 'api_canary'}
				<Input
					id="probe-endpoint-base"
					name="endpoint_base"
					label="Endpoint base"
					bind:value={endpointBase}
					required
				/>
				<Input
					id="probe-resource-path"
					name="resource_path"
					label="Resource path"
					bind:value={resourcePath}
				/>
				<Input
					id="probe-resource-id-field"
					name="resource_id_field"
					label="Field holding the new id"
					hint="Read from the create response so later steps can use the new record."
					bind:value={resourceIdField}
				/>
				<Input
					id="probe-auth-token"
					name="secret"
					type="password"
					autocomplete="off"
					label="Auth token"
					hint={storedSecret
						? 'Saving replaces the stored token, which is never shown. Enter it again to keep it.'
						: 'Sent as a bearer token on each request of the cycle. Leave it empty to send none.'}
					required={storedSecret}
					bind:value={secret}
				/>
			{:else if type === 'login_flow'}
				<Input
					id="probe-login-url"
					name="login_url"
					label="Sign-in URL"
					bind:value={loginUrl}
					required
				/>
				<Input id="probe-username" name="username" label="Username" bind:value={username} />
				<Input
					id="probe-password"
					name="secret"
					type="password"
					autocomplete="new-password"
					label="Password"
					hint={storedSecret
						? 'Saving replaces the stored password, which is never shown. Enter it again to keep it.'
						: 'The password the probe signs in with.'}
					required={storedSecret}
					bind:value={secret}
				/>
				<Input
					id="probe-expected-redirect"
					name="expected_redirect"
					label="Expected redirect"
					hint="Where a successful sign-in should land."
					bind:value={expectedRedirect}
				/>
			{:else if type === 'webhook_delivery'}
				<Input
					id="probe-webhook-url"
					name="webhook_url"
					label="Webhook URL"
					bind:value={webhookUrl}
					required
				/>
			{/if}

			<div class="grid gap-4 sm:grid-cols-2">
				<Input
					id="probe-interval"
					name="interval_seconds"
					label="Interval, in seconds"
					hint={intervalHint(data.limits)}
					bind:value={intervalSeconds}
				/>
				<Input
					id="probe-timeout"
					name="timeout_seconds"
					label="Timeout, in seconds"
					hint="Keep it shorter than the interval, or a slow run overlaps the next one."
					bind:value={timeoutSeconds}
				/>
			</div>
			<Input
				id="probe-threshold"
				name="alert_threshold"
				label="Failures before an alert"
				hint="Failures in a row before an alert is raised."
				bind:value={alertThreshold}
			/>

			<!-- Toggle renders a button, which submits nothing, and the action
			     reads an absent field as off. A saved probe would silently stop
			     running. -->
			<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
			<Toggle id="probe-enabled" label="Run on the schedule" bind:checked={enabled} />
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="probe-form" loading={saveProbeSubmit.pending}>
			{editing ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>

{#if data.channelsFor}
	{@const target = data.channelsFor}
	<Drawer bind:open={channelsOpen} title="Notice channels for {target.probe.name}" onclose={closeChannels}>
		{#if target.gate.state !== 'ok' || !target.read}
			{#if target.gate.state === 'locked' || target.gate.state === 'absent'}
				<NotEnabled
					title="Notice channels"
					description={target.gate.state === 'locked'
						? 'Notice channels are not enabled on this engine.'
						: 'Notice channels are not included in this build.'}
					url={target.gate.state === 'locked' ? target.gate.upgradeUrl : null}
				/>
			{:else}
				<Alert tone="danger">Could not load notice channels. Reload the page to try again.</Alert>
			{/if}
		{:else}
			<form
				method="POST"
				action="?/channels"
				id="channels-form"
				use:enhance={channelsSubmit.enhance}
				class="flex flex-col gap-4"
			>
				<FormErrors message={channelsError || undefined} refused={channelsRefusal} />
				<input type="hidden" name="id" value={target.probe.id} />
				<p class="text-sm text-muted">
					When this probe raises an alert, each channel is notified that it is down, and again when the next
					run passes. Email alerts are always available.
				</p>
				<AlertChannelFields
					prefix="channel_"
					idPrefix="probe-channel"
					value={target.read.channels}
					licensed={target.read.licensed}
				/>
			</form>
		{/if}
		{#snippet footer()}
			<Button variant="secondary" onclick={closeChannels}>Cancel</Button>
			{#if target.gate.state === 'ok' && target.read}
				<Button variant="primary" type="submit" form="channels-form" loading={channelsSubmit.pending}>Save</Button>
			{/if}
		{/snippet}
	</Drawer>
{/if}

{#if reveal}
	<Modal open title="Webhook signing secret" onclose={() => (reveal = '')}>
		<div class="flex flex-col gap-3">
			<p class="text-sm text-fg">
				Every notice this probe sends to the webhook is signed with this secret. Copy it to the receiver now.
				It is not shown again.
			</p>
			<CopyField value={reveal} label="Signing secret" mono secret />
		</div>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (reveal = '')}>Close</Button>
		{/snippet}
	</Modal>
{/if}
