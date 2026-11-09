<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Card,
		DateTimePicker,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		SectionHeading,
		SegmentedControl,
		Select,
		Table,
		Textarea,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { CalendarClock, FileText, Pencil, Plus, Send, Trash2, X } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { fieldErrors, submitter } from '$lib/forms.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		CONFLICT_LABELS,
		STATUS_LABELS,
		blocks,
		editable,
		statusTone,
		type ReleaseConflict,
	} from '$lib/api/content-releases';
	import { formatDateTime, plural } from '$lib/format';
	import { couldNotLoad } from '$lib/outage';
	import { shortId } from '$lib/utils/entry-identity';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const back = { href: '/admin/releases', label: 'Releases' };

	const errors = $derived(fieldErrors(form));
	const formError = $derived(form && 'error' in form ? String(form.error) : undefined);
	const refused = $derived(formRefusal(form));
	// Which write failed. The two drawers each show only their own action's
	// failure, so a refused publish or delete never opens the next drawer as
	// if its own save had failed.
	const failedAction = $derived(form && 'action' in form ? String(form.action) : '');
	function failureOf(action: string) {
		return failedAction === action
			? { message: formError, fields: errors, refused }
			: { message: undefined, fields: {}, refused: null };
	}

	// A refused schedule or publish carries the conflicts that stopped it,
	// which are fresher than the ones the page read.
	const conflicts = $derived<ReleaseConflict[]>(
		form && 'conflicts' in form && Array.isArray(form.conflicts) ? (form.conflicts as ReleaseConflict[]) : data.conflicts,
	);
	const blocking = $derived(conflicts.filter(blocks));
	const conflictsFor = (entryId: string) => conflicts.filter((c) => c.entry_id === entryId);

	const success = $derived.by(() => {
		if (!form) return '';
		if ('saved' in form) return 'Release saved.';
		if ('added' in form) return 'Entry added to the release.';
		if ('removed' in form) return 'Entry removed from the release.';
		if ('scheduled' in form) return 'Release scheduled.';
		if ('unscheduled' in form) return 'Schedule removed. The release is a draft again.';
		if ('published' in form) return 'Release published.';
		if ('canceled' in form) return 'Release canceled.';
		return '';
	});

	const release = $derived(data.release);
	const canEdit = $derived(release ? editable(release) : false);

	// The edit drawer.
	let editOpen = $state(false);
	let name = $state('');
	let description = $state('');
	const save = submitter(() => (editOpen = false));
	function openEdit() {
		name = release?.name ?? '';
		description = release?.description ?? '';
		editOpen = true;
	}

	// The add-entry drawer.
	let addOpen = $state(false);
	let entryId = $state('');
	let picked = $state<string | null>(null);
	let itemAction = $state<'publish' | 'unpublish'>('publish');
	const add = submitter(() => (addOpen = false));
	const ACTIONS: { value: 'publish' | 'unpublish'; label: string }[] = [
		{ value: 'publish', label: 'Publish it' },
		{ value: 'unpublish', label: 'Unpublish it' },
	];
	// The entries the release can take, grouped by collection. A group is a
	// run of neighboring rows, so the rows are ordered by collection, and the
	// sort is stable, so each group keeps the newest first.
	const entryOptions = $derived(
		[...(data.choices ?? [])]
			.sort((a, b) => a.schema.localeCompare(b.schema))
			.map((c) => ({
				value: c.id,
				label: c.title || c.slug || shortId(c.id),
				group: c.schema || undefined,
				keywords: [c.id, c.slug].filter(Boolean),
			})),
	);

	function openAdd() {
		entryId = '';
		picked = null;
		itemAction = 'publish';
		addOpen = true;
	}

	// A drawer that is open shows its own failure, so the page banner leaves it out.
	const drawerFailed = $derived(
		(editOpen && failedAction === 'update') || (addOpen && failedAction === 'addItem'),
	);

	// The schedule. The picker answers local time, and the action receives
	// it as UTC so the server never guesses the operator's zone.
	let publishAt = $state('');
	const publishAtUTC = $derived.by(() => {
		if (!publishAt) return '';
		const t = new Date(publishAt);
		return Number.isNaN(t.getTime()) ? '' : t.toISOString();
	});
	const schedule = submitter();

	// Confirmed actions go through the kit's dialog, then a hidden form.
	let confirmAction = $state('');
	let confirmForm = $state<HTMLFormElement>();
	let removeEntry = $state('');
	let removeForm = $state<HTMLFormElement>();

	// Each question names the release, so a reader with two tabs open can
	// tell which one the answer goes to.
	async function ask(action: 'publish' | 'cancel' | 'delete') {
		const named = release?.name ?? '';
		const copy = {
			publish: [`Publish release ${named} now?`, 'Every entry in it is published or unpublished immediately.', 'Publish now'],
			cancel: [`Cancel release ${named}?`, 'Nothing in it is published or unpublished, and you can no longer edit it.', 'Cancel release'],
			delete: [`Delete release ${named}?`, 'The release and its list of entries are removed. The entries themselves stay.', 'Delete'],
		}[action];
		if (!(await confirmDialog(copy[0], copy[1], { confirmLabel: copy[2] }))) return;
		confirmAction = action;
		// The hidden form reads the action from the DOM, so it waits for Svelte
		// to write it there.
		await tick();
		confirmForm?.requestSubmit();
	}

	async function askRemove(id: string) {
		removeEntry = id;
		await tick();
		removeForm?.requestSubmit();
	}

	function entryHref(id: string): string | null {
		const label = data.labels[id];
		return label?.schema ? `/admin/content/${encodeURIComponent(label.schema)}/${encodeURIComponent(id)}` : null;
	}
