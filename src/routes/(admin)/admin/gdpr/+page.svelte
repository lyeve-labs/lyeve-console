<script lang="ts">
	import { Alert, Button, Card, CheckboxGroup, Input, PageShell, SectionHeading } from '@lyeve-labs/ui-kit';
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import { Download, Trash2, FileJson } from '@lucide/svelte';
	import type { DsarExportResult, DsarEraseResult } from '@lyeve-labs/client-rest';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import NotRunning from '$lib/components/NotRunning.svelte';
	import { PLUGIN } from '$lib/plugin-names';
	import { formRefusal } from '$lib/api/refusal';
	import { ICON } from '$lib/icon';
	import { tracked } from '$lib/forms.svelte';
	import { plural } from '$lib/format';
	import type { StepUpFactor } from '$lib/api/export-step-up';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const FACTOR_OPTIONS: { value: StepUpFactor; label: string; description: string }[] = [
		{
			value: 'password',
			label: 'Their password',
			description:
				'They type their password again. Someone who signs in only through an identity provider has no password here, and cannot export while this is ticked.',
		},
		{
			value: 'code',
			label: 'A code from their authenticator app',
			description: 'Someone without two-factor authentication set up cannot export while this is ticked.',
		},
		{
			value: 'email',
			label: 'A code sent to their email address',
			description: 'A one-time code is sent to the address on the account. Email must be set up.',
		},
	];

	// The factors start from what is stored and follow a save.
	let factors = $state<string[]>([]);
	$effect(() => {
		if (data.stepUp?.ok) factors = [...data.stepUp.value.factors];
	});
	const stepUpResult = $derived(
		form?.action === 'stepUp' ? { ...(form as { ok?: boolean; error?: string }), refused: formRefusal(form) } : null,
	);
	const saveStepUp = tracked(() => async ({ update }) => {
		await update({ reset: false });
	});

	let exportSubject = $state('');
	let eraseSubject = $state('');
	let eraseConfirm = $state('');
	let exporting = $state(false);
	let erasing = $state(false);

	const canErase = $derived(
		eraseSubject.trim().length > 0 && eraseConfirm.trim() === eraseSubject.trim()
	);

	const confirmError = $derived(
		eraseConfirm.length > 0 && !canErase ? 'Type the subject exactly as above.' : undefined
	);

	const exportResult = $derived(
		form?.action === 'export' && form.ok ? (form.result as DsarExportResult) : null
	);
	/**
	 * The engine also names the legal holds that stopped an erasure. The
	 * client's type does not carry them yet, so the page reads them through
	 * its own.
	 */
	interface HeldErasure extends DsarEraseResult {
		holds?: { id: string; reason?: string }[];
		complete?: boolean;
		failed?: string[];
	}

	const eraseResult = $derived(
		form?.action === 'erase' && form.ok ? (form.result as HeldErasure) : null
	);
	// An active hold stops the whole erasure before anything is erased. The
	// answer then carries no rows and no errors, which alone reads as done.
	const eraseHolds = $derived(eraseResult?.holds ?? []);
	// A plugin that failed to erase still holds the subject's data. The rows
	// erased elsewhere do not make the request complete.
	const eraseFailures = $derived(eraseResult?.errors ?? []);
	// An unfinished answer that names no failed part kept rows under an
	// address another account in the tenant also holds. A repeat erases
	// nothing more, so the page offers no retry. An engine that predates the
	// complete flag never sends false, and keeps the branches below.
	const eraseKeptShared = $derived(
		eraseResult?.complete === false && (eraseResult.failed ?? []).length === 0
	);

	const exportJson = $derived(exportResult ? JSON.stringify(exportResult, null, 2) : '');
	const exportHref = $derived(
		exportResult ? `data:application/json;charset=utf-8,${encodeURIComponent(exportJson)}` : ''
	);
	const exportFilename = $derived(
		exportResult
			? `dsar-export-${exportResult.identifier.replace(/[^a-zA-Z0-9._@-]/g, '_')}.json`
			: ''
	);
</script>

