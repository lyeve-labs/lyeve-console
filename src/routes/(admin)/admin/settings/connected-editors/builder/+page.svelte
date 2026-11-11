<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { navigating } from '$app/state';
	import {
		Alert,
		Banner,
		Button,
		Card,
		CheckboxGroup,
		MultiSelect,
		NumberInput,
		PageShell,
		SectionHeading,
		SegmentedControl,
		Skeleton,
		Toggle,
		confirm,
	} from '@lyeve-labs/ui-kit';
	import BuilderConnectionTabs from '$lib/components/BuilderConnectionTabs.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import { tracked } from '$lib/forms.svelte';
	import { SAID, type Settings } from '$lib/api/connected-editors';
	import { invalidateAll } from '$app/navigation';
	import { FORMS_TYPE_TAKEN, FORM_SUBMISSIONS, SUBMISSIONS_PUBLIC, flowNotes, flowOptions } from '$lib/api/form-destinations';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const PATH = '/admin/settings/connected-editors/builder';

	/** Every key the setting action answers with, each optional. */
	interface Answer {
		saved?: { field: string; settings: Settings };
		settingError?: { field: string; message: string };
		presetApplied?: { created: boolean; settings: Settings };
		presetMissing?: boolean;
		presetError?: string;
		presetCreated?: boolean;
	}

	const answer = $derived((form ?? {}) as Answer);

	/** The browser's own word on whether it is online. Every save waits while it is not. */
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

	const loading = $derived(navigating.to?.url.pathname === PATH);

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
		data.schemasGate
			? []
			: (settings?.form_schemas ?? []).filter((n) => !data.formSchemas.some((s) => s.name === n)).map((n) => data.schemaLabels[n] ?? n),
	);
	const flowTargets = $derived(data.flows?.ok ? data.flows.value : null);
	const formFlowOptions = $derived(flowTargets ? flowOptions(flowTargets, settings?.form_flows ?? []) : []);
	let formFlows = $derived([...(settings?.form_flows ?? [])]);
	// Warnings sit only beside the flows the reader has ticked, the same way at every list length.
	const notes = $derived(flowTargets ? flowNotes(flowTargets, formFlows) : []);
	// Offered while forms cannot send to the preset's submissions type yet.
	const presetWanted = $derived(!!settings && !data.schemasGate && !(settings.form_schemas ?? []).includes(FORM_SUBMISSIONS));
	const presetOffered = $derived(!!data.formsPreset?.ok && data.formsPreset.value && !answer.presetMissing);
	// The forms card says the content types failed in its own words, not the pages card's.
	const formsSchemasGate = $derived(
		data.schemasGate?.state === 'error'
			? { state: 'error' as const, message: 'Could not load content types. Forms keep sending to the content types saved before.' }
			: data.schemasGate,
	);
	const saveForms = tracked(() => {});
	// When the preset created its types but the save after it failed, the page reloads its data so it offers to allow them.
	const applyPreset = tracked(() => async ({ result, update }) => {
		await update();
		if (result.type === 'failure' && result.data?.presetCreated) await invalidateAll();
	});
</script>

