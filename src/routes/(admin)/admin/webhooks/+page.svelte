<script lang="ts">
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { filtersText, keptJSON, type WebhookRecord } from '$lib/api/webhook-options';
	import { formRefusal, type Refusal } from '$lib/api/refusal';
	import {
		Alert,
		Badge,
		Button,
		CheckboxGroup,
		CopyField,
		Drawer,
		EmptyState,
		Input,
		Modal,
		MultiSelect,
		PageShell,
		Pagination,
		PasswordInput,
		SearchInput,
		SegmentedControl,
		Table,
		Textarea,
		Toggle,
		type ChoiceOption
	} from '@lyeve-labs/ui-kit';
	import type { PageData, ActionData } from './$types';
	import type { Webhook } from '@lyeve-labs/client';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { confirmed, drawerFailure, fieldErrors, submitter } from '$lib/forms.svelte';
	import {
		Plus,
		Copy,
		Pencil,
		Trash2,
		Webhook as WebhookIcon,
		FlaskConical,
		CheckCircle,
		XCircle,
		History,
		KeyRound,
		Skull
	} from '@lucide/svelte';
	import { duplicateRow } from '$lib/duplicate';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { narrows } from '$lib/narrow';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';
	import { eventTone } from '$lib/tones';
	import { page } from '$app/state';
	import DeliveriesDrawer from './DeliveriesDrawer.svelte';
	import DeadLetterDrawer from './DeadLetterDrawer.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Failure = { action?: string; error?: string } | null;
	const failure = drawerFailure(() => form as Failure, ['create', 'update']);
	// The history and the queue draw their own writes' failures inside them,
	// where the reader clicked, rather than behind the open panel.
	const OTHER_DRAWERS = ['retry-delivery', 'dead-letter-replay', 'dead-letter-dismiss', 'dead-letter-delete'];
	const drawerForm = $derived(failure.drawer);
	// A rotation that succeeds settles the result shown before it. The secret
	// never reaches the form, so the earlier result is set aside instead.
	let settled = $state.raw<unknown>(null);
	const pageForm = $derived(
		OTHER_DRAWERS.includes(failure.page?.action ?? '') || (form !== null && form === settled) ? null : failure.page,
	);

	/*
	 * The plugin says nothing about its license until a paid write is
	 * refused, so the first refusal of a retry, a replay or a dismissal is
	 * what the page learns it from. The drawers then hold those three with the
	 * reason beside them.
	 */
	const PAID_ACTIONS = ['retry-delivery', 'dead-letter-replay', 'dead-letter-dismiss'];
	let held = $state.raw<Refusal | null>(null);
	$effect(() => {
		const refused = formRefusal(form);
		if (refused?.kind === 'feature' && PAID_ACTIONS.includes((form as Failure)?.action ?? '')) held = refused;
	});
	const drawerError = $derived((drawerForm as Failure)?.error || undefined);
	const pageError = $derived((pageForm as Failure)?.error || undefined);
	const drawerRefusal = $derived(formRefusal(drawerForm));
	const pageRefusal = $derived(formRefusal(pageForm));

	const submit = submitter(() => (open = false));

	// The options carry their own `name`, so each ticked box posts its own value
	// and the action's getAll('events') sees a list. One hidden field holding
	// the joined selection would arrive as a single comma-joined string and be
	// stored as one event named "after_create,after_update".
	const EVENT_OPTIONS: ChoiceOption[] = [
		'before_create',
		'after_create',
		'before_update',
		'after_update',
		'before_delete',
		'after_delete'
	].map((value) => ({ value, label: value }));

	const rows = $derived(data.webhooks.ok ? data.webhooks.value : []);


	// One drawer for both writes: a null target is a new webhook.
	let open = $state(false);
	let editing = $state<Webhook | null>(null);
	let name = $state('');
	let url = $state('');
	let secret = $state('');
	let enabled = $state(true);
	let events = $state<string[]>([]);
	let schemas = $state<string[]>([]);

	// A schema the webhook already names stays among the options even when the
	// schema list could not be read, so saving an edit never drops it.
	const schemaOptions = $derived<ChoiceOption[]>(
		[...new Set([...(data.schemas.ok ? data.schemas.value.map((s) => s.name) : []), ...schemas])].map(
			(name) => ({ value: name, label: name })
		)
	);
	// The delivery options. An edit sends back what it read, so an endpoint keeps
	// them through a change of its name.
	let template = $state('');
	let jsonpath = $state('');
	let filters = $state('');
	let maxRetries = $state('');
	let retryDelay = $state('');
	let kept = $state('{}');

	function readOptions(wh: WebhookRecord | null) {
		template = wh?.payload_template ?? '';
		jsonpath = wh?.jsonpath_filter ?? '';
		filters = filtersText(wh?.field_filters);
		maxRetries = wh?.max_retries != null ? String(wh.max_retries) : '';
		retryDelay = wh?.retry_delay_seconds != null ? String(wh.retry_delay_seconds) : '';
		kept = keptJSON(wh);
	}
	const formErrors = $derived(fieldErrors(drawerForm));

	function openCreate() {
		failure.opened();
		editing = null;
		name = '';
		url = '';
		secret = '';
		enabled = true;
		events = [];
		schemas = [];
		readOptions(null);
		open = true;
	}

	function openEdit(wh: Webhook) {
		failure.opened();
		editing = wh;
		name = wh.name;
		url = wh.url;
		secret = '';
		enabled = wh.enabled;
		events = [...wh.events];
		schemas = [...wh.schemas];
		readOptions(wh as WebhookRecord);
		open = true;
	}

	/**
	 * Copy a webhook into the create drawer.
	 *
	 * The signing secret is not copied and cannot be: it is the receiver's
	 * trust anchor, and two endpoints sharing one means rotating either
	 * breaks both. The shared helper drops it, and this sets the box empty so
	 * the new endpoint mints its own.
	 */
	function openDuplicate(wh: Webhook) {
		const draft = duplicateRow(wh as unknown as Record<string, unknown>, {
			taken: rows.map((w) => w.name),
		});
		failure.opened();
		editing = null;
		name = String(draft.name ?? wh.name);
		url = wh.url;
		secret = '';
		enabled = false;
		events = [...wh.events];
		schemas = [...wh.schemas];
		readOptions(wh as WebhookRecord);
		open = true;
	}

	// The endpoint takes no search, so the box narrows the page on screen and
	// the pager below still walks the whole collection.
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
				narrows(query, wh.name, wh.url, wh.events.join(' '), wh.schemas.join(' ')) &&
				(status === '' || (status === 'enabled') === wh.enabled)
		)
	);

	let testResults = $state<
		Record<string, { success: boolean; status_code: number; message: string }>
	>({});

	// The map is read untracked: an effect that tracks the map it rewrites
	// reruns on its own write until Svelte stops it.
	$effect(() => {
		if (form && 'testResult' in form && form.testResult) {
			const tr = form.testResult as {
				id: string;
				success: boolean;
				status_code: number;
				message: string;
			};
			testResults = { ...untrack(() => testResults), [tr.id]: tr };
		}
	});

	// A row's history and the queue open from the address, so a link or a
	// reload opens them too, and the list keeps its page under them.
	function drawerHref(param: string, value: string): string {
		const next = new URL(page.url);
		next.searchParams.set(param, value);
		return `${next.pathname}${next.search}`;
	}
	const historyName = $derived(rows.find((wh) => wh.id === data.deliveries?.id)?.name ?? data.deliveries?.id ?? '');

	/*
	 * The plugin shows a rotated secret once and never again, and the old one
	 * stops verifying at once, so the new one is shown in a panel the reader
	 * copies from, naming the webhook it signs for.
	 */
	let reveal = $state<{ name: string; secret: string } | null>(null);
	// The secret is taken straight from the result and never applied to the
	// page's form, so closing the panel leaves no copy of it behind.
	const takeSecret: SubmitFunction = () => async ({ result, update }) => {
		if (result.type === 'success' && result.data && 'rotated' in result.data) {
			const r = result.data.rotated as { name: string; secret: string };
			reveal = { name: r.name, secret: r.secret };
			settled = form;
			return;
		}
		await update();
	};

	function truncate(url: string, max = 48): string {
		return url.length > max ? url.slice(0, max) + '...' : url;
	}

	// The webhook plugin serves create, update, delete and rotate to a super
	// admin only. An admin reads, tests and replays, and is told the rest.
	const isSuperAdmin = $derived(data.user?.roles?.includes('super_admin') ?? false);
