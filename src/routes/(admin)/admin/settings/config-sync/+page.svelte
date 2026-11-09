<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Card,
		Checkbox,
		DescriptionList,
		FileInput,
		PageShell,
		PasswordInput,
		SectionHeading,
		Table,
		confirm,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Download } from '@lucide/svelte';
	import type { ActionData } from './$types';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { fieldErrors } from '$lib/forms.svelte';
	import { featureName, formRefusal } from '$lib/api/refusal';
	import {
		ACTION_LABELS,
		MIN_PASSPHRASE,
		actionCounts,
		actionTone,
		parseBundle,
		sectionLabel,
		sectionOrder,
		type ApplyResult,
		type ConfigBundle,
		type SyncPlan,
	} from '$lib/api/config-sync';
	import { formatDateTime, plural } from '$lib/format';
	import { ICON } from '$lib/icon';

	let { form }: { form: ActionData } = $props();

	const scope = $derived(form && 'scope' in form ? form.scope : null);
	const errors = $derived(fieldErrors(form));
	const formError = $derived(form && 'error' in form && typeof form.error === 'string' ? form.error : '');
	const refused = $derived(formRefusal(form));

	// The export.
	let exportPass = $state('');
	let exporting = $state(false);
	const exported = $derived(form && scope === 'export' && 'bundle' in form && typeof form.bundle === 'string' ? form : null);
	// An object URL, because the kit refuses a data URL as a link. It exists
	// only in the browser and is released when the export it holds is replaced.
	let downloadHref = $state('');
	$effect(() => {
		if (!exported || typeof URL.createObjectURL !== 'function') {
			downloadHref = '';
			return;
		}
		const url = URL.createObjectURL(new Blob([exported.bundle], { type: 'application/json' }));
		downloadHref = url;
		return () => URL.revokeObjectURL(url);
	});

	const exportEnhance: SubmitFunction = () => {
		exporting = true;
		return async ({ update }) => {
			try {
				await update({ reset: false });
			} finally {
				exporting = false;
			}
		};
	};

	// The bundle is read in the browser and sent as text, so a dropped file
	// works the same as a chosen one and the bundle stays loaded between a
	// compare, a dry run and an apply.
	let bundleText = $state('');
	let bundleName = $state('');
	let bundleError = $state('');
	let loaded = $state<ConfigBundle | null>(null);
	let syncPass = $state('');
	let prune = $state(false);
	let running = $state<'diff' | 'dry-run' | 'apply' | null>(null);
	let syncForm: HTMLFormElement | undefined = $state();

	async function chooseFile(files: FileList | null) {
		const file = files?.[0];
		bundleError = '';
		loaded = null;
		bundleText = '';
		bundleName = file?.name ?? '';
		if (!file) return;
		const text = await file.text();
		const parsed = parseBundle(text);
		if ('error' in parsed) {
			bundleError = parsed.error;
			return;
		}
		bundleText = text;
		loaded = parsed.bundle;
	}

	const loadedItems = $derived(
		loaded
			? [
					{ term: 'File', value: bundleName },
					{ term: 'Exported from', value: loaded.source || 'Not named' },
					{ term: 'Exported', value: loaded.exported_at ? formatDateTime(loaded.exported_at) : 'Not dated' },
					{ term: 'Sections', value: sectionOrder(Object.keys(loaded.sections)).map(sectionLabel).join(', ') || 'None' },
				]
			: [],
	);

	const syncEnhance: SubmitFunction = ({ action }) => {
		running = action.search.includes('apply') ? 'apply' : action.search.includes('dryRun') ? 'dry-run' : 'diff';
		return async ({ update }) => {
			try {
				await update({ reset: false });
			} finally {
				running = null;
			}
		};
	};

	async function confirmApply() {
		const ok = await confirm(
			'Apply this bundle?',
			prune
				? 'This engine will match the bundle. Flows, permission rules and webhooks that are not in the bundle are deleted. Content types are never deleted.'
				: 'This engine will match the bundle. Nothing missing from the bundle is deleted.',
			{ confirmLabel: 'Apply' },
		);
		if (!ok || !syncForm) return;
		// The submit reads the form's action as it starts, so pointing the form
		// at apply for the one call sends this submit there and no other.
		syncForm.action = '?/apply';
		syncForm.requestSubmit();
		syncForm.action = '?/diff';
	}

	const syncResult = $derived(form && scope === 'sync' ? form : null);
	const plan = $derived<SyncPlan | null>(syncResult && 'plan' in syncResult && syncResult.plan ? (syncResult.plan as SyncPlan) : null);
	const mode = $derived(syncResult && 'mode' in syncResult ? syncResult.mode : null);
	const result = $derived<ApplyResult | null>(syncResult && 'result' in syncResult && syncResult.result ? (syncResult.result as ApplyResult) : null);
	const failed = $derived(result?.failed ?? null);
	const blocked = $derived((plan?.problems ?? 0) > 0);
	const syncMessage = $derived(scope === 'sync' && !plan && !refused ? formError : '');
	const exportMessage = $derived(scope === 'export' && !refused ? formError : '');

	const planHeading = $derived(
		mode === 'dry-run' ? 'Dry run: what applying would do' : mode === 'apply' ? 'The plan the apply ran' : 'What applying does',
	);

	const sections = $derived(plan ? sectionOrder(Object.keys(plan.sections)) : []);

	function failedAt(f: { section: string; key?: string }): string {
		return f.key ? `${sectionLabel(f.section)}, ${f.key}` : sectionLabel(f.section);
	}

	/** The engine's message reads as a clause, so the page makes it a sentence. */
	function sentence(text: string): string {
		const t = text.trim();
		if (!t) return '';
		const capped = t.charAt(0).toUpperCase() + t.slice(1);
		return /[.!?]$/.test(capped) ? capped : `${capped}.`;
	}

	function namesOrNone(names: readonly string[] | undefined, label = (n: string) => n): string {
		return names && names.length > 0 ? names.map(label).join(', ') : 'None';
	}
