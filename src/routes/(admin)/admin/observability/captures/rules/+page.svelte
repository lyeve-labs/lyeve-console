<script lang="ts">
	import CaptureTabs from '$lib/components/CaptureTabs.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		Alert,
		Badge,
		Button,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		SectionHeading,
		Select,
		Table,
		Toggle,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { confirmed, tracked } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { History, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import {
		RULE_METHODS,
		methodLabel,
		retentionLabel,
		retentionOptions,
		sampleLabel,
		type CaptureRule,
		type RuleMethod,
	} from '$lib/api/request-capture';
	import { ICON } from '$lib/icon';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const refusal = $derived(formRefusal(form));
	// A failed save names the drawer it came from, so it is said inside that
	// drawer and nowhere else. Every other failure is the page's.
	const fromDrawer = $derived(
		form && 'drawer' in form && typeof form.drawer === 'string' ? form.drawer : null,
	);
	// The plugin refuses a new rule on an install whose license leaves it out,
	// so none is offered there. Switching a rule off and deleting one stay
	// allowed.
	const canCreate = $derived(data.licensed !== false);
	const NOT_INCLUDED = 'Not included in this license';
	const EDIT_REFUSED = `${NOT_INCLUDED}. Switch the rule off or delete it.`;
	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const enabledRules = $derived(data.rules.filter((r) => r.enabled).length);

	let ruleOpen = $state(false);
	let editing = $state<CaptureRule | null>(null);
	let routePattern = $state('/api/v1/**');
	let ruleMethod = $state<RuleMethod>('*');
	let samplePercent = $state('100');
	let retention = $state('86400');
	let ruleEnabled = $state(true);

	function openCreate() {
		editing = null;
		routePattern = '/api/v1/**';
		ruleMethod = '*';
		samplePercent = '100';
		retention = '86400';
		ruleEnabled = true;
		ruleOpen = true;
	}

	function openEdit(r: CaptureRule) {
		editing = r;
		routePattern = r.route_pattern;
		ruleMethod = r.method;
		samplePercent = String(Math.round(r.sample_rate * 1000) / 10);
		retention = String(r.retention_seconds);
		ruleEnabled = r.enabled;
		ruleOpen = true;
	}

	const saveRule = tracked(() => {
		const verb = editing ? 'saved' : 'created';
		const subject = routePattern;
		return async ({ result, update }) => {
			if (result.type !== 'failure') ruleOpen = false;
			await update();
			if (result.type === 'success') toast.success(`Rule for ${subject} ${verb}.`);
		};
	});

	function remove(what: string, detail: string, done: string): SubmitFunction {
		return confirmed(
			`Delete ${what}?`,
			detail,
			{ confirmLabel: 'Delete', success: done },
		);
	}
</script>

<PageShell
	title="Request capture"
	documentTitle="Capture rules - Request capture"
	description="Choose which routes are captured, how often and for how long."
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	{#snippet actions()}
		{#if data.gate.state === 'ok'}
			<Button
				variant="primary"
				size="sm"
				onclick={openCreate}
				disabled={!canCreate}
				title={canCreate ? undefined : NOT_INCLUDED}
			>
				<Plus size={ICON.sm} /> New rule
			</Button>
		{/if}
	{/snippet}

	<CaptureTabs active="rules" rules={data.rulesRead ? data.rules.length : undefined} />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Request capture"
			absent="Request capture is not included in this build."
		/>
	{:else}
		{#if refusal && !fromDrawer}
			<RefusalNotice {refusal} />
		{:else if formError && !fromDrawer}
			<Alert tone="danger">{formError}</Alert>
		{/if}

		{#if data.licensed === false}
			<Alert tone="brand" title="Capture rules and replay sets are not included">
				Without them, every request is kept for a day and you replay requests one at a time. Creating or enabling a
				rule, or saving a replay set, needs a license that includes them. Saved rules and sets keep working, and you
				can always switch a rule off or delete it.
			</Alert>
		{/if}

		<section class="flex flex-col gap-4" aria-label="Capture rules">
			<SectionHeading level={2}>Capture rules</SectionHeading>
			<p class="text-sm text-muted">
				{#if enabledRules > 0}
					Only requests that match an enabled rule are kept, sampled at its rate and kept for its retention.
					The first matching rule applies.
				{:else}
					With no enabled rule, every request is kept for a day. Once a rule is enabled, only requests that
					match a rule are kept.
				{/if}
			</p>
			{#if !data.rulesRead}
				{#if data.rulesGate}
					<GateNotice gate={data.rulesGate} title="the capture rules" absent="Capture rules need a newer version of the request capture plugin." />
				{:else}
					<Alert tone="danger">Could not load capture rules. Reload the page to try again.</Alert>
				{/if}
			{:else if data.rules.length === 0}
				<EmptyState title="No capture rules yet" description="Every request this tenant sends is kept for a day.">
					{#snippet iconSnippet()}
						<History size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						<Button variant="secondary" onclick={openCreate} disabled={!canCreate} title={canCreate ? undefined : NOT_INCLUDED}>
							<Plus size={ICON.sm} /> New rule
						</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Capture rules">
					<thead>
						<tr>
							<th scope="col">Route</th>
							<th scope="col">Method</th>
							<th scope="col">Sample</th>
							<th scope="col">Kept for</th>
							<th scope="col">State</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.rules as r (r.id)}
							<tr>
								<td class="max-w-md truncate font-mono text-xs" title={r.route_pattern}>{r.route_pattern}</td>
								<td data-cell="nowrap" class="text-xs">{methodLabel(r.method)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{sampleLabel(r.sample_rate)}</td>
								<td data-cell="nowrap" class="text-xs">{retentionLabel(r.retention_seconds)}</td>
								<td data-cell="nowrap">
									<Badge tone={r.enabled ? 'success' : 'neutral'} dot>{r.enabled ? 'Capturing' : 'Off'}</Badge>
								</td>
								<td data-cell="nowrap">
									<div class="flex items-center justify-end gap-1">
										{#if !canCreate && r.enabled}
											<!-- The plugin refuses any change that leaves a rule enabled on
											     this license, so the drawer is not offered. Switching the
											     rule off stays allowed, from the row. -->
											<Button
												variant="ghost"
												size="sm"
												aria-label="Edit {r.route_pattern}"
												disabled
												title={EDIT_REFUSED}
											>
												<Pencil size={ICON.sm} />
											</Button>
											<form method="POST" action="?/updateRule" use:enhance>
												<input type="hidden" name="from" value="row" />
												<input type="hidden" name="id" value={r.id} />
												<input type="hidden" name="route_pattern" value={r.route_pattern} />
												<input type="hidden" name="method" value={r.method} />
												<input type="hidden" name="sample_percent" value={String(Math.round(r.sample_rate * 1000) / 10)} />
												<input type="hidden" name="retention_seconds" value={String(r.retention_seconds)} />
												<input type="hidden" name="enabled" value="false" />
												<Button variant="ghost" size="sm" type="submit" aria-label="Switch off {r.route_pattern}">
													Switch off
												</Button>
											</form>
										{:else}
											<Button variant="ghost" size="sm" aria-label="Edit {r.route_pattern}" onclick={() => openEdit(r)}>
												<Pencil size={ICON.sm} />
											</Button>
										{/if}
										<form
											method="POST"
											action="?/deleteRule"
											use:enhance={remove(
												`the rule for ${r.route_pattern}`,
												'The captures it kept stay until their retention ends.',
												`Rule for ${r.route_pattern} deleted.`,
											)}
										>
											<input type="hidden" name="id" value={r.id} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Delete {r.route_pattern}">
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
	{/if}
</PageShell>

<Drawer bind:open={ruleOpen} title={editing ? 'Edit rule' : 'New rule'}>
	<form id="capture-rule-form" method="POST" action={editing ? '?/updateRule' : '?/createRule'} use:enhance={saveRule.enhance}>
		<FormErrors
			message={fromDrawer === 'rule' ? formError || undefined : undefined}
			refused={fromDrawer === 'rule' ? refusal : null}
		/>
		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
		{/if}
		<div class="flex flex-col gap-4">
			<Input
				id="capture-pattern"
				name="route_pattern"
				label="Route"
				hint="An absolute path. A segment can be * or a {'{name}'} for any one segment. ** can only come last."
				bind:value={routePattern}
				required
			/>
			<Select
				id="capture-method"
				name="method"
				label="Method"
				bind:value={ruleMethod}
				options={RULE_METHODS.map((m) => ({ value: m, label: methodLabel(m) }))}
			/>
			<Input
				id="capture-sample"
				name="sample_percent"
				label="Sample, as a percentage"
				hint="The share of matching requests kept. 100 keeps every one."
				bind:value={samplePercent}
			/>
			<Select
				id="capture-retention"
				name="retention_seconds"
				label="Kept for"
				hint="From an hour to 30 days. Replays of a capture are kept just as long."
				bind:value={retention}
				options={retentionOptions(editing?.retention_seconds)}
			/>
			<input type="hidden" name="enabled" value={ruleEnabled ? 'true' : 'false'} />
			<!-- Applying a rule needs the license. A rule that is off can still
			     be edited and saved off. -->
			<Toggle
				id="capture-enabled"
				label="Apply this rule"
				bind:checked={ruleEnabled}
				disabled={!canCreate && !ruleEnabled}
				hint={!canCreate && !ruleEnabled ? `${NOT_INCLUDED}, so the rule stays off.` : undefined}
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (ruleOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="capture-rule-form" loading={saveRule.pending}>
			{editing ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>
