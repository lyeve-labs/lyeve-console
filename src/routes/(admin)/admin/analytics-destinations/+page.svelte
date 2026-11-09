<script lang="ts">
	import {
		Badge,
		Button,
		Checkbox,
		CopyField,
		Drawer,
		EmptyState,
		Input,
		Modal,
		NumberInput,
		PageShell,
		PasswordInput,
		SectionHeading,
		SegmentedControl,
		Select,
		Table,
		Toggle,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Inbox, Pencil, Plus, RotateCw, Share2, Trash2 } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import { confirmed, submitter } from '$lib/forms.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		CONFIG_FIELDS,
		MAX_ATTEMPTS,
		MAX_BACKOFF_SECONDS,
		PROVIDER_LABELS,
		PROVIDER_TYPES,
		isProviderType,
		retryText,
		type Provider,
		type ProviderType,
	} from '$lib/api/analytics-destinations';
	import { formatDateTime, NO_VALUE } from '$lib/format';
	import { shortId } from '$lib/utils/entry-identity';
	import { ICON } from '$lib/icon';
	import { couldNotLoad } from '$lib/outage';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const inDrawer = $derived(!!form && 'drawer' in form && form.drawer === true);
	const formError = $derived(form && 'error' in form && form.error ? String(form.error) : undefined);
	const refused = $derived(formRefusal(form));

	const typeLabel = (t: string) => (isProviderType(t) ? PROVIDER_LABELS[t] : t);
	const TYPES = PROVIDER_TYPES.map((t) => ({ value: t, label: PROVIDER_LABELS[t] }));
	const byId = $derived(new Map(data.providers.map((p) => [p.id, p])));

	// Link segments: the filter is the plugin's, so it lives in the address.
	const base = '/admin/analytics-destinations';
	const statusOptions = [
		{ value: '', label: 'All', href: base },
		{ value: 'pending', label: 'Retrying', href: `${base}?status=pending` },
		{ value: 'failed', label: 'Failed', href: `${base}?status=failed` },
	];

	// One drawer for both writes: a null target is a new destination.
	let open = $state(false);
	let editing = $state<Provider | null>(null);
	let type = $state<string | null>('ga4');
	let enabled = $state(true);
	let attempts = $state(1);
	let backoff = $state(30);
	let rotate = $state(false);
	const submit = submitter(() => (open = false));

	const fields = $derived(isProviderType(type) ? CONFIG_FIELDS[type as ProviderType] : []);
	// A retry policy is the plugin's paid setting. One already stored stays
	// editable after a lapse, so it can be put back to a single attempt.
	const retryLocked = $derived(!data.licensed && !(editing && editing.retry_policy.max_attempts > 1));

	function openCreate() {
		editing = null;
		type = 'ga4';
		enabled = true;
		attempts = 1;
		backoff = 30;
		rotate = false;
		open = true;
	}

	function openEdit(p: Provider) {
		editing = p;
		type = p.type;
		enabled = p.enabled;
		attempts = p.retry_policy.max_attempts;
		backoff = p.retry_policy.backoff_seconds || 30;
		rotate = false;
		open = true;
	}

	function deleteDestination(p: Provider): SubmitFunction {
		return confirmed(
			`Delete ${p.name}?`,
			'Events stop going to this destination, and its queued deliveries are deleted. This cannot be undone.',
			{ confirmLabel: 'Delete', success: 'Destination deleted.' },
		);
	}

	const replaySubmit: SubmitFunction = () => async ({ result, update }) => {
		await update();
		if (result.type !== 'success') return;
		const out = result.data as { delivered?: boolean; lastError?: string } | undefined;
		if (out?.delivered) toast.success('Delivery sent.');
		else toast.error(out?.lastError ? `The delivery failed again: ${out.lastError}` : 'The delivery failed again.');
	};

	// A webhook's signing secret arrives once, in the answer to the write
	// that made it.
	let reveal = $state('');
	$effect(() => {
		if (form && 'signingSecret' in form && typeof form.signingSecret === 'string' && form.signingSecret) {
			reveal = form.signingSecret;
		}
	});
</script>

<PageShell
	title="Analytics destinations"
	description="Send this tenant's tracked events to other services, and see the deliveries a destination has not accepted yet."
	width="wide"
