<script lang="ts">
	import {
		Alert,
		Banner,
		Button,
		Card,
		CheckboxGroup,
		NumberInput,
		PageShell,
		SectionHeading,
		SegmentedControl,
		Select,
		Stat,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { Scissors, Trash2 } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { confirmed, fieldErrors, tracked } from '$lib/forms.svelte';
	import { formatBytes, formatCount, formatDateTime, formatPercent, plural } from '$lib/format';
	import { ICON } from '$lib/icon';
	import {
		HISTORY_READ_FEATURE,
		MAX_KEEP_DAYS,
		MAX_KEEP_VERSIONS,
		READ_WINDOW_DAYS,
		type HistoryMode,
		type PruneResult,
		type SettingField,
	} from '$lib/api/content-history';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Limit = 'none' | 'set';

	const MODE_OPTIONS: { value: HistoryMode; label: string }[] = [
		{ value: 'off', label: 'Off' },
		{ value: 'all', label: 'All types' },
		{ value: 'selected', label: 'Selected types' },
	];
	const DAYS_OPTIONS: { value: Limit; label: string }[] = [
		{ value: 'none', label: 'Forever' },
		{ value: 'set', label: 'A number of days' },
	];
	const VERSIONS_OPTIONS: { value: Limit; label: string }[] = [
		{ value: 'none', label: 'Unlimited' },
		{ value: 'set', label: 'A number of versions' },
	];
	const ACTIVITY_OPTIONS: { value: 'on' | 'off'; label: string }[] = [
		{ value: 'on', label: 'On' },
		{ value: 'off', label: 'Off' },
	];

	const read = $derived(data.settings.ok ? data.settings.value : null);
	const locked = $derived(new Set<SettingField>(read?.locked ?? []));
	const isLocked = (field: SettingField) => locked.has(field);

	// The controls start from what is stored and follow a save.
	let mode = $state<HistoryMode>('off');
	let schemas = $state<string[]>([]);
	let daysLimit = $state<Limit>('none');
	let keepDays = $state(30);
	let versionsLimit = $state<Limit>('none');
	let keepVersions = $state(50);
	let activity = $state<'on' | 'off'>('on');
	let activityLimit = $state<Limit>('none');
	let activityDays = $state(90);
	$effect(() => {
		const s = read?.settings;
		if (!s) return;
		mode = s.history_mode;
		schemas = [...s.schemas];
		daysLimit = s.keep_days > 0 ? 'set' : 'none';
		if (s.keep_days > 0) keepDays = s.keep_days;
		versionsLimit = s.keep_versions > 0 ? 'set' : 'none';
		if (s.keep_versions > 0) keepVersions = s.keep_versions;
		activity = s.activity_enabled ? 'on' : 'off';
		activityLimit = s.activity_keep_days > 0 ? 'set' : 'none';
		if (s.activity_keep_days > 0) activityDays = s.activity_keep_days;
	});

	const typeOptions = $derived.by(() => {
		const known = data.schemas.ok ? data.schemas.value : [];
		// A type the tenant chose stays offered even when the list did not
		// name it, so saving never drops it without the reader seeing it.
		const names = new Set(known.map((t) => t.name));
		return [
			...known.map((t) => ({ value: t.name, label: t.label })),
			...schemas.filter((n) => !names.has(n)).map((n) => ({ value: n, label: n })),
		];
	});

	/** What the environment fixes, in a sentence for the banner. */
	const lockText = $derived.by(() => {
		if (!read || read.locked.length === 0) return '';
		const parts: string[] = [];
		if (read.env.history === 'off') parts.push('Content history is off for every tenant (CONTENT_HISTORY=off).');
		if (read.env.history === 'on') parts.push('Content history is on for every type of every tenant (CONTENT_HISTORY=on).');
		if (read.env.activity === 'off') parts.push('Activity is off for every tenant (CONTENT_ACTIVITY=off).');
		if (read.env.activity === 'on') parts.push('Activity is on for every tenant (CONTENT_ACTIVITY=on).');
		parts.push('Environment variables set these, so you cannot change them here.');
		return parts.join(' ');
	});

	/**
	 * The fields the reader changed, as the form posts them. A tenant that has
	 * not chosen reads the environment's defaults, and posting one unchanged
	 * would store it as the tenant's own choice, so only a change is sent. A
	 * field the environment fixes is never sent.
	 */
	const posted = $derived.by(() => {
		const s = read?.settings;
		if (!s) return [] as [string, string][];
		const out: [string, string][] = [];
		const put = (field: SettingField, name: string, now: string, was: string) => {
			if (!isLocked(field) && now !== was) out.push([name, now]);
		};
		put('history_mode', 'history_mode', mode, s.history_mode);
		const chosen = [...schemas].sort().join('\n');
		// Selected types takes its list with it, so the plugin never reads the
		// mode without the types it names.
		if (!isLocked('schemas') && (chosen !== [...s.schemas].sort().join('\n') || (mode === 'selected' && mode !== s.history_mode))) {
			out.push(['schemas_sent', '1']);
			for (const name of schemas) out.push(['schemas', name]);
		}
		put('keep_days', 'keep_days', String(daysLimit === 'set' ? keepDays : 0), String(s.keep_days));
		put('keep_versions', 'keep_versions', String(versionsLimit === 'set' ? keepVersions : 0), String(s.keep_versions));
		put('activity_enabled', 'activity', activity, s.activity_enabled ? 'on' : 'off');
		put('activity_keep_days', 'activity_keep_days', String(activityLimit === 'set' ? activityDays : 0), String(s.activity_keep_days));
		return out;
	});

	// Versions past the read window are kept but need the capability to read.
	const olderNote = $derived(
		!data.readsOlder && mode !== 'off' && (daysLimit === 'none' || keepDays > READ_WINDOW_DAYS),
	);

	const actionName = $derived((form as { action?: string } | null)?.action ?? '');
	const errorOf = (name: string) =>
		actionName === name ? ((form as { error?: string } | null)?.error ?? '') : '';
	const fields = $derived(actionName === 'save' ? fieldErrors(form) : {});
	const pruned = $derived(actionName === 'prune' ? (form as { pruned?: PruneResult }).pruned : undefined);
	const deleted = $derived(
		actionName === 'deleteType' ? (form as { deleted?: string; commits?: number; held?: number }) : undefined,
	);

	const save = tracked(() => async ({ result, update }) => {
		await update({ reset: false });
		if (result.type === 'success') toast.success('Content history settings saved.');
	});
	const prune = tracked(() => async ({ update }) => {
		await update({ reset: false });
	});

	let deleteSchema = $state('');
	const deleteOptions = $derived(typeOptions.map((t) => ({ value: t.value, label: t.label })));
	const deleteLabel = $derived(typeOptions.find((t) => t.value === deleteSchema)?.label ?? deleteSchema);

	const usage = $derived(data.usage.ok ? data.usage.value : null);
	const saved = $derived(
		usage && usage.logical_bytes > 0 ? Math.max(0, 1 - usage.stored_bytes / usage.logical_bytes) : null,
	);
</script>

<PageShell
	title="Content history"
	description="Choose which content types keep versions and for how long, and whether to record who changed each entry."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#if !data.settings.ok || !read}
		<GateNotice
			level={2}
			gate={data.settings.ok ? { state: 'absent' } : data.settings.gate}
			title="Content history"
			absent="Content history needs a newer version of the engine."
		/>
	{:else}
		{#if lockText}
			<Banner tone="warn">{lockText}</Banner>
		{/if}

		<FormErrors message={errorOf('save')} {fields} refused={actionName === 'save' ? formRefusal(form) : null} />

		<form method="POST" action="?/save" use:enhance={save.enhance} class="flex flex-col gap-6">
			<section class="flex flex-col gap-4" aria-label="History">
				<SectionHeading level={2}>History</SectionHeading>
				<Card pad="md">
					<div class="flex flex-col gap-5">
						<SegmentedControl
							id="history-mode"
							label="Keep versions for"
							hint="A version is stored when an entry changes. A save that changes nothing stores none."
							options={MODE_OPTIONS}
							disabled={isLocked('history_mode')}
							error={fields.history_mode}
							bind:value={mode}
						/>

						{#if mode === 'selected'}
							{#if !data.schemas.ok}
								<GateNotice
									gate={data.schemas.gate}
									title="Content types"
									absent="The content type list is not included in this build, so you cannot choose types below."
								/>
							{:else if typeOptions.length === 0}
								<p class="text-sm text-muted">No content types yet.</p>
							{:else}
								<CheckboxGroup
									label="Content types that keep history"
									orientation="horizontal"
									options={typeOptions}
									disabled={isLocked('schemas')}
									error={fields.schemas}
									bind:value={schemas}
								/>
							{/if}
						{/if}

						<div class="grid gap-5 md:grid-cols-2">
							<div class="flex flex-col gap-3">
								<SegmentedControl
									id="keep-days-limit"
									label="Keep each version for"
									options={DAYS_OPTIONS}
									disabled={isLocked('keep_days')}
									bind:value={daysLimit}
								/>
								{#if daysLimit === 'set'}
									<NumberInput
										id="keep-days"
										label="Days"
										min={1}
										max={MAX_KEEP_DAYS}
										step={1}
										disabled={isLocked('keep_days')}
										error={fields.keep_days}
										bind:value={keepDays}
									/>
								{/if}
							</div>
							<div class="flex flex-col gap-3">
								<SegmentedControl
									id="keep-versions-limit"
									label="Keep at most, per entry"
									options={VERSIONS_OPTIONS}
									disabled={isLocked('keep_versions')}
									bind:value={versionsLimit}
								/>
								{#if versionsLimit === 'set'}
									<NumberInput
										id="keep-versions"
										label="Versions"
										min={1}
										max={MAX_KEEP_VERSIONS}
										step={1}
										disabled={isLocked('keep_versions')}
										error={fields.keep_versions}
										bind:value={keepVersions}
									/>
								{/if}
							</div>
						</div>
						<p class="text-xs text-muted">
							Retention runs once a day. It never removes an entry's newest version, a version a release or a
							scheduled change still needs, or anything under a legal hold. Turning history off does not delete stored versions.
						</p>
						{#if olderNote}
							<Alert tone="brand">
								Versions older than {READ_WINDOW_DAYS} days are kept. Reading them needs a license with the
								{HISTORY_READ_FEATURE} feature.
							</Alert>
						{/if}
					</div>
				</Card>
			</section>

			<section class="flex flex-col gap-4" aria-label="Activity">
				<SectionHeading level={2}>Activity</SectionHeading>
				<Card pad="md">
					<div class="flex flex-col gap-5">
						<SegmentedControl
							id="activity-enabled"
							label="Record who changed which entry"
							hint="Activity is separate from history and can stay on while history is off."
							options={ACTIVITY_OPTIONS}
							disabled={isLocked('activity_enabled')}
							error={fields.activity_enabled}
							bind:value={activity}
						/>
						<div class="flex flex-col gap-3 md:w-1/2">
							<SegmentedControl
								id="activity-keep-limit"
								label="Keep activity for"
								options={DAYS_OPTIONS}
								disabled={isLocked('activity_keep_days')}
								bind:value={activityLimit}
							/>
							{#if activityLimit === 'set'}
								<NumberInput
									id="activity-keep-days"
									label="Days"
									min={1}
									max={MAX_KEEP_DAYS}
									step={1}
									disabled={isLocked('activity_keep_days')}
									error={fields.activity_keep_days}
									bind:value={activityDays}
								/>
							{/if}
						</div>
						<p class="text-xs text-muted">
							Read it under <a href="/admin/content-activity" class="underline hover:text-fg">Content activity</a>.
						</p>
					</div>
				</Card>
			</section>

			{#each posted as [name, value], i (i)}
				<input type="hidden" {name} {value} />
			{/each}
			<div class="flex flex-wrap items-center gap-2">
				<Button variant="primary" type="submit" loading={save.pending}>Save</Button>
				{#if read.settings.updated_at}
					<span class="text-xs text-faint">Last changed {formatDateTime(read.settings.updated_at)}</span>
				{/if}
			</div>
		</form>

		<section class="flex flex-col gap-4" aria-label="Storage">
			<SectionHeading level={2}>Storage</SectionHeading>
			{#if !data.usage.ok || !usage}
				<GateNotice
					gate={data.usage.ok ? { state: 'absent' } : data.usage.gate}
					title="Content history storage"
					absent="Storage figures need a newer version of the engine."
				/>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="history-usage">
					<Stat
						label="Stored"
						value={formatBytes(usage.stored_bytes)}
						sub={saved === null ? undefined : `${formatPercent(saved)} less than full copies`}
					/>
					<Stat label="As full copies" value={formatBytes(usage.logical_bytes)} sub="Size if every version were stored in full" />
					<Stat
						label="Versions"
						value={formatCount(usage.commits)}
						sub={usage.oldest_at ? `Oldest ${formatDateTime(usage.oldest_at)}` : undefined}
					/>
					<Stat
						label="Earlier revisions"
						value={formatCount(usage.legacy_rows)}
						sub={`${formatBytes(usage.legacy_bytes)}, stored in the older format. Retention removes them too.`}
					/>
				</div>
			{/if}

			<Card pad="md">
				<div class="flex flex-col gap-3">
					<p class="text-sm text-muted">
						Run retention for this tenant now instead of waiting for the daily run.
					</p>
					<FormErrors message={errorOf('prune')} />
					{#if pruned?.done}
						<Alert tone="success" autoDismiss>
							Removed {formatCount(pruned.commits)} versions, {formatCount(pruned.legacy_rows)} earlier revisions and
							{formatCount(pruned.activity_rows)} activity rows.
						</Alert>
					{:else if pruned}
						<Alert tone="brand">
							Removed {formatCount(pruned.commits)} versions, {formatCount(pruned.legacy_rows)} earlier revisions and
							{formatCount(pruned.activity_rows)} activity rows so far. Pruning continues in the background.
						</Alert>
					{/if}
					<form method="POST" action="?/prune" use:enhance={prune.enhance}>
						<Button variant="secondary" type="submit" loading={prune.pending}>
							<Scissors size={ICON.sm} aria-hidden="true" /> Prune now
						</Button>
					</form>
				</div>
			</Card>

			<Card pad="md">
				<form
					method="POST"
					action="?/deleteType"
					class="flex flex-col gap-3"
					use:enhance={(input) =>
						confirmed(
							`Delete every version of ${deleteLabel}?`,
							'The entries stay as they are. Their stored versions cannot be recovered.',
							{
								confirmLabel: 'Delete',
								success: (d) => {
									const n = Number(d?.commits ?? 0);
									return `${formatCount(n)} ${plural(n, 'version')} of ${deleteLabel} deleted.`;
								},
							},
						)(input)}
				>
					<p class="text-sm text-muted">Delete every stored version of one content type. Its entries are not changed.</p>
					<FormErrors message={errorOf('deleteType')} />
					{#if deleted?.deleted && (deleted.held ?? 0) > 0}
						<Alert tone="warn">
							A legal hold kept {formatCount(deleted.held)}
							{plural(deleted.held ?? 0, 'version')} of {typeOptions.find((t) => t.value === deleted.deleted)?.label ?? deleted.deleted}.
							They stay until the hold is lifted.
						</Alert>
					{/if}
					<div class="flex flex-wrap items-end gap-2">
						<Select
							id="delete-type"
							name="schema"
							label="Content type"
							placeholder="Choose a type"
							options={deleteOptions}
							searchable={deleteOptions.length > 10}
							bind:value={deleteSchema}
							class="w-64"
						/>
						<Button variant="danger" type="submit" disabled={!deleteSchema}>
							<Trash2 size={ICON.sm} aria-hidden="true" /> Delete history
						</Button>
					</div>
				</form>
			</Card>
		</section>
	{/if}
</PageShell>
