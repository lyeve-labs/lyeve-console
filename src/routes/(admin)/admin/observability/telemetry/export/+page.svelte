<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Card,
		EmptyState,
		Input,
		PageShell,
		PasswordInput,
		SectionHeading,
		SegmentedControl,
		Table,
		toast,
	} from '@lyeve-labs/ui-kit';
	import RefreshButton from '$lib/components/RefreshButton.svelte';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { AlertTriangle, CheckCircle, Plus, Send, Trash2, Upload } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import TelemetryTabs from '$lib/components/TelemetryTabs.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { confirmed, tracked } from '$lib/forms.svelte';
	import { DESTINATION_KINDS, sameOrigin, type DestinationKind } from '$lib/api/telemetry';
	import { NO_VALUE, formatDateTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let exporting = $state<string | null>(null);
	function exportNow(name: string) {
		return () => {
			exporting = name;
			return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
				exporting = null;
				await update({ reset: false });
			};
		};
	}

	function exportedAt(e: { last_export?: string }): string {
		if (!e.last_export || e.last_export.startsWith('0001-')) return 'Never';
		return formatDateTime(e.last_export, NO_VALUE);
	}

	// The save and the delete share one form result. Each failure names the
	// write that failed, so a failed delete never shows inside the save form.
	type DestinationFailure = {
		destinationAction?: 'save' | 'remove';
		destinationError?: string;
		hostMoved?: boolean;
		refused?: unknown;
	};
	const failure = $derived(form as DestinationFailure | null);
	const saveFailure = $derived(failure?.destinationAction === 'save' ? failure : null);
	const removeFailure = $derived(failure?.destinationAction === 'remove' ? failure : null);
	const saveRefusal = $derived(formRefusal(saveFailure));
	const hostMoved = $derived(saveFailure?.hostMoved === true);

	const destinationRead = $derived(data.destination.ok ? data.destination.value : null);
	const destination = $derived(destinationRead?.destination ?? null);
	const licensed = $derived(destinationRead?.licensed === true);

	let kind = $state<DestinationKind>('otlp');
	let destUrl = $state('');
	let headersMode = $state<'keep' | 'replace'>('keep');
	let headers = $state<{ id: number; name: string; value: string }[]>([]);
	let nextHeader = 0;

	function fillDestinationForm() {
		kind = destination?.kind ?? 'otlp';
		destUrl = destination?.url ?? '';
		headersMode = destination && destination.header_names.length > 0 ? 'keep' : 'replace';
		headers = [];
	}

	// The form starts from what is stored, and follows a save or a removal.
	// Every reload hands the page a new destination object, a refresh or an
	// export included, so the effect follows what is stored rather than the
	// object, and an edit in progress survives a reload that changed nothing.
	const storedDestination = $derived(
		destination ? JSON.stringify([destination.kind, destination.url, destination.header_names]) : '',
	);
	$effect(() => {
		void storedDestination;
		untrack(fillDestinationForm);
	});

	// Leaving the stored headers in place while the host changes is the one
	// save the plugin refuses, so the form says so before it is sent.
	const movesHost = $derived(
		!!destination &&
			destination.header_names.length > 0 &&
			headersMode === 'keep' &&
			destUrl.trim() !== '' &&
			!sameOrigin(destination.url, destUrl.trim()),
	);

	function addHeader() {
		headers = [...headers, { id: nextHeader++, name: '', value: '' }];
	}

	function dropHeader(id: number) {
		headers = headers.filter((h) => h.id !== id);
	}

	const saveDest = tracked(() => async ({ result, update }) => {
		await update({ reset: false });
		if (result.type === 'success') {
			// A save that changed only header values stores what the effect
			// cannot see, and the values typed must not stay on screen.
			fillDestinationForm();
			toast.success('Destination saved.');
		}
	});

	// Built at submit time, so the question names the destination on screen
	// then rather than the one there when the page first drew.
	const removeDest: SubmitFunction = (input) =>
		confirmed(
			destination ? `Delete the destination ${destination.url}?` : 'Delete the destination?',
			"This tenant's series stop being pushed there, and its stored headers are deleted.",
			{ confirmLabel: 'Delete', success: 'Destination deleted.' },
		)(input);
</script>