{#snippet schemaBuilderLinked(text: string)}
	{@const [before, after] = text.split('schema builder')}
	{before}<a class="text-brand underline" href="/admin/schema">schema builder</a>{after}
{/snippet}

<PageShell
	title="Builder connections"
	documentTitle="Builder settings - Builder connections"
	description="Choose whether this tenant can connect the builder, for how long, and what it may read and write."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#if !online}
		<Banner tone="warn">You're offline. Changes on this page wait until you reconnect.</Banner>
	{/if}

	<BuilderConnectionTabs active="builder" owner />

	{#if data.gate.state === 'withheld'}
		<NotEnabled level={2} title="Builder connections" description={SAID.withheld} />
	{:else if data.gate.state !== 'ok'}
		<GateNotice level={2} gate={data.gate} title="Builder connections" absent="Builder connections are not included in this build." />
	{:else if data.settings && !data.settings.ok}
		<GateNotice level={2} gate={data.settings.gate} title="Builder settings" absent="Builder settings need a newer version of the builder plugin." />
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
					label="Enabled"
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

				{#if data.schemasGate}
					<GateNotice gate={data.schemasGate} title="Content types" absent="Content types are not included in this build." />
				{:else if data.schemas.length === 0}
					<p class="text-sm text-muted">Create a content type to show its entries on pages.</p>
				{:else}
					<!-- Only a form that offered the schemas saves them, so a schema list that failed to load clears nothing. -->
					<input type="hidden" name="schemas_offered" value="1" />
					{#if data.schemas.length <= 12}
						<CheckboxGroup
							label="Open to the builder"
							name="show_schemas"
							bind:value={shown}
							options={schemaOptions}
							orientation="horizontal"
							hint="Pages can show entries from the content types you choose."
							error={errorOn('show_schemas')}
						/>
					{:else}
						<MultiSelect
							id="show-schemas"
							label="Open to the builder"
							bind:value={shown}
							options={schemaOptions}
							searchable
							hint="Pages can show entries from the content types you choose."
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
			<div id="forms" class="flex flex-col items-start gap-6">
				<SectionHeading level={3}>Where forms can send</SectionHeading>
				{#if answer.presetApplied}
					<Alert tone="success" autoDismiss>
						{answer.presetApplied.created
							? 'The Forms and Form submissions content types were created. Forms can send to Form submissions now.'
							: 'Forms can send to Form submissions now.'}
					</Alert>
				{/if}
				{#if answer.presetError}
					<Alert tone="danger">{answer.presetError}</Alert>
				{/if}
				{#if presetWanted}
					{#if data.submissions === 'public'}
						<Alert tone="warn">{@render schemaBuilderLinked(SUBMISSIONS_PUBLIC)}</Alert>
					{:else if data.submissions === 'private' || (presetOffered && !data.formsTypeTaken)}
						<div class="flex flex-col items-start gap-3" data-testid="forms-preset">
							<p class="text-sm text-muted">
								{#if data.submissions === 'private'}
									Let forms save posts into the Form submissions content type you already have.
								{:else}
									Add the Forms and Form submissions content types, and let forms save posts into Form submissions. You manage what arrives on the Content screens.
								{/if}
							</p>
							<form method="POST" action="?/formsPreset" use:enhance={applyPreset.enhance}>
								<Button variant="secondary" type="submit" loading={applyPreset.pending} disabled={!online}>Set up form submissions</Button>
							</form>
						</div>
					{:else if data.formsTypeTaken}
						<p class="text-sm text-muted" data-testid="forms-type-taken">{@render schemaBuilderLinked(FORMS_TYPE_TAKEN)}</p>
					{:else if data.formsPreset && !data.formsPreset.ok}
						<GateNotice gate={data.formsPreset.gate} title="Content type presets" absent="Content type presets need a newer version of the schema plugin." />
					{:else}
						<p class="text-sm text-muted" data-testid="forms-preset-link">
							Create a content type for form posts in the <a class="text-brand underline" href="/admin/schema">schema builder</a>, then choose
							it here.
						</p>
					{/if}
				{/if}

				<form method="POST" action="?/setting" use:enhance={saveForms.enhance} class="flex w-full flex-col items-start gap-6">
					<input type="hidden" name="field" value="forms" />
					{#if savedField === 'forms'}
						<Alert tone="success" autoDismiss>Settings saved.</Alert>
					{/if}

					{#if formsSchemasGate}
						<GateNotice gate={formsSchemasGate} title="Content types" absent="Content types are not included in this build." />
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
						<p class="text-sm text-muted">The flow plugin is not running on this engine, so forms cannot start flows.</p>
					{:else if !data.flows.ok}
						<GateNotice gate={data.flows.gate} title="Flows" absent="Flows are not included in this build." />
					{:else if !data.flows.value.eventKnown}
						<!-- No flow list is offered, so the save leaves the allowed flows as they are. -->
						<p class="text-sm text-muted">Choosing flows needs a newer version of the flow plugin.</p>
					{:else}
						<input type="hidden" name="form_flows_offered" value="1" />
						{#if formFlowOptions.length === 0}
							<p class="text-sm text-muted">
								No flow starts from a builder form yet. <a class="text-brand underline" href="/admin/flows">Create a flow</a> whose trigger is
								the builder form event.
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
								options={formFlowOptions}
								searchable
								hint="Forms can start the flows you choose. Only flows that start from a builder form are listed."
								error={errorOn('form_flows')}
							/>
							{#each formFlows as slug (slug)}
								<input type="hidden" name="form_flows" value={slug} />
							{/each}
						{/if}
						{#if notes.length > 0}
							<ul class="flex w-full min-w-0 flex-col gap-1 text-sm text-warn" data-testid="flow-notes">
								{#each notes as n (n.slug)}
									<li class="min-w-0">
										{#if n.label === n.slug}<span class="font-mono break-all">{n.slug}</span>{:else}<span class="break-words">{n.label}</span>{/if}: {n.note}
									</li>
								{/each}
							</ul>
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
</PageShell>