>
	{#snippet actions()}
		{#if data.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New destination
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Analytics destinations"
			absent="Analytics destinations are not included in this build."
		/>
	{:else}
		{#if !inDrawer}
			<FormErrors message={formError} {refused} />
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Destinations</SectionHeading>
			{#if data.providers.length === 0}
				<EmptyState
					title="No destinations yet"
					description="Create a destination to send tracked events to another service. Each event goes once to every destination that is on."
				>
					{#snippet iconSnippet()}<Share2 size={ICON.lg} />{/snippet}
					{#snippet action()}
						<Button variant="secondary" onclick={openCreate}>
							<Plus size={ICON.sm} /> New destination
						</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Analytics destinations">
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col">Type</th>
							<th scope="col">Status</th>
							<th scope="col">Retries</th>
							<th scope="col" class="text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each data.providers as p (p.id)}
							<tr data-testid="destination-row">
								<td class="font-medium text-fg">{p.name}</td>
								<td data-cell="nowrap">{typeLabel(p.type)}</td>
								<td data-cell="nowrap">
									<Badge tone={p.enabled ? 'success' : 'neutral'} dot>{p.enabled ? 'On' : 'Off'}</Badge>
								</td>
								<td data-cell="nowrap" class="text-xs text-muted">{retryText(p.retry_policy)}</td>
								<td data-cell="nowrap">
									<div class="flex items-center justify-end gap-2">
										<Button variant="ghost" size="sm" aria-label="Edit {p.name}" onclick={() => openEdit(p)}>
											<Pencil size={ICON.sm} />
										</Button>
										<form method="POST" action="?/delete" use:enhance={deleteDestination(p)}>
											<input type="hidden" name="id" value={p.id} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Delete {p.name}">
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
		</section>

		<section class="flex flex-col gap-4" aria-label="Deliveries">
			<SectionHeading level={2}>Deliveries owed</SectionHeading>
			<p class="text-sm text-muted">
				Events a destination refused wait here. A retrying delivery is tried again on its destination's retry policy.
				A failed delivery stays until you send it again or it expires.
			</p>
			<ListToolbar label="Filter deliveries">
				{#snippet filters()}
					<SegmentedControl label="Status" labelHidden value={data.status} options={statusOptions} />
				{/snippet}
			</ListToolbar>
			{#if !data.licensed}
				<div class="flex flex-col gap-1.5" data-testid="replay-locked">
					<NotEnabled compact title="Sending a delivery again" />
				</div>
			{/if}
			{#if data.deliveries === null}
				<GateNotice
					gate={data.deliveriesGate ?? { state: 'error', message: couldNotLoad('deliveries') }}
					title="the deliveries"
					absent="The delivery queue needs a newer version of the analytics plugin."
				/>
			{:else if data.deliveries.data.length === 0}
				<EmptyState
					title="No deliveries owed"
					description={data.status
						? 'No deliveries have this status. Choose All to see the rest.'
						: 'Every destination has accepted every event sent to it.'}
				>
					{#snippet iconSnippet()}<Inbox size={ICON.lg} />{/snippet}
				</EmptyState>
			{:else}
				<Table label="Deliveries owed">
					<thead>
						<tr>
							<th scope="col">Event</th>
							<th scope="col">Destination</th>
							<th scope="col">Status</th>
							<th scope="col">Attempts</th>
							<th scope="col">Next attempt</th>
							<th scope="col">Last error</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.deliveries.data as d (d.id)}
							<tr data-testid="delivery-row" data-status={d.status}>
								<td data-cell="nowrap" class="font-mono text-xs">{shortId(d.event_id)}</td>
								<td data-cell="nowrap">{byId.get(d.provider_id)?.name ?? typeLabel(d.provider_type)}</td>
								<td data-cell="nowrap">
									<Badge tone={d.status === 'failed' ? 'danger' : 'warn'}>{d.status === 'failed' ? 'Failed' : 'Retrying'}</Badge>
								</td>
								<td data-cell="nowrap" class="font-mono text-xs">{d.attempts}</td>
								<td data-cell="nowrap" class="text-xs text-faint">
									{d.next_attempt_at ? formatDateTime(d.next_attempt_at) : NO_VALUE}
								</td>
								<td class="max-w-md truncate text-xs text-muted" title={d.last_error}>{d.last_error || NO_VALUE}</td>
								<td data-cell="nowrap">
									<div class="flex justify-end">
										<form method="POST" action="?/replay" use:enhance={replaySubmit}>
											<input type="hidden" name="id" value={d.id} />
											<Button
												variant="ghost"
												size="sm"
												type="submit"
												disabled={!data.licensed}
												aria-label="Send this delivery again"
												title="Send again"
											>
												<RotateCw size={ICON.sm} />
											</Button>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				{#if data.moreDeliveries}
					<p class="text-xs text-muted" data-testid="more-deliveries">
						Showing the {data.deliveryLimit} newest deliveries. More are owed, but older ones are not listed.
						Filter by status to see a different set.
					</p>
				{/if}
			{/if}
		</section>
	{/if}
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New destination'}>
	<form method="POST" action="?/save" id="destination-form" use:enhance={submit.enhance} class="flex flex-col gap-4">
		{#if inDrawer}
			<FormErrors message={formError} {refused} />
		{/if}
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
		<Input id="destination-name" name="name" label="Name" required value={editing?.name ?? ''} placeholder="Product analytics" />
		{#if editing}
			<input type="hidden" name="type" value={editing.type} />
			<Input id="destination-type" label="Type" value={typeLabel(editing.type)} disabled />
		{:else}
			<Select id="destination-type" name="type" label="Type" options={TYPES} bind:value={type} />
		{/if}
		<div>
			<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
			<Toggle id="destination-enabled" label="On" hint="When on, this destination receives tracked events. Turn it off to pause it without deleting it." bind:checked={enabled} />
		</div>

		<fieldset class="flex flex-col gap-4 border-t border-line pt-4">
			<legend class="text-sm font-medium text-fg">Settings</legend>
			{#if editing}
				<p class="text-xs text-muted">
					Saved settings are never shown. Leave every field empty to keep them, or fill them in to replace
					all of them. Replacing them also resets any setting this form does not show, such as a timeout set
					through the API, to its default.
				</p>
			{/if}
			{#each fields as f (f.key)}
				{#if f.secret}
					<PasswordInput
						id="destination-{f.key}"
						name="config_{f.key}"
						label={f.label}
						hint={f.hint}
						required={f.required && !editing}
						autocomplete="off"
					/>
				{:else}
					<Input
						id="destination-{f.key}"
						name="config_{f.key}"
						label={f.label}
						hint={f.hint}
						required={f.required && !editing}
						type={f.key === 'url' || f.key === 'api_url' ? 'url' : 'text'}
						mono
					/>
				{/if}
			{/each}
			{#if editing && editing.type === 'webhook'}
				<input type="hidden" name="rotate_secret" value={rotate ? 'true' : 'false'} />
				<Checkbox
					id="destination-rotate"
					label="Make a new signing secret"
					description="Events are signed with the new secret as soon as you save. It is not shown again."
					bind:checked={rotate}
				/>
			{/if}
		</fieldset>

		<fieldset class="flex flex-col gap-4 border-t border-line pt-4" data-testid="retry-policy">
			<legend class="text-sm font-medium text-fg">Retries</legend>
			{#if retryLocked}
				<NotEnabled compact title="A retry policy" />
				<p class="text-xs text-muted">Without it, each event is sent once and a failed delivery waits in the queue.</p>
			{/if}
			<div class="grid gap-4 sm:grid-cols-2">
				<NumberInput
					id="destination-attempts"
					name="max_attempts"
					label="Attempts"
					hint="Includes the first attempt. 1 means no retries."
					min={1}
					max={MAX_ATTEMPTS}
					step={1}
					disabled={retryLocked}
					bind:value={attempts}
				/>
				<NumberInput
					id="destination-backoff"
					name="backoff_seconds"
					label="First retry after, seconds"
					hint="Each later retry waits twice as long, up to an hour."
					min={1}
					max={MAX_BACKOFF_SECONDS}
					step={1}
					disabled={retryLocked || attempts <= 1}
					bind:value={backoff}
				/>
			</div>
			{#if retryLocked}
				<input type="hidden" name="max_attempts" value="1" />
			{/if}
		</fieldset>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="destination-form" loading={submit.pending}>
			{editing ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>

{#if reveal}
	<Modal open title="Webhook signing secret" onclose={() => (reveal = '')}>
		<div class="flex flex-col gap-3">
			<p class="text-sm text-fg">
				Every event sent to this webhook is signed with this secret. Copy it to the receiver now. It is not shown
				again.
			</p>
			<CopyField value={reveal} label="Signing secret" mono secret />
		</div>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (reveal = '')}>Close</Button>
		{/snippet}
	</Modal>
{/if}