<PageShell
	title="Privacy requests"
	description="Export or erase every piece of personal data held about one person. GDPR calls this a data subject request."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>Export subject data</SectionHeading>

		<Card>
			<div class="flex flex-col gap-4">
				<p class="text-sm text-muted">
					Export collects this subject's personal data from every plugin into one JSON file.
				</p>
				<form
					method="POST"
					action="?/export"
					use:enhance={() => {
						exporting = true;
						return async ({ update }) => {
							await update({ reset: false });
							exporting = false;
						};
					}}
					class="flex flex-col gap-4"
				>
					<Input
						id="export-subject"
						label="Subject (email or ID)"
						name="subject"
						bind:value={exportSubject}
						required
						autocomplete="off"
						placeholder="jane@example.com"
					/>
					{#if form?.action === 'export' && form.error}
						<Alert tone="danger">{form.error}</Alert>
					{/if}
					<div class="flex justify-end">
						<Button type="submit" variant="primary" loading={exporting}>
							<Download size={ICON.sm} /> Export
						</Button>
					</div>
				</form>
			</div>
		</Card>

		{#if exportResult}
			<Card pad="none">
				{#snippet header()}
					<div class="flex flex-wrap items-center justify-between gap-3">
						<span class="text-xs text-muted">
							{exportResult.summary.total_records}
							{plural(exportResult.summary.total_records, 'record')} from
							{exportResult.summary.plugins_with_data} of {exportResult.summary.plugins_queried}
							{plural(exportResult.summary.plugins_queried, 'plugin')}
						</span>
						<!-- The payload is already in the page, so the link carries it as a
						     data URI. Button refuses that scheme, which is why this one
						     control is a plain anchor. -->
						<!-- ui-consistency: allow raw-button - a download link carrying a data URI, which Button refuses -->
						<a
							href={exportHref}
							download={exportFilename}
							class="inline-flex items-center gap-2 rounded-md bg-brand px-3 py-1.5 coarse:min-h-control text-xs font-medium text-ink transition-colors hover:bg-brand-light"
						>
							<FileJson size={ICON.sm} /> Download JSON
						</a>
					</div>
				{/snippet}
				{#if exportResult.errors.length > 0}
					<div class="border-b border-line px-5 py-2 text-xs text-warn">
						{exportResult.errors.length === 1 ? 'An exporter failed' : `${exportResult.errors.length} exporters failed`}: {exportResult.errors
							.map((e) => e.error)
							.join('; ')}
					</div>
				{/if}
				<pre class="max-h-96 overflow-auto p-4 text-xs text-fg">{exportJson}</pre>
			</Card>
		{/if}
	</section>

	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>Erase subject data</SectionHeading>

		<Card>
			<div class="flex flex-col gap-4">
				<Alert tone="danger" title="This cannot be undone">
					All personal data for this subject is permanently erased or anonymized in every plugin.
				</Alert>
				<form
					method="POST"
					action="?/erase"
					use:enhance={() => {
						erasing = true;
						return async ({ result, update }) => {
							await update({ reset: false });
							if (result.type === 'success') {
								eraseSubject = '';
								eraseConfirm = '';
							}
							erasing = false;
						};
					}}
					class="flex flex-col gap-4"
				>
					<Input
						id="erase-subject"
						label="Subject (email or ID)"
						name="subject"
						bind:value={eraseSubject}
						required
						autocomplete="off"
						placeholder="jane@example.com"
					/>
					<Input
						id="erase-confirm"
						label="Type the subject again to confirm"
						name="confirm"
						bind:value={eraseConfirm}
						autocomplete="off"
						placeholder="jane@example.com"
						error={confirmError}
						hint="Erasure stays disabled until this matches"
					/>
					{#if form?.action === 'erase' && form.error}
						<Alert tone="danger">{form.error}</Alert>
					{/if}
					<div class="flex justify-end">
						<Button
							type="submit"
							variant="danger"
							disabled={!canErase}
							loading={erasing}
						>
							<Trash2 size={ICON.sm} /> Erase permanently
						</Button>
					</div>
				</form>
			</div>
		</Card>

		{#if eraseResult && eraseHolds.length > 0}
			<!-- Stays until dismissed: nothing was erased, and the reader has to act on it. -->
			<Alert tone="warn" title="Erasure held">
				<p>
					Nothing was erased for <span class="font-mono text-xs">{eraseResult.identifier}</span>, because
					{eraseHolds.length === 1 ? 'a legal hold covers' : 'legal holds cover'} this subject. Release
					{eraseHolds.length === 1 ? 'it' : 'them'} under audit retention, then run the erasure again.
				</p>
				<ul class="mt-2 list-disc pl-5 text-xs">
					{#each eraseHolds as hold (hold.id)}
						<li>{hold.reason || hold.id}</li>
					{/each}
				</ul>
			</Alert>
		{:else if eraseResult && eraseKeptShared}
			<!-- Stays until dismissed: records are still held, and the reader has to know why. -->
			<Alert tone="warn" title="Erasure kept some records">
				<p>
					Erased <span class="font-medium">{eraseResult.total_rows}</span>
					{plural(eraseResult.total_rows, 'row')} for
					<span class="font-mono text-xs">{eraseResult.identifier}</span>. Some records were kept,
					because they cannot be told apart from another account's data in this tenant.
				</p>
			</Alert>
		{:else if eraseResult && eraseFailures.length > 0}
			<!-- Stays until dismissed: data is still held, and the reader has to act on it. -->
			<Alert tone="warn" title="Erasure incomplete">
				<p>
					Erased <span class="font-medium">{eraseResult.total_rows}</span>
					{plural(eraseResult.total_rows, 'row')} for
					<span class="font-mono text-xs">{eraseResult.identifier}</span>, but some data is still stored. Check
					the engine log for the part that failed, fix the cause, then run the erasure again.
				</p>
				<ul class="mt-2 list-disc pl-5 text-xs">
					{#each eraseFailures as failure, i (i)}
						<li>{failure}</li>
					{/each}
				</ul>
			</Alert>
		{:else if eraseResult}
			<Alert tone="success" title="Erasure complete" autoDismiss>
				<p>
					Erased <span class="font-medium">{eraseResult.total_rows}</span>
					{plural(eraseResult.total_rows, 'row')} for
					<span class="font-mono text-xs">{eraseResult.identifier}</span>.
				</p>
			</Alert>
		{/if}
	</section>

	{#if data.stepUp}
		<section class="flex flex-col gap-4" aria-label="Before a person exports their own data">
			<div class="flex flex-col gap-1">
				<SectionHeading level={2}>Before a person exports their own data</SectionHeading>
				<p class="text-sm text-muted">
					Signed-in people can download a copy of their own data. Choose what they must confirm first. This
					applies to every tenant on this engine.
				</p>
			</div>
			{#if 'stopped' in data.stepUp}
				<!-- Only a super admin opens this page, and may read the plugin list. -->
				<NotRunning
					title="Identity check before export"
					plugin={PLUGIN.productAnalytics}
					reason={data.stepUp.stopped}
					operator
				/>
			{:else if !data.stepUp.ok}
				<GateNotice
					gate={data.stepUp.gate}
					title="Identity check before export"
					absent="Export requirements are not included in this build. Being signed in is enough to export."
				/>
			{:else}
				<Card>
					<form method="POST" action="?/stepUp" use:enhance={saveStepUp.enhance} class="flex flex-col gap-4">
						<CheckboxGroup
							name="factors"
							label="Required checks"
							hint="Every ticked step is required. With nothing ticked, being signed in is enough."
							options={FACTOR_OPTIONS}
							bind:value={factors}
						/>
						{#if stepUpResult?.error}
							<FormErrors message={stepUpResult.error} refused={stepUpResult.refused} />
						{:else if stepUpResult?.ok}
							<Alert tone="success" autoDismiss>Export requirements saved. They apply to the next export on every tenant.</Alert>
						{/if}
						<div class="flex justify-end">
							<Button type="submit" variant="primary" loading={saveStepUp.pending}>Save</Button>
						</div>
					</form>
				</Card>
			{/if}
		</section>
	{/if}
</PageShell>
