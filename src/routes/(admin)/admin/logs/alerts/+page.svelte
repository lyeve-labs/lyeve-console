<script lang="ts">
	import {
		Badge,
		Button,
		Card,
		CopyField,
		Drawer,
		EmptyState,
		Input,
		Modal,
		NumberInput,
		PageShell,
		SectionHeading,
		Select,
		Table,
		Toggle,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { BellRing, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import AlertChannelFields from '$lib/components/AlertChannelFields.svelte';
	import { confirmed, submitter } from '$lib/forms.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { channelSummary } from '$lib/api/alert-channels';
	import { LOG_ALERT_LEVELS, ruleScope, type LogAlertRule } from '$lib/api/log-alerts';
	import { formatCount } from '$lib/format';
	import { ICON } from '$lib/icon';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const config = $derived(data.config);
	const inDrawer = $derived(!!form && 'drawer' in form && form.drawer === true);
	const formError = $derived(form && 'error' in form && form.error ? String(form.error) : undefined);
	const refused = $derived(formRefusal(form));

	const LEVELS = [
		{ value: 'ALL', label: 'Every level' },
		...LOG_ALERT_LEVELS.map((l) => ({ value: l, label: l })),
	];

	// One drawer for both writes: an empty key is a new rule.
	let open = $state(false);
	let editingKey = $state('');
	let editing = $state<LogAlertRule | null>(null);
	let level = $state<string | null>('ERROR');
	let maxCount = $state(100);
	let enabled = $state(true);

	const submit = submitter(() => (open = false));

	function openCreate() {
		editingKey = '';
		editing = null;
		level = 'ERROR';
		maxCount = 100;
		enabled = true;
		open = true;
	}

	function openEdit(rule: LogAlertRule) {
		editingKey = rule.id;
		editing = rule;
		level = rule.level || 'ALL';
		maxCount = rule.max_count;
		enabled = rule.enabled;
		open = true;
	}

	function deleteRule(rule: LogAlertRule): SubmitFunction {
		return confirmed(
			`Delete the rule on ${ruleScope(rule).toLowerCase()}?`,
			'The rule stops firing and its channels are deleted. This cannot be undone.',
			{ confirmLabel: 'Delete', success: 'Rule deleted.' },
		);
	}

	// A new webhook URL's signing secret arrives once, in the write's answer.
	let reveal = $state('');
	$effect(() => {
		if (form && 'signingSecret' in form && typeof form.signingSecret === 'string' && form.signingSecret) {
			reveal = form.signingSecret;
		}
	});
</script>

<PageShell
	title="Volume alerts"
	description="Set rules that alert you when log volume passes a ceiling."
	width="wide"
	back={{ href: '/admin/logs', label: 'Logs' }}
>
	{#snippet actions()}
		{#if data.gate.state === 'ok' && data.superAdmin}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New rule
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok' || !config}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Volume alerts"
			absent="Volume alerts are not included in this build."
		/>
	{:else}
		{#if !inDrawer}
			<FormErrors message={formError} {refused} />
		{/if}

		<p class="text-sm text-muted">
			Every rule is checked once a minute. When a rule passes its ceiling, it notifies each of its channels. On every
			instance it also adds an ALERT entry to the live tail and a warning to the log.
			{#if !data.superAdmin}
				These are your tenant's rules. Only a super admin can change them.
			{/if}
		</p>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Rules</SectionHeading>
			{#if config.thresholds.length === 0}
				<EmptyState
					title="No volume rules yet"
					description="Create a rule to get an alert when one level, or every level, passes a ceiling within a window."
				>
					{#snippet iconSnippet()}<BellRing size={ICON.lg} />{/snippet}
					{#snippet action()}
						{#if data.superAdmin}
							<Button variant="secondary" onclick={openCreate}>
								<Plus size={ICON.sm} /> New rule
							</Button>
						{/if}
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Volume alert rules">
					<thead>
						<tr>
							<th scope="col">Watches</th>
							<th scope="col">Fires past</th>
							<th scope="col">Status</th>
							<th scope="col">Channels</th>
							{#if data.superAdmin}
								<th scope="col" class="text-right">Actions</th>
							{/if}
						</tr>
					</thead>
					<tbody>
						{#each config.thresholds as rule, i (rule.id || i)}
							<tr data-testid="rule-row">
								<td>{ruleScope(rule)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">
									{formatCount(rule.max_count)} in {rule.window || 'the default window'}
								</td>
								<td data-cell="nowrap">
									<Badge tone={rule.enabled ? 'success' : 'neutral'} dot>{rule.enabled ? 'On' : 'Off'}</Badge>
								</td>
								<td class="text-xs text-muted" data-testid="rule-channels">{channelSummary(rule.channels)}</td>
								{#if data.superAdmin}
									<td data-cell="nowrap">
										<div class="flex items-center justify-end gap-2">
											<Button variant="ghost" size="sm" aria-label="Edit rule {i + 1}" onclick={() => openEdit(rule)}>
												<Pencil size={ICON.sm} />
											</Button>
											<form method="POST" action="?/delete" use:enhance={deleteRule(rule)}>
												<input type="hidden" name="key" value={rule.id} />
												<Button variant="ghost" size="sm" type="submit" aria-label="Delete rule {i + 1}">
													<Trash2 size={ICON.sm} class="text-danger" />
												</Button>
											</form>
										</div>
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>

		{#if data.superAdmin}
			<Card>
				{#snippet header()}
					<SectionHeading level={3}>Cooldown</SectionHeading>
				{/snippet}
				<form method="POST" action="?/cooldown" use:enhance class="flex flex-wrap items-end gap-3">
					<Input
						id="log-alert-cooldown"
						name="cooldown"
						label="Quiet time after a rule fires"
						hint={config.cooldown
							? 'A rule fires again only after this, such as 10m or 1h.'
							: 'No cooldown is set, so a rule fires on every check while it is over its count. Enter one such as 10m or 1h.'}
						placeholder="10m"
						value={config.cooldown}
						mono
					/>
					<Button variant="secondary" type="submit">Save</Button>
				</form>
			</Card>
		{/if}
	{/if}
</PageShell>

<Drawer bind:open title={editing ? 'Edit rule' : 'New rule'}>
	<form method="POST" action="?/save" id="log-rule-form" use:enhance={submit.enhance} class="flex flex-col gap-4">
		{#if inDrawer}
			<FormErrors message={formError} {refused} />
		{/if}
		<input type="hidden" name="key" value={editingKey} />
		<Select id="log-rule-level" name="level" label="Level" options={LEVELS} bind:value={level} />
		<div class="grid gap-4 sm:grid-cols-2">
			<NumberInput
				id="log-rule-max"
				name="max_count"
				label="Ceiling"
				hint="Entries in the window that fire the rule."
				min={1}
				step={1}
				bind:value={maxCount}
			/>
			<Input
				id="log-rule-window"
				name="window"
				label="Window"
				hint="Such as 5m, 1h or 1d."
				value={editing?.window ?? '5m'}
				mono
				required
			/>
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			<Input
				id="log-rule-tenant"
				name="tenant_id"
				label="Tenant"
				hint="Leave empty to count entries from every tenant."
				value={editing?.tenant_id ?? ''}
				mono
			/>
			<Input
				id="log-rule-plugin"
				name="plugin"
				label="Plugin"
				hint="Leave empty to count entries from every plugin."
				value={editing?.plugin ?? ''}
				mono
			/>
		</div>
		<div>
			<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
			<Toggle id="log-rule-enabled" label="On" hint="When on, the rule is checked every minute. Turn it off to pause it without deleting it." bind:checked={enabled} />
		</div>
		<fieldset class="flex flex-col gap-4 border-t border-line pt-4">
			<legend class="text-sm font-medium text-fg">Channels</legend>
			<AlertChannelFields
				prefix="channel_"
				idPrefix="log-rule-channel"
				value={editing?.channels ?? null}
				licensed={config?.licensed ?? null}
			/>
		</fieldset>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="log-rule-form" loading={submit.pending}>
			{editing ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>

{#if reveal}
	<Modal open title="Webhook signing secret" onclose={() => (reveal = '')}>
		<div class="flex flex-col gap-3">
			<p class="text-sm text-fg">
				Every alert this rule sends to its webhook is signed with this secret. Copy it to the receiver now. It is
				not shown again.
			</p>
			<CopyField value={reveal} label="Signing secret" mono secret />
		</div>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (reveal = '')}>Close</Button>
		{/snippet}
	</Modal>
{/if}