</script>

<PageShell title={release?.name ?? 'Release'} description={release?.description || undefined} width="wide" {back}>
	{#snippet actions()}
		{#if release}
			<div class="flex flex-wrap items-center gap-2">
				<Badge tone={statusTone(release.status)}>{STATUS_LABELS[release.status] ?? release.status}</Badge>
				{#if canEdit}
					<Button variant="ghost" size="sm" onclick={openEdit}><Pencil size={ICON.sm} /> Edit</Button>
					<Button variant="primary" size="sm" onclick={() => ask('publish')} disabled={blocking.length > 0 || release.item_count === 0}>
						<Send size={ICON.sm} /> Publish now
					</Button>
					<Button variant="secondary" size="sm" onclick={() => ask('cancel')}><X size={ICON.sm} /> Cancel release</Button>
				{/if}
				{#if release.status !== 'publishing'}
					<Button variant="ghost" size="sm" onclick={() => ask('delete')}>
						<Trash2 size={ICON.sm} class="text-danger" /> Delete
					</Button>
				{/if}
			</div>
		{/if}
	{/snippet}

	{#if !release}
		<GateNotice level={2} gate={data.gate} title="Releases" absent="Releases are not included in this build." />
	{:else}
		<div class="flex flex-col gap-5">
			{#if !drawerFailed}
				<FormErrors message={formError} fields={errors} {refused} />
			{/if}
			{#if success}
				<Alert tone="success" autoDismiss>{success}</Alert>
			{/if}
			{#if release.status === 'failed' && release.failure_reason}
				<Alert tone="danger" title="The release did not publish">{release.failure_reason}</Alert>
			{/if}

			<Card>
				{#snippet header()}
					<SectionHeading level={2}>Schedule</SectionHeading>
				{/snippet}
				{#if release.status === 'scheduled' && release.scheduled_at}
					<div class="flex flex-wrap items-center justify-between gap-3">
						<p class="text-sm text-fg">
							<CalendarClock size={ICON.sm} class="inline" /> Goes out {formatDateTime(release.scheduled_at)}
						</p>
						<form method="POST" action="?/unschedule" use:enhance>
							<Button variant="secondary" size="sm" type="submit">Unschedule</Button>
						</form>
					</div>
				{:else if release.status === 'draft'}
					<form method="POST" action="?/schedule" use:enhance={schedule.enhance} class="flex flex-wrap items-end gap-3">
						<input type="hidden" name="publish_at" value={publishAtUTC} />
						<DateTimePicker id="release-at" label="Publish at" bind:value={publishAt} error={errors.publish_at} />
						<Button variant="primary" size="sm" type="submit" disabled={!publishAtUTC || blocking.length > 0} loading={schedule.pending}>
							Schedule
						</Button>
					</form>
				{:else}
					<p class="text-sm text-muted">
						{release.published_at ? `Published ${formatDateTime(release.published_at)}.` : 'This release will not be published.'}
					</p>
				{/if}
			</Card>

			{#if !data.conflictsRead && !(form && 'conflicts' in form)}
				<GateNotice gate={data.conflictsGate} title="Conflicts" absent="Conflict checks are not included in this build. Conflicts are still checked when the release publishes." />
			{:else if conflicts.length > 0}
				<Card>
					{#snippet header()}
						<SectionHeading level={2}>Conflicts</SectionHeading>
					{/snippet}
					<p class="mb-3 text-sm text-muted">
						{blocking.length > 0
							? `${blocking.length} ${plural(blocking.length, 'conflict stops', 'conflicts stop')} this release from publishing. Resolve each one or remove the entry.`
							: 'None of these conflicts stop the release. Deleted entries are skipped when it publishes.'}
					</p>
					<ul class="flex flex-col gap-2 coarse:gap-6" data-testid="release-conflicts">
						{#each conflicts as c, i (`${c.entry_id}-${c.kind}-${i}`)}
							<li class="flex flex-wrap items-center gap-2 text-sm">
								<Badge tone={blocks(c) ? 'danger' : 'neutral'}>{blocks(c) ? 'Blocks' : 'Skipped'}</Badge>
								<span class="font-mono text-xs text-fg">{data.labels[c.entry_id]?.title || shortId(c.entry_id)}</span>
								<span class="text-muted">{CONFLICT_LABELS[c.kind] ?? c.detail}</span>
								{#if c.at}<span class="text-xs text-faint">{formatDateTime(c.at)}</span>{/if}
								{#if c.release_id}
									<a class="relative hit-area text-xs text-brand" href="/admin/releases/{c.release_id}">Open the other release</a>
								{/if}
							</li>
						{/each}
					</ul>
				</Card>
			{/if}

			<Card pad="none">
				{#snippet header()}
					<div class="flex items-center justify-between gap-3">
						<SectionHeading level={2}>Entries ({release.item_count})</SectionHeading>
						{#if canEdit}
							<Button variant="secondary" size="sm" onclick={openAdd}><Plus size={ICON.sm} /> Include entry</Button>
						{/if}
					</div>
				{/snippet}
				{#if (release.items ?? []).length === 0}
					<EmptyState
						title="No entries yet"
						description="Add an entry here, or from the entry's own page."
					>
						{#snippet iconSnippet()}<FileText size={ICON.lg} />{/snippet}
					</EmptyState>
				{:else}
					<Table label="Entries in the release">
						<thead>
							<tr>
								<th scope="col">Entry</th>
								<th scope="col">Content type</th>
								<th scope="col">Does</th>
								<th scope="col">Outcome</th>
								<th scope="col"><span class="sr-only">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{#each release.items ?? [] as it (it.entry_id)}
								{@const label = data.labels[it.entry_id]}
								{@const href = entryHref(it.entry_id)}
								<tr>
									<td>
										{#if href}
											<a {href} class="relative hit-area text-fg transition-colors hover:text-brand">{label?.title || shortId(it.entry_id)}</a>
										{:else}
											<span class="font-mono text-xs text-muted">{it.entry_id}</span>
										{/if}
										{#each conflictsFor(it.entry_id) as c, i (i)}
											<span class="block text-xs {blocks(c) ? 'text-danger' : 'text-faint'}">{CONFLICT_LABELS[c.kind] ?? c.detail}</span>
										{/each}
									</td>
									<td class="text-xs text-muted">{label?.schema ?? ''}</td>
									<td><Badge tone={it.action === 'publish' ? 'success' : 'warn'}>{it.action === 'publish' ? 'Publishes' : 'Unpublishes'}</Badge></td>
									<td class="text-xs text-muted">{it.outcome ?? ''}</td>
									<td class="text-right">
										{#if canEdit}
											<Button variant="ghost" size="sm" onclick={() => askRemove(it.entry_id)} aria-label="Remove {label?.title || it.entry_id}">
												<X size={ICON.sm} />
											</Button>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				{/if}
			</Card>
		</div>
	{/if}
</PageShell>

<Drawer bind:open={editOpen} title="Edit release">
	{@const own = failureOf('update')}
	<form method="POST" action="?/update" id="release-edit" use:enhance={save.enhance} class="flex flex-col gap-4">
		<FormErrors message={own.message} fields={own.fields} refused={own.refused} />
		<Input id="release-name" name="name" label="Name" required bind:value={name} error={own.fields.name} />
		<Textarea id="release-description" name="description" label="Description" rows={3} bind:value={description} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (editOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="release-edit" disabled={!name.trim()} loading={save.pending}>Save</Button>
	{/snippet}
</Drawer>

<Drawer bind:open={addOpen} title="Include an entry">
	{@const own = failureOf('addItem')}
	<form method="POST" action="?/addItem" id="release-add" use:enhance={add.enhance} class="flex flex-col gap-4">
		<FormErrors message={own.message} fields={own.fields} refused={own.refused} />
		{#if data.choices}
			<Select
				id="release-entry"
				name="entry_id"
				label="Entry"
				placeholder="Choose an entry"
				options={entryOptions}
				searchable
				required
				bind:value={picked}
				error={own.fields.entry_id}
				hint="Shows the most recently changed entries, by content type. Add an older one from its own page."
			/>
		{:else}
			<!-- The entry list could not be read, so the drawer takes an id and
			     says why it offers no list. -->
			<Input
				id="release-entry"
				name="entry_id"
				label="Entry ID"
				required
				bind:value={entryId}
				error={own.fields.entry_id}
				hint={`${couldNotLoad('the entry list')} Enter the ID shown under the entry's title on its page.`}
			/>
		{/if}
		<SegmentedControl name="action" label="When the release publishes" options={ACTIONS} bind:value={itemAction} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (addOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="release-add" disabled={!(data.choices ? picked : entryId.trim())} loading={add.pending}>Include</Button>
	{/snippet}
</Drawer>

<form method="POST" action="?/{confirmAction}" use:enhance bind:this={confirmForm} class="hidden"></form>
<form method="POST" action="?/removeItem" use:enhance bind:this={removeForm} class="hidden">
	<input type="hidden" name="entry_id" value={removeEntry} />
</form>
