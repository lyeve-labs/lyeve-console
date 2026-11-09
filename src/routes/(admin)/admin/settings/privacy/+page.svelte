<script lang="ts">
	import {
		Alert,
		Button,
		Card,
		CheckboxGroup,
		PageShell,
		RadioGroup,
		SectionHeading,
		SegmentedControl,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import NotRunning from '$lib/components/NotRunning.svelte';
	import { PLUGIN } from '$lib/plugin-names';
	import { formRefusal, type Refusal } from '$lib/api/refusal';
	import { tracked } from '$lib/forms.svelte';
	import { ROLES } from '$lib/roles';
	import { ALWAYS_EXPORT, NO_TENANT, sectionOption, type FormErasureMode } from '$lib/api/privacy';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const ERASURE_OPTIONS: { value: FormErasureMode; label: string; description: string }[] = [
		{
			value: 'auto',
			label: 'Decide for each submission',
			description:
				"Delete a submission when the person's address is the only one in it. When it also holds someone else's address, clear only the person's own values. This is the default.",
		},
		{
			value: 'soft',
			label: "Always clear the person's values",
			description: "Keep every submission and remove only what belongs to the person. No submission is deleted.",
		},
		{
			value: 'hard',
			label: 'Always delete the submission',
			description:
				"Delete every submission that holds the person's address, along with anything other people entered in it.",
		},
	];

	type Scope = 'every' | 'chosen';
	const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
		{ value: 'every', label: 'Every role' },
		{ value: 'chosen', label: 'Chosen roles' },
	];

	// Each control starts from what is stored and follows a save.
	let mode = $state<FormErasureMode>('auto');
	let offered = $state<string[]>([]);
	let scope = $state<Scope>('every');
	let roles = $state<string[]>([]);
	$effect(() => {
		if (data.formErasure?.ok) mode = data.formErasure.value.mode;
	});
	$effect(() => {
		if (!data.exportSections?.ok) return;
		offered = (data.exportSections.value.sections ?? []).filter((s) => s.offered).map((s) => s.section);
	});
	$effect(() => {
		if (!data.exportRoles?.ok) return;
		const stored = data.exportRoles.value.roles ?? [];
		scope = stored.length === 0 ? 'every' : 'chosen';
		roles = stored.filter((r) => !ALWAYS_EXPORT.includes(r));
	});

	const available = $derived(data.exportSections?.ok ? (data.exportSections.value.sections ?? []).map((s) => s.section) : []);
	// Left out, and not available now because that part of the instance does
	// not run. The save keeps them left out.
	const kept = $derived(
		data.exportSections?.ok ? (data.exportSections.value.excluded ?? []).filter((s) => !available.includes(s)) : [],
	);
	const sectionOptions = $derived(available.map(sectionOption));

	// The roles the user editor offers, less the two that may always export,
	// and any other role the tenant already chose, so a save never drops one
	// the reader cannot see.
	const roleOptions = $derived.by(() => {
		const base: string[] = ROLES.filter((r) => !ALWAYS_EXPORT.includes(r));
		const stored = data.exportRoles?.ok ? (data.exportRoles.value.roles ?? []) : [];
		const extra = stored.filter((r) => !ALWAYS_EXPORT.includes(r) && !base.includes(r));
		return [...base, ...extra].map((r) => ({ value: r, label: r }));
	});

	type Outcome = { saved?: boolean; error?: string; refused: Refusal | null };

	/** The result of one form on this page, so each card shows only its own. */
	function outcome(action: string): Outcome | null {
		if (!form || form.action !== action) return null;
		return { ...(form as { saved?: boolean; error?: string }), refused: formRefusal(form) };
	}
	const erasureResult = $derived(outcome('erasure'));
	const sectionsResult = $derived(outcome('sections'));
	const rolesResult = $derived(outcome('roles'));

	const keep: SubmitFunction = () => async ({ update }) => {
		await update({ reset: false });
	};
	const saveErasure = tracked(keep);
	const saveSections = tracked(keep);
	const saveRoles = tracked(keep);

	const exportStopped = $derived(
		data.exportSections && 'stopped' in data.exportSections
			? data.exportSections.stopped
			: data.exportRoles && 'stopped' in data.exportRoles
				? data.exportRoles.stopped
				: null,
	);
	const showsExport = $derived(data.exportSections !== null || data.exportRoles !== null);
	const nothingShown = $derived(!data.noTenant && data.formErasure === null && !showsExport);
</script>

