<script lang="ts">
	import FormErrors from '$lib/components/FormErrors.svelte';
	import OlderHidden from '$lib/components/OlderHidden.svelte';
	import { Badge, Breadcrumb, Button, Card, NumberInput, PageShell, SectionHeading } from '@lyeve-labs/ui-kit';
	import type { PageData, ActionData } from './$types';
	import type { SchemaField } from '@lyeve-labs/client';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { Clock, Eye, EyeOff, History, RotateCcw } from '@lucide/svelte';
	import { crumbsAfter } from '$lib/breadcrumb';
	import { listBack } from '$lib/back';
	import { buildFromData, validate, serialize, extractM2MRelations } from '$lib/utils/content-form';
	import { entryTitle, shortId } from '$lib/utils/entry-identity';
	import { formatDateTime } from '$lib/format';
	import ContentForm from '$lib/components/ContentForm.svelte';
	import TranslationsPanel from '$lib/components/TranslationsPanel.svelte';
	import ReviewBar from '$lib/components/ReviewBar.svelte';
	import CommentsPanel from '$lib/components/content/CommentsPanel.svelte';
	import AddToRelease from '$lib/components/content/AddToRelease.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { ICON } from '$lib/icon';
	import { tracked } from '$lib/forms.svelte';
	import { couldNotLoad } from '$lib/outage';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let userFields = $derived((data.schemaDef?.fields ?? []).filter((f: SchemaField) => !f.system));

	// Pre-fill from the loaded item.
	// svelte-ignore state_referenced_locally
	let formValues = $state<Record<string, unknown>>(
		buildFromData(data.schemaDef?.fields ?? [], data.item?.data ?? {}),
	);

	// Every action on this page redirects back to this same route, which swaps
	// `data` without remounting, so a one-time initializer would go on showing
	// the pre-action values and restore would appear to do nothing. Plain
	// variable, not $state, so the effect does not depend on what it writes.
	// svelte-ignore state_referenced_locally
	let seededVersion = `${data.item?.id}:${data.item?.updated_at}`;
	$effect(() => {
		const version = `${data.item?.id}:${data.item?.updated_at}`;
		if (version === seededVersion) return;
		seededVersion = version;
		formValues = buildFromData(data.schemaDef?.fields ?? [], data.item?.data ?? {});
	});
	let validationErrors = $state<Record<string, string>>({});
	let errorKeys = $state<Record<string, string>>({});
	const save = tracked(() => {});

	let serialized = $derived(serialize(userFields, formValues));
	let m2mRelations = $derived(
		JSON.stringify(
			Object.fromEntries(
				extractM2MRelations(userFields, formValues).map((r) => [r.fieldName, r.ids]),
			),
		),
	);

	// A value the plugin refused comes back by field, so each control marks its
	// own message the way a value refused before sending does.
	$effect(() => {
		if (form && 'fieldErrors' in form && form.fieldErrors) {
			validationErrors = form.fieldErrors as Record<string, string>;
			errorKeys = ('errorKeys' in form && form.errorKeys ? form.errorKeys : {}) as Record<string, string>;
		}
	});

	function handleSubmit(e: SubmitEvent) {
		const errors = validate(userFields, formValues);
		if (Object.keys(errors).length > 0) {
			e.preventDefault();
			validationErrors = errors;
			errorKeys = {};
		}
	}

	let schemaName = $derived(data.schemaDef?.name ?? '');
	let schemaLabel = $derived(data.schemaDef?.display_name || schemaName);
	// The list forwards its page on the row link, so the way back lands on
	// the page the reader left rather than on the first.
	let back = $derived(listBack(`/admin/content/${schemaName}`, schemaLabel, page.url, ['limit', 'offset']));
	let entryId = $derived(data.item?.id ?? '');

	// The heading names the entry the author named, not the first eight
	// characters of its id. The full id stays in the description, where it is
	// the thing an operator copies into a query.
	let resolved = $derived(
		data.item ? entryTitle(data.item, userFields) : { label: '', source: 'none' as const },
	);
	let heading = $derived(resolved.source === 'none' ? 'Untitled entry' : resolved.label);

	let itemStatus = $derived((data.item?.data?._status as string) ?? 'published');
	let isPublished = $derived(itemStatus === 'published');

	// History panel
	let showHistory = $state(false);
	let selectedRev = $state<string | null>(null);

	type Revision = {
		id: string;
		revision_num: number;
		data: Record<string, unknown>;
		created_by: string;
		created_at: string;
	};
	let revisions = $derived((data.revisions ?? []) as Revision[]);

	// The plugin lists only the revisions this install reads, and says how
	// many older ones it left out and over what window. Both numbers are its
	// own, so the panel states no window of its own.
	let hiddenOlder = $derived(data.revisionWindow?.hiddenOlder ?? 0);
	let windowDays = $derived(data.revisionWindow?.windowDays ?? null);
	let olderHidden = $derived(hiddenOlder > 0 && windowDays !== null);
	// The type keeps no history and none is stored. An engine that does not
	// say reads as today, where every entry keeps history.
	let historyOff = $derived(
		data.historyEnabled === false && !data.revisionsFailed && revisions.length === 0 && hiddenOlder === 0,
	);
	// One read lists at most the engine's page ceiling. Past it, the count is
	// the plugin's total and the older revisions open one at a time by number.
	let revisionTotal = $derived(Math.max(data.revisionTotal ?? 0, revisions.length));
	let olderUnlisted = $derived(revisionTotal - revisions.length);
	// The revision just older than the oldest listed. Opening it is how the
	// panel asks, and the plugin answers 402 when it is outside the window.
	let nextOlder = $derived(
		revisions.length > 0 ? Math.min(...revisions.map((r) => r.revision_num)) - 1 : 0,
	);
	// The number the opener asks for. It starts at the next older revision and
	// takes any number down to the first, so every revision can be opened.
	let openNum = $state(0);
	$effect(() => {
		if (openNum < 1 || openNum > nextOlder) openNum = nextOlder;
	});

	// A refusal from opening or restoring a revision stays in the panel.
	let revisionError = $derived(form && 'revision' in form && form.revision === true ? (form.error ?? '') : '');
	let revisionRefusal = $derived(revisionError ? formRefusal(form) : null);
	let openedRevision = $derived(
		form && 'openedRevision' in form && form.openedRevision ? (form.openedRevision as Revision) : null,
	);
	$effect(() => {
		if (revisionError || openedRevision) showHistory = true;
	});

	// A refusal from a translation action names its locale. The entry form's
	// own refusal does not, and each panel shows only its own.
	let translationError = $derived(
		form && 'translationLocale' in form && typeof form.translationLocale === 'string'
			? { message: form.error ?? '', locale: form.translationLocale }
			: null,
	);

	// A refusal from a review action stays in the bar, with the status the
	// engine gave it, so a 403 reads as a rule rather than a broken save.
	let reviewError = $derived(
		form && 'review' in form && form.review === true
			? { message: form.error ?? '', status: typeof form.reviewStatus === 'number' ? form.reviewStatus : 0 }
			: null,
	);

	// The comments panel and the release card each show only their own
	// refusal, and neither reaches the entry form.
	let commentError = $derived(form && 'comments' in form && form.comments === true ? (form.error ?? '') : '');
	let releaseError = $derived(form && 'release' in form && form.release === true ? (form.error ?? '') : '');
	let sideRefusal = $derived(commentError || releaseError ? formRefusal(form) : null);

	function revDiff(rev: Revision): string {
		const keys = Object.keys(rev.data ?? {}).filter((k) => !['_status', '_locale'].includes(k));
		const shown = keys.slice(0, 3).join(', ');
		return keys.length > 3 ? `${shown} and ${keys.length - 3} more` : shown;
	}