{#snippet noExporters()}
	<Send size={ICON.lg} />
{/snippet}

<PageShell
	title="Telemetry"
	documentTitle="Export - Telemetry"
	description={data.superAdmin
		? "Send this tenant's metrics to a destination, and see where the engine exports them."
		: "Send this tenant's metrics to a destination."}
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	{#snippet actions()}
		<RefreshButton />
	{/snippet}

	<TelemetryTabs active="export" />

	<section class="flex flex-col gap-4" data-testid="telemetry-destination" aria-label="Tenant destination">
		<div class="flex flex-wrap items-center gap-2">
			<SectionHeading level={2}>Tenant destination</SectionHeading>
			<span class="text-xs text-faint">
				Push this tenant's metrics to your own collector, in addition to the engine's exporters.
			</span>
		</div>

		{#if !data.destination.ok}
			<GateNotice
				gate={data.destination.gate}
				title="Tenant destination"
				absent="Tenant destinations need a newer version of the telemetry plugin."
			/>
		{:else}
			{#if !licensed}
				<p class="text-sm text-muted" id="destination-unlicensed">
					Setting or changing a destination needs a license that includes it. A saved destination keeps
					receiving metrics, and you can always delete it.
				</p>
			{/if}

			{#if destination?.health}
				<p class="flex flex-wrap items-center gap-2 text-xs text-muted">
					{#if destination.health.healthy}
						<Badge tone="success"><CheckCircle size={ICON.xs} /> Healthy</Badge>
					{:else}
						<Badge tone="danger"><AlertTriangle size={ICON.xs} /> Failing</Badge>
					{/if}
					Last push {exportedAt(destination.health)}, {destination.health.exports} pushed, {destination.health.failures}
					failed.
					{#if destination.health.last_error}
						<span class="font-mono">{destination.health.last_error}</span>
					{/if}
				</p>
			{/if}

			<Card pad="md">
				<form
					id="destination-form"
					method="POST"
					action="?/saveDestination"
					use:enhance={saveDest.enhance}
					class="flex flex-col gap-4"
				>
					<FormErrors message={hostMoved ? undefined : saveFailure?.destinationError} refused={saveRefusal} />
					{#if hostMoved}
						<Alert tone="warn" title="Enter the headers again for the new host">
							<p>
								Stored headers stay with the host they were entered for.
								Choose Replace them and enter the headers for the new address. Nothing was saved.
							</p>
						</Alert>
					{/if}
					<!-- A save the license refuses is not offered. The fields stay in
					     sight, so the reader sees what is set, and the reason is
					     beside the button. -->
					<fieldset class="contents" disabled={!licensed}>
						<SegmentedControl label="Protocol" name="kind" bind:value={kind} options={[...DESTINATION_KINDS]} disabled={!licensed} />
						<Input
							id="destination-url"
							name="url"
							label="URL"
							placeholder="https://otlp.example.com/v1/metrics"
							hint="An http or https address. Credentials go in a header, never in the URL."
							bind:value={destUrl}
							required
						/>

						{#if destination && destination.header_names.length > 0}
							<SegmentedControl
								label="Headers"
								name="headers_mode"
								bind:value={headersMode}
								disabled={!licensed}
								options={[
									{ value: 'keep', label: 'Keep the stored headers' },
									{ value: 'replace', label: 'Replace them' },
								]}
								hint={headersMode === 'keep'
									? `Stored: ${destination.header_names.join(', ')}. Their values are never shown.`
									: undefined}
							/>
						{:else}
							<input type="hidden" name="headers_mode" value="replace" />
						{/if}

						{#if movesHost}
							<Alert tone="warn">
								This URL is on a different host, so the stored headers do not carry over. Replace the headers
								to save.
							</Alert>
						{/if}

						{#if headersMode === 'replace'}
							<div class="flex flex-col gap-3">
								{#each headers as h (h.id)}
									<div class="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
										<Input id="header-name-{h.id}" name="header_name" label="Header" placeholder="Authorization" bind:value={h.name} />
										<PasswordInput
											id="header-value-{h.id}"
											name="header_value"
											label="Value"
											autocomplete="off"
											bind:value={h.value}
										/>
										<Button variant="ghost" size="sm" aria-label="Remove header {h.name || h.id}" onclick={() => dropHeader(h.id)}>
											<Trash2 size={ICON.sm} class="text-danger" />
										</Button>
									</div>
								{/each}
								<div>
									<Button variant="secondary" size="sm" onclick={addHeader}>
										<Plus size={ICON.sm} /> Add header
									</Button>
								</div>
								{#if destination && destination.header_names.length > 0 && headers.length === 0}
									<p class="text-xs text-muted">Saving with no headers clears the stored ones.</p>
								{/if}
							</div>
						{/if}

						<div class="flex flex-wrap items-center gap-2">
							<Button
								variant="primary"
								type="submit"
								loading={saveDest.pending}
								disabled={!licensed}
								aria-describedby={licensed ? undefined : 'destination-unlicensed'}
							>
								Save
							</Button>
							{#if !licensed}
								<span class="text-xs text-muted">Not enabled on this engine.</span>
							{/if}
						</div>
					</fieldset>
				</form>
				{#if destination}
					<form method="POST" action="?/removeDestination" class="mt-4 flex flex-col gap-3 border-t border-line pt-4" use:enhance={removeDest}>
						<FormErrors message={removeFailure?.destinationError} refused={formRefusal(removeFailure)} />
						<div>
							<Button variant="secondary" size="sm" type="submit">Delete destination</Button>
						</div>
					</form>
				{/if}
			</Card>
		{/if}
	</section>

	{#if data.exporters}
		<!-- The exporters are the instance's export configuration, which no tenant
		     owns, so a tenant admin's page has no such section rather than an
		     empty one. -->
		<section class="flex flex-col gap-4" data-testid="telemetry-exporters">
			<div class="flex flex-wrap items-center gap-2">
				<SectionHeading level={2}>Exporters</SectionHeading>
				<span class="text-xs text-faint">
					Set exporters in the plugin's metrics_* settings. Scheduled exports run when they are enabled, and Export now runs one immediately.
				</span>
			</div>

			{#if form?.error}
				<Alert tone="warn">{form.error}</Alert>
			{:else if form?.exported}
				<Alert tone="success" autoDismiss>{form.message}</Alert>
			{/if}

			{#if !data.exporters.ok}
				<GateNotice
					gate={data.exporters.gate}
					title="Telemetry exporters"
					absent="Telemetry is not included in this build."
				/>
			{:else if data.exporters.value.length === 0}
				<EmptyState
					iconSnippet={noExporters}
					title="No exporters configured"
					description="Set a Pushgateway URL, an OTLP endpoint, a StatsD address or a New Relic key in the plugin's settings and restart the engine."
				/>
			{:else}
				<Table label="Exporters">
					<thead>
						<tr>
							<th scope="col">Exporter</th>
							<th scope="col">State</th>
							<th scope="col">Last export</th>
							<th scope="col" class="text-right">Exports</th>
							<th scope="col" class="text-right">Failures</th>
							<th scope="col">Last error</th>
							<th scope="col" class="w-12"><span class="sr-only">Export now</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.exporters.value as exporter (exporter.name)}
							<tr>
								<td data-cell="nowrap" class="font-mono text-xs">{exporter.name}</td>
								<td>
									{#if exporter.healthy}
										<Badge tone="success"><CheckCircle size={ICON.xs} /> Healthy</Badge>
									{:else}
										<Badge tone="danger"><AlertTriangle size={ICON.xs} /> Unhealthy</Badge>
									{/if}
								</td>
								<td data-cell="nowrap" class="text-xs">{exportedAt(exporter)}</td>
								<td data-cell="nowrap" class="text-right font-mono text-xs">{exporter.exports}</td>
								<td data-cell="nowrap" class="text-right font-mono text-xs">{exporter.failures}</td>
								<td class="text-xs text-muted">{exporter.last_error || NO_VALUE}</td>
								<td>
									<form method="POST" action="?/export" use:enhance={exportNow(exporter.name)}>
										<input type="hidden" name="name" value={exporter.name} />
										<Button type="submit" variant="ghost" size="sm" aria-label="Export {exporter.name} now" loading={exporting === exporter.name}>
											<Upload size={ICON.sm} />
										</Button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>
	{/if}
</PageShell>