</script>

<PageShell
	title="Webhooks"
	description="Send HTTP callbacks to other services when content changes."
	width="wide"
>
	{#snippet actions()}
		<!-- The queue is the same plugin's read: a list that could not be
		     read offers no queue either. -->
		{#if data.webhooks.ok}
			<Button variant="secondary" size="sm" href={drawerHref('dead', '1')} title="View dead letter queue">
				<Skull size={ICON.sm} />
				Dead letters
			</Button>
		{/if}
		<!-- A list that could not be read offers no write against it. -->
		{#if data.webhooks.ok && isSuperAdmin}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} />
				New webhook
			</Button>
		{/if}
	{/snippet}

	<FormErrors message={pageError} refused={pageRefusal} />

	{#if data.webhooks.ok && !isSuperAdmin}
		<Alert tone="brand">You can view and test webhooks. Only a super admin can create, change or delete them.</Alert>
	{/if}

	{#if !data.webhooks.ok}
		<GateNotice
			level={2}
			gate={data.webhooks.gate}
			title="Webhooks"
			absent="Webhooks are not included in this build."
		/>
	{:else if data.webhooks.value.length === 0}
		<EmptyState
			level={2}
			title="No webhooks yet"
			description="Create a webhook to send HTTP callbacks when content changes."
		>
			{#snippet iconSnippet()}<WebhookIcon size={ICON.lg} />{/snippet}
			{#snippet action()}
				{#if isSuperAdmin}
					<Button variant="secondary" onclick={openCreate}>
						<Plus size={ICON.sm} />
						New webhook
					</Button>
				{/if}
			{/snippet}
		</EmptyState>
	{:else}
		<ListToolbar label="Filter webhooks">
			{#snippet search()}
				<label for="webhook-search" class="sr-only">Search this page</label>
				<SearchInput id="webhook-search" bind:value={query} placeholder="Name, URL, event or content type on this page" />
			{/snippet}
			{#snippet filters()}
				<SegmentedControl label="Status" labelHidden bind:value={status} options={STATUSES} />
			{/snippet}
		</ListToolbar>

		{#if visible.length === 0}
			<EmptyState level={2} title="No webhooks on this page match" description="Clear the search and the status filter, or go to another page." />
		{:else}
		<Table label="Webhooks">
			<thead>
				<tr>
					<th scope="col">Name</th>
					<th scope="col">URL</th>
					<th scope="col">Events</th>
					<th scope="col">Content types</th>
					<th scope="col">Status</th>
					<th scope="col">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each visible as wh (wh.id)}
					<tr>
						<td data-cell="nowrap" class="font-medium text-fg">{wh.name}</td>
						<td data-cell="nowrap" class="font-mono text-xs text-muted">{truncate(wh.url)}</td>
						<td data-cell="nowrap">
							<div class="flex flex-wrap gap-1">
								{#each wh.events as ev (ev)}
									<Badge tone={eventTone(ev)}>{ev}</Badge>
								{:else}
									<span class="text-xs text-faint">None</span>
								{/each}
							</div>
						</td>
						<td>
							{#if wh.schemas.length === 0}
								<Badge tone="brand">All</Badge>
							{:else}
								<div class="flex flex-wrap gap-1">
									{#each wh.schemas as s (s)}
										<Badge tone="neutral">{s}</Badge>
									{/each}
								</div>
							{/if}
						</td>
						<td>
							{#if wh.enabled}
								<Badge tone="success" dot>Enabled</Badge>
							{:else}
								<Badge tone="neutral" dot>Disabled</Badge>
							{/if}
						</td>
						<td>
							<div class="flex items-center gap-2">
								<form method="POST" action="?/test" use:enhance>
									<input type="hidden" name="id" value={wh.id} />
									<Button
										variant="ghost"
										size="sm"
										type="submit"
										title="Test webhook"
										aria-label="Test {wh.name}"
									>
										<FlaskConical size={ICON.sm} />
									</Button>
								</form>
								<Button
									variant="ghost"
									size="sm"
									href={drawerHref('deliveries', wh.id)}
									title="Delivery history"
									aria-label="Delivery history for {wh.name}"
								>
									<History size={ICON.sm} />
								</Button>
								{#if isSuperAdmin}
									<form method="POST" action="?/rotate-secret" use:enhance={takeSecret}>
										<input type="hidden" name="id" value={wh.id} />
										<Button
											variant="ghost"
											size="sm"
											type="submit"
											title="Rotate signing secret"
											aria-label="Rotate the signing secret for {wh.name}"
										>
											<KeyRound size={ICON.sm} />
										</Button>
									</form>
									<Button
									variant="ghost"
									size="sm"
									onclick={() => openEdit(wh)}
									title="Edit"
									aria-label="Edit {wh.name}"
								>
									<Pencil size={ICON.sm} />
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onclick={() => openDuplicate(wh)}
									title="Duplicate"
									aria-label="Duplicate {wh.name}"
								>
									<Copy size={ICON.sm} />
								</Button>
								<!-- Asks first, so one click never destroys a webhook. -->
								<form
									method="POST"
									action="?/delete"
									use:enhance={confirmed(`Delete webhook ${wh.name}?`, 'This cannot be undone.', { confirmLabel: 'Delete' })}
								>
									<input type="hidden" name="id" value={wh.id} />
									<Button variant="ghost" size="sm" type="submit" title="Delete" aria-label="Delete {wh.name}">
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								</form>
								{/if}
							</div>

							{#if testResults[wh.id]}
								{@const tr = testResults[wh.id]}
								<div class="mt-1 flex items-center gap-1 text-xs">
									{#if tr.success}
										<CheckCircle size={ICON.xs} class="text-success" />
										<span class="text-success">HTTP {tr.status_code}: {tr.message}</span>
									{:else}
										<XCircle size={ICON.xs} class="text-danger" />
										<span class="text-danger">HTTP {tr.status_code}: {tr.message}</span>
									{/if}
								</div>
							{/if}

						</td>
					</tr>
				{/each}
			</tbody>
		</Table>
		{/if}

		<!-- The total is stated only when the envelope carried one. Absent is
		     not zero here, so it is left out rather than sent as a number
		     nobody measured, and the count carries the range instead. -->
		<Pagination
			page={pageNumber(data.offset, data.limit)}
			perPage={data.limit}
			count={data.webhooks.value.length}
			total={data.total ?? undefined}
			hasNext={data.hasMore}
			noun="webhooks"
			href={pageHref('/admin/webhooks', data.limit)}
		/>
	{/if}
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New webhook'}>
	<form
		method="POST"
		action={editing ? '?/update' : '?/create'}
		id="webhook-form"
		use:enhance={submit.enhance}
		class="flex flex-col gap-4"
	>
		<FormErrors message={drawerError} fields={formErrors} refused={drawerRefusal} />
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
		<input type="hidden" name="kept" value={kept} />
		<Input id="webhook-name" name="name" label="Name" bind:value={name} placeholder="Slack notifier" required />
		<Input id="webhook-url" name="url" label="URL" bind:value={url} placeholder="https://hooks.example.com/webhook" required />
		<PasswordInput
			id="webhook-secret"
			name="secret"
			label="Signing secret"
			hint={editing ? 'Leave empty to keep the current secret.' : 'Optional. Signs each payload with HMAC-SHA256.'}
			bind:value={secret}
		/>
		<CheckboxGroup name="events" label="Events" orientation="horizontal" options={EVENT_OPTIONS} bind:value={events} />
		<!-- The schemas are rows from data, so they are searched rather than
		     listed as boxes. Each pick posts its own value, the way the event
		     boxes do. -->
		<MultiSelect
			id="webhook-schemas"
			label="Content types"
			placeholder="Every content type"
			hint={data.schemas.ok
				? 'Leave empty to fire on every content type.'
				: editing
					? 'Could not load content types. Only the ones this webhook already uses are listed.'
					: 'Could not load content types. If you save it like this, the webhook fires for every content type.'}
			searchable
			options={schemaOptions}
			bind:value={schemas}
		/>
		{#each schemas as s (s)}
			<input type="hidden" name="schemas" value={s} />
		{/each}
		<div>
			<!-- The action reads `enabled` from the body. Without this the
			     switch posts nothing and every webhook is created disabled. -->
			<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
			<Toggle id="webhook-enabled" label="Enabled" bind:checked={enabled} />
		</div>

		<fieldset class="flex flex-col gap-4 border-t border-line pt-4">
			<legend class="text-sm font-medium text-fg">Delivery options</legend>
			<p class="text-xs text-muted">Leave a field empty to use the default. An option that is not enabled on this engine cannot be saved.</p>
			<Textarea
				id="webhook-template"
				name="payload_template"
				label="Payload template"
				rows={3}
				mono
				bind:value={template}
				hint="A Go template for the body. Leave empty to send the standard event JSON."
			/>
			<Input id="webhook-jsonpath" name="jsonpath_filter" label="JSONPath filter" mono bind:value={jsonpath} placeholder="$.data.status" />
			<Textarea
				id="webhook-filters"
				name="field_filters"
				label="Field filters"
				rows={2}
				mono
				bind:value={filters}
				placeholder="status=published"
				hint="One field=value per line. Only matching events are sent."
				error={formErrors.field_filters}
			/>
			<div class="grid gap-4 sm:grid-cols-2">
				<Input id="webhook-retries" name="max_retries" label="Retries" inputmode="numeric" bind:value={maxRetries} placeholder="Default" />
				<Input id="webhook-delay" name="retry_delay_seconds" label="Retry delay (seconds)" inputmode="numeric" bind:value={retryDelay} placeholder="Default" />
			</div>
		</fieldset>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="webhook-form" loading={submit.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>

<!-- A row's history is a read on that row, so it opens over the list the way
     its edit does, and the queue does the same. -->
<DeliveriesDrawer {form} deliveries={data.deliveries} name={historyName} {held} />

<DeadLetterDrawer {form} deadLetters={data.deadLetters} {held} />

{#if reveal}
	<Modal open title="New signing secret for {reveal.name}" onclose={() => (reveal = null)}>
		<div class="flex flex-col gap-3">
			<p class="text-sm text-fg">
				Every delivery from {reveal.name} is now signed with this secret, and the old secret stops working. Copy it to the receiver now. It is not shown again.
			</p>
			<CopyField value={reveal.secret} label="Signing secret" mono secret />
		</div>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (reveal = null)}>Close</Button>
		{/snippet}
	</Modal>
{/if}