</script>

<PageShell title={heading} description={entryId} width="wide" {back}>
	{#snippet breadcrumb()}
		<Breadcrumb
			items={crumbsAfter(back, [
				{ label: 'Content', href: '/admin/content' },
				{ label: schemaLabel, href: `/admin/content/${schemaName}` },
				{ label: heading },
			])}
		/>
	{/snippet}

	{#snippet actions()}
		<div class="flex flex-col items-end gap-2">
			{#if data.schemaDef?.with_draft_publish}
				<div class="flex items-center gap-2">
					<Badge tone={isPublished ? 'success' : 'warn'}>{itemStatus}</Badge>
					{#if isPublished}
						<form method="POST" action="?/unpublish" use:enhance>
							<Button variant="secondary" size="sm" type="submit">
								<EyeOff size={ICON.sm} /> Unpublish
							</Button>
						</form>
					{:else}
						<form method="POST" action="?/publish" use:enhance>
							<Button variant="primary" size="sm" type="submit">
								<Eye size={ICON.sm} /> Publish
							</Button>
						</form>
					{/if}
				</div>
			{/if}
			<div class="flex items-center gap-2">
				{#if revisions.length > 0 || hiddenOlder > 0}
					<Button
						variant="ghost"
						size="sm"
						type="button"
						onclick={() => (showHistory = !showHistory)}
					>
						<History size={ICON.sm} /> History ({revisionTotal})
					</Button>
				{/if}
				{#if data.revisionsFailed}
					<span class="text-xs text-muted">{couldNotLoad('the revision history', { reload: true })}</span>
				{/if}
				{#if historyOff}
					<span class="text-xs text-muted" data-testid="history-off">
						History is off for this type.
						{#if data.canManageHistory}
							<a href="/admin/settings/content-history" class="underline hover:text-fg">Turn it on in settings</a>
						{/if}
					</span>
				{/if}
				<div class="flex flex-col items-end gap-1 text-xs text-faint">
					<span class="flex items-center gap-1">
						<Clock size={ICON.xs} /> Created {formatDateTime(data.item?.created_at ?? '')}
					</span>
					{#if data.schemaDef?.with_updated_at}
						<span class="flex items-center gap-1">
							<Clock size={ICON.xs} /> Updated {formatDateTime(data.item?.updated_at ?? '')}
						</span>
					{/if}
				</div>
			</div>
		</div>
	{/snippet}

	<div class="flex items-start gap-5">
		<div class="min-w-0 flex-1">
			{#if data.review}
				<div class="mb-5">
					<ReviewBar
						entryId={entryId}
						assignment={data.review.assignment}
						stages={data.review.stages}
						definitions={data.review.definitions}
						approvalsNeeded={data.review.approvalsNeeded}
						userId={data.review.userId}
						people={data.review.people}
						unavailable={data.review.unavailable}
						forbidden={data.review.forbidden}
						definitionsFailed={data.review.definitionsFailed}
						error={reviewError?.message}
						errorStatus={reviewError?.status}
					/>
				</div>
			{/if}

			<form
				method="POST"
				action="?/save"
				use:enhance={save.enhance}
				onsubmit={handleSubmit}
				class="flex flex-col gap-5"
			>
				<input type="hidden" name="data" value={serialized} />
				<input type="hidden" name="m2m_relations" value={m2mRelations} />

				<Card>
					<div class="flex flex-col gap-5">
						<ContentForm
							fields={userFields}
							{formValues}
							{validationErrors}
							{errorKeys}
							relations={data.relations}
							mediaChoices={data.mediaChoices}
							error={translationError || reviewError || commentError || releaseError || revisionError ? null : form?.error}
							label="{schemaLabel} entry"
						/>
					</div>
				</Card>

				<div class="flex justify-end">
					<Button type="submit" loading={save.pending}>Save</Button>
				</div>
			</form>

			{#if data.releases}
				<div class="mt-5">
					<AddToRelease
						releases={data.releases.open}
						holding={data.releases.holding}
						failed={data.releases.failed}
						error={releaseError || undefined}
						refused={releaseError ? sideRefusal : null}
						added={!!form && 'addedToRelease' in form}
					/>
				</div>
			{/if}

			{#if data.comments}
				<div class="mt-5">
					<CommentsPanel
						threads={data.comments.threads}
						people={data.comments.people}
						mentionable={data.comments.mentionable}
						unavailable={data.comments.unavailable}
						error={commentError || undefined}
						refused={commentError ? sideRefusal : null}
					/>
				</div>
			{/if}

			{#if data.localization}
				<div class="mt-5">
					<TranslationsPanel
						fields={userFields}
						locales={data.localization.locales}
						translations={data.localization.translations}
						unavailable={data.localization.unavailable}
						error={translationError?.message}
						errorLocale={translationError?.locale}
					/>
				</div>
			{/if}
		</div>

		{#if showHistory}
			<aside data-testid="revision-history" class="w-64 shrink-0">
				<Card pad="none">
					{#snippet header()}
						<SectionHeading level={3}>Revision history</SectionHeading>
					{/snippet}
					<ul class="max-h-96 divide-y divide-line overflow-y-auto">
						{#each revisions as rev (rev.id)}
							<li class="px-4 py-3 {selectedRev === rev.id ? 'bg-surface-2/60' : ''}">
								<button
									type="button"
									class="w-full rounded text-left outline-none focus-visible:ring-2
										focus-visible:ring-focus"
									onclick={() => (selectedRev = selectedRev === rev.id ? null : rev.id)}
								>
									<span class="block text-xs text-fg">{formatDateTime(rev.created_at)}</span>
									<span class="mt-0.5 block truncate text-xs text-faint">{revDiff(rev)}</span>
								</button>
								{#if selectedRev === rev.id}
									<form method="POST" action="?/restore" use:enhance class="mt-2">
										<input type="hidden" name="rev_num" value={rev.revision_num} />
										<Button variant="secondary" size="sm" type="submit">
											<RotateCcw size={ICON.sm} /> Restore
										</Button>
									</form>
								{/if}
							</li>
						{/each}
					</ul>
					{#if openedRevision}
						<div class="border-t border-line px-4 py-3" data-testid="opened-revision">
							<p class="text-xs font-medium text-fg">Revision {openedRevision.revision_num}</p>
							<p class="mt-0.5 text-xs text-faint">{formatDateTime(openedRevision.created_at)}</p>
							<p class="mt-0.5 truncate text-xs text-faint">{revDiff(openedRevision)}</p>
							<form method="POST" action="?/restore" use:enhance class="mt-2">
								<input type="hidden" name="rev_num" value={openedRevision.revision_num} />
								<Button variant="secondary" size="sm" type="submit">
									<RotateCcw size={ICON.sm} /> Restore
								</Button>
							</form>
						</div>
					{/if}
					{#if olderHidden || olderUnlisted > 0 || revisionError}
						<div class="flex flex-col gap-3 border-t border-line p-3">
							{#if olderUnlisted > 0 && !olderHidden}
								<p class="text-xs text-muted">
									Showing the newest {revisions.length} of {revisionTotal} revisions. Open an older one by its number.
								</p>
								{#if nextOlder > 0}
									{@render revisionOpener()}
								{/if}
							{/if}
							{#if olderHidden}
								<OlderHidden count={hiddenOlder} noun="revisions" {windowDays}>
									{#if nextOlder > 0}
										{@render revisionOpener()}
									{/if}
								</OlderHidden>
							{/if}
							{#if revisionError}
								<FormErrors message={revisionError} refused={revisionRefusal} />
							{/if}
						</div>
					{/if}
				</Card>
			</aside>
		{/if}
	</div>
</PageShell>

<!-- Opens an older revision by number, from one up to the next older than the oldest listed. -->
{#snippet revisionOpener()}
	<form method="POST" action="?/openRevision" use:enhance class="flex items-end gap-2" data-testid="open-revision">
		<NumberInput
			id="open-revision-num"
			name="rev_num"
			label="Revision number"
			min={1}
			max={nextOlder}
			bind:value={openNum}
			class="min-w-0 flex-1"
		/>
		<Button variant="secondary" size="sm" type="submit">Open</Button>
	</form>
{/snippet}