</script>

<PageShell
	title="Config sync"
	description="Move content types, flows, permission rules, webhooks and settings from one engine to another in one bundle. Content is never included."
	width="wide"
>
	{#snippet actions()}
		<Badge tone="violet" size="sm">Beta</Badge>
	{/snippet}

	{#if refused}
		<RefusalNotice refusal={refused} />
	{/if}

	<Card title="Export this engine" description="Download every section as one file to apply on another engine.">
		<form method="POST" action="?/export" use:enhance={exportEnhance} class="flex flex-col gap-4" data-testid="export-form">
			<PasswordInput
				id="export-passphrase"
				name="passphrase"
				label="Passphrase"
				autocomplete="new-password"
				required
				bind:value={exportPass}
				error={scope === 'export' ? errors.passphrase : undefined}
				hint="At least {MIN_PASSPHRASE} characters. It encrypts every webhook secret and header in the bundle, and you need it to apply the bundle on another engine. Store it separately from the file."
			/>
			{#if exportMessage}
				<Alert tone="danger">{exportMessage}</Alert>
			{/if}
			{#if exported}
				<div class="flex flex-col gap-3" data-testid="export-ready">
					<Alert tone="success" autoDismiss>The bundle is ready.</Alert>
					<p class="text-sm text-muted">
						Sections: {namesOrNone(exported.sections, sectionLabel)}.
					</p>
					<div class="flex flex-col items-start gap-1">
						<Button variant="secondary" href={downloadHref || undefined} disabled={!downloadHref} download={exported.filename}>
							<Download size={ICON.sm} /> Download {exported.filename}
						</Button>
						<!-- A standing caveat, so it stays beside the download rather
						     than clearing itself with the outcome above. -->
						<p class="text-xs text-muted">Anyone holding the bundle and the passphrase can read every secret in it.</p>
					</div>
				</div>
			{/if}
			<div>
				<Button variant="primary" type="submit" loading={exporting} disabled={exportPass.length < MIN_PASSPHRASE}>Export</Button>
			</div>
		</form>
	</Card>

	<Card title="Apply a bundle" description="Compare a bundle with this engine, dry run it, then apply it.">
		<form
			method="POST"
			action="?/diff"
			use:enhance={syncEnhance}
			bind:this={syncForm}
			class="flex flex-col gap-4"
			data-testid="sync-form"
		>
			<input type="hidden" name="bundle" value={bundleText} />
			<input type="hidden" name="prune" value={prune ? 'true' : 'false'} />
			<FileInput
				id="bundle-file"
				label="Bundle file"
				accept=".json,application/json"
				hint="The JSON file you downloaded from an export."
				error={bundleError || (scope === 'sync' ? errors.bundle : undefined)}
				onchange={chooseFile}
			/>
			{#if loaded}
				<DescriptionList items={loadedItems} />
			{/if}
			<PasswordInput
				id="sync-passphrase"
				name="passphrase"
				label="Passphrase"
				autocomplete="off"
				required
				bind:value={syncPass}
				error={scope === 'sync' ? errors.passphrase : undefined}
				hint="The passphrase the bundle was exported with."
			/>
			<Checkbox
				id="sync-prune"
				label="Delete items not in the bundle"
				description="Removes flows, permission rules and webhooks that exist only on this engine. Content types are never deleted."
				bind:checked={prune}
			/>
			{#if syncMessage}
				<Alert tone="danger">{syncMessage}</Alert>
			{/if}
			<div class="flex flex-wrap gap-2">
				<Button variant="secondary" type="submit" formaction="?/diff" loading={running === 'diff'} disabled={!loaded || !syncPass || running !== null}>
					Compare
				</Button>
				<Button variant="secondary" type="submit" formaction="?/dryRun" loading={running === 'dry-run'} disabled={!loaded || !syncPass || running !== null}>
					Dry run
				</Button>
				<Button variant="primary" onclick={confirmApply} loading={running === 'apply'} disabled={!loaded || !syncPass || running !== null || blocked}>
					Apply
				</Button>
			</div>
		</form>
	</Card>

	{#if result && result.applied}
		<Alert tone="success" autoDismiss>Applied. This engine now matches the bundle.</Alert>
		<DescriptionList
			items={[
				{ term: 'Content types written', value: namesOrNone(result.schemas_applied) },
				{ term: 'Sections written', value: namesOrNone(result.sections_applied, sectionLabel) },
			]}
		/>
	{:else if failed && result}
		<div data-testid="apply-failure" class="flex flex-col gap-3">
			<Alert tone="danger" title="The apply stopped at {failedAt(failed)}">
				<p>{sentence(failed.message)}</p>
			</Alert>
			<DescriptionList
				items={[
					{ term: 'Stopped at', value: failedAt(failed) },
					{ term: 'Applied and kept', value: namesOrNone(result.schemas_applied) },
					{ term: 'Not applied', value: namesOrNone(result.not_applied, sectionLabel) },
				]}
			/>
			<p class="text-sm text-muted">
				Content types listed as applied were saved and stay. Every other section was rolled back. Fix the cause and
				apply the same bundle again. Anything that already matches is left unchanged.
			</p>
		</div>
	{/if}

	{#if plan}
		<section class="flex flex-col gap-4" data-testid="sync-plan" aria-label="Plan">
			<SectionHeading level={2}>{planHeading}</SectionHeading>
			{#if mode === 'dry-run'}
				<p class="text-sm text-muted">Nothing was written.</p>
			{/if}
			{#if blocked}
				<Alert tone="danger" title="{plan.problems} {plural(plan.problems, 'problem stops', 'problems stop')} the apply">
					Fix every problem below, here or in the bundle, before you apply. Nothing is written until then.
				</Alert>
			{:else if plan.changes === 0}
				<Alert tone="success">This engine already matches the bundle.</Alert>
			{/if}

			{#each sections as name (name)}
				{@const section = plan.sections[name]}
				{@const counts = actionCounts(section)}
				{@const rows = section.changes.filter((c) => c.action !== 'unchanged' || c.note)}
				<div class="flex flex-col gap-3" data-testid="plan-section-{name}">
					<div class="flex flex-wrap items-center gap-2">
						<SectionHeading level={3}>{sectionLabel(name)}</SectionHeading>
						{#each ['create', 'update', 'delete', 'unchanged'] as const as a (a)}
							{#if counts[a] > 0}
								<Badge tone={actionTone(a)} size="sm">{counts[a]} {ACTION_LABELS[a].toLowerCase()}</Badge>
							{/if}
						{/each}
					</div>
					{#if section.problems && section.problems.length > 0}
						<Alert tone="danger">
							<ul class="flex flex-col gap-1">
								{#each section.problems as p, i (i)}
									<li>
										{#if p.key}<span class="font-mono text-xs">{p.key}</span>:{/if}
										{p.message}{#if p.feature}&nbsp;(needs {featureName(p.feature)}){/if}
									</li>
								{/each}
							</ul>
						</Alert>
					{/if}
					{#if rows.length > 0}
						<Table label="{sectionLabel(name)} changes">
							<thead>
								<tr>
									<th scope="col">Name</th>
									<th scope="col">Change</th>
									<th scope="col">Fields</th>
									<th scope="col">Note</th>
								</tr>
							</thead>
							<tbody>
								{#each rows as c (c.key + c.action)}
									<tr>
										<td class="font-mono text-xs">{c.key}</td>
										<td><Badge tone={actionTone(c.action)} size="sm">{ACTION_LABELS[c.action] ?? c.action}</Badge></td>
										<td class="text-xs text-muted">{c.fields?.join(', ') ?? ''}</td>
										<td class="text-xs text-muted">{c.note ?? ''}</td>
									</tr>
								{/each}
							</tbody>
						</Table>
					{:else if !section.problems?.length}
						<p class="text-sm text-muted">Nothing to change.</p>
					{/if}
				</div>
			{/each}
		</section>
	{/if}
</PageShell>