{#snippet saved(result: Outcome | null, text: string)}
	{#if result?.error}
		<FormErrors message={result.error} refused={result.refused} />
	{:else if result?.saved}
		<Alert tone="success" autoDismiss>{text}</Alert>
	{/if}
{/snippet}

<PageShell
	title="Privacy"
	description="Choose what happens to a person's data when they ask to be erased, and what they can export themselves."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#if data.noTenant}
		<!-- No retry: trying again names no tenant either. -->
		<Alert tone="warn">{NO_TENANT}</Alert>
	{/if}

	{#if nothingShown}
		<Alert tone="brand">None of these settings apply to this engine.</Alert>
	{/if}

	{#if data.formErasure}
		<section class="flex flex-col gap-4" aria-label="Form submissions on erasure">
			<SectionHeading level={2}>Form submissions on erasure</SectionHeading>
			{#if 'stopped' in data.formErasure}
				<!-- The page answers admins and super admins only, who may read the plugin list. -->
				<NotRunning
					title="Form submissions on erasure"
					plugin={PLUGIN.schema}
					reason={data.formErasure.stopped}
					operator
				/>
			{:else if !data.formErasure.ok}
				<GateNotice
					gate={data.formErasure.gate}
					title="Form submissions on erasure"
					absent="Form submissions are not included in this build."
				/>
			{:else}
				<Card pad="md">
					<form method="POST" action="?/erasure" use:enhance={saveErasure.enhance} class="flex flex-col gap-4">
						<RadioGroup
							name="mode"
							label="When a person's data is erased, their form submissions are"
							hint="A form submission can hold details of more than one person. Choose how much of it an erasure removes."
							options={ERASURE_OPTIONS}
							bind:value={mode}
						/>
						{@render saved(erasureResult, 'Saved. The next erasure in this tenant follows this choice.')}
						<div class="flex justify-end">
							<Button variant="primary" type="submit" loading={saveErasure.pending}>Save</Button>
						</div>
					</form>
				</Card>
			{/if}
		</section>
	{/if}

	{#if showsExport}
		<section class="flex flex-col gap-4" aria-label="Exporting their own data">
			<div class="flex flex-col gap-1">
				<SectionHeading level={2}>Exporting their own data</SectionHeading>
				<p class="text-sm text-muted">
					People signed in to this tenant can download a copy of their own data. Choose what they may include and who may do it.
				</p>
			</div>

			{#if exportStopped}
				<!-- One plugin serves both export settings, so one notice says why both are missing. -->
				<NotRunning title="Exporting their own data" plugin={PLUGIN.productAnalytics} reason={exportStopped} operator />
			{/if}

			{#if data.exportSections && !('stopped' in data.exportSections)}
				{#if !data.exportSections.ok}
					<GateNotice
						gate={data.exportSections.gate}
						title="What a person may include"
						absent="Choosing what an export contains is not included in this build."
					/>
				{:else}
					<Card pad="md">
						<form method="POST" action="?/sections" use:enhance={saveSections.enhance} class="flex flex-col gap-4">
							{#each available as section (section)}
								<input type="hidden" name="available" value={section} />
							{/each}
							{#each kept as section (section)}
								<input type="hidden" name="kept" value={section} />
							{/each}
							{#if sectionOptions.length === 0}
								<p class="text-sm text-muted">Nothing on this engine can be exported.</p>
							{:else}
								<CheckboxGroup
									name="offered"
									label="What a person may include"
									hint="Each export offers the sections checked here. If none is checked, no one in this tenant can export their own data."
									options={sectionOptions}
									bind:value={offered}
								/>
							{/if}
							{#if kept.length > 0}
								<p class="text-xs text-muted">
									Also left out: {kept.map((s) => sectionOption(s).label).join(', ')}. These are not running now, and they stay left out when they run again.
								</p>
							{/if}
							{@render saved(sectionsResult, 'Saved. The next export offers these.')}
							<div class="flex justify-end">
								<Button variant="primary" type="submit" loading={saveSections.pending}>Save</Button>
							</div>
						</form>
					</Card>
				{/if}
			{/if}

			{#if data.exportRoles && !('stopped' in data.exportRoles)}
				{#if !data.exportRoles.ok}
					<GateNotice
						gate={data.exportRoles.gate}
						title="Who may export"
						absent="Choosing who may export is not included in this build. Every role can export."
					/>
				{:else}
					<Card pad="md">
						<form method="POST" action="?/roles" use:enhance={saveRoles.enhance} class="flex flex-col gap-4">
							<SegmentedControl
								name="scope"
								label="Who may export their own data"
								hint="An administrator can always export."
								options={SCOPE_OPTIONS}
								bind:value={scope}
							/>
							{#if scope === 'chosen'}
								<CheckboxGroup
									name="roles"
									label="Roles that may export"
									hint="If no role is checked, only an administrator can export."
									orientation="horizontal"
									options={roleOptions}
									bind:value={roles}
								/>
							{/if}
							{@render saved(rolesResult, 'Saved. The next export follows this choice.')}
							<div class="flex justify-end">
								<Button variant="primary" type="submit" loading={saveRoles.pending}>Save</Button>
							</div>
						</form>
					</Card>
				{/if}
			{/if}
		</section>
	{/if}
</PageShell>
