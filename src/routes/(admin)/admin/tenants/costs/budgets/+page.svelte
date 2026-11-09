<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		DatePicker,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		SectionHeading,
		SegmentedControl,
		Select,
		Table,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Coins, Plus, Trash2 } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';
	import CostTabs from '$lib/components/CostTabs.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { confirmed, drawerFailure, submitter } from '$lib/forms.svelte';
	import { BUDGET_PERIODS, RESOURCE_TYPES, type ResourceType } from '$lib/api/cost';
	import { formatDate, NO_VALUE } from '$lib/format';
	import { lastDay } from '$lib/cost/forms';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The tenant list is the super admin's. An admin who can read this page
	// would be sent to a 403 by a way back that names it.
	const back = $derived(
		data.user?.roles?.includes('super_admin') ? { href: '/admin/tenants', label: 'Tenants' } : undefined,
	);

	const submit = submitter(() => (open = false));

	const budgets = $derived(data.budgets.ok ? data.budgets.value : null);

	const RESOURCE_LABEL: Record<ResourceType, string> = {
		database: 'Database',
		storage: 'Storage',
		bandwidth: 'Bandwidth',
		compute: 'Compute',
		ai: 'AI',
	};

	function money(amount: string, currency: string): string {
		return currency ? `${amount} ${currency}` : amount;
	}

	/*
	 * Both forms report through the one `form`, and each failure names its
	 * action. The drawer shows only a failed create that came back after it
	 * opened, so a failed delete is no failure of the next budget opened.
	 */
	type Result = { action?: string; error?: string; locked?: boolean; saved?: boolean } | null;
	const failure = drawerFailure(() => form as Result, ['createBudget']);
	const budgetFailure = $derived(failure.drawer?.error ? failure.drawer : null);
	const listFailure = $derived(failure.page?.error ? failure.page : null);
	const saved = $derived((form as Result)?.saved === true);

	// The budget drawer.
	let open = $state(false);
	let budgetName = $state('');
	let budgetAmount = $state('');
	let budgetCurrency = $state('USD');
	let budgetPeriod = $state('monthly');
	let budgetResource = $state<string | null>('');
	let budgetThresholds = $state('50, 80, 100');
	let budgetStart = $state('');
	let budgetEnd = $state('');

	function openCreate() {
		failure.opened();
		const now = new Date();
		const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
		const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
		budgetName = '';
		budgetAmount = '';
		budgetCurrency = 'USD';
		budgetPeriod = 'monthly';
		budgetResource = '';
		budgetThresholds = '50, 80, 100';
		budgetStart = first.toISOString().slice(0, 10);
		budgetEnd = last.toISOString().slice(0, 10);
		open = true;
	}

	const periodOptions = BUDGET_PERIODS.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }));
	const resourceOptions = [
		{ value: '', label: 'Every resource' },
		...RESOURCE_TYPES.map((r) => ({ value: r, label: RESOURCE_LABEL[r] })),
	];

	function deleteBudget(label: string): SubmitFunction {
		return confirmed(`Delete budget ${label}?`, 'Its threshold history is deleted too.', {
			confirmLabel: 'Delete',
			success: `Budget ${label} deleted.`,
		});
	}
</script>

<PageShell
	title="Tenant costs"
	documentTitle="Budgets - Tenant costs"
	description="Set a budget and see how close spending is to it."
	width="wide"
	{back}
>
	{#snippet actions()}
		{#if data.enabled}
			<Badge tone="violet" size="sm">Beta</Badge>
			<!-- A budget list that could not be read offers no write against it. -->
			{#if budgets}
				<Button variant="primary" size="sm" onclick={openCreate}>
					<Plus size={ICON.sm} /> New budget
				</Button>
			{/if}
		{/if}
	{/snippet}

	<CostTabs active="budgets" />

	{#if !data.enabled}
		<NotEnabled
			level={2}
			title="Tenant costs"
			description="See what each tenant's usage costs, set prices and track budgets."
			url={data.upgradeUrl}
		/>
	{:else}
		<section class="flex flex-col gap-4" aria-label="Budgets">
			<SectionHeading level={2}>Budgets</SectionHeading>
			{#if listFailure}
				<Alert tone={listFailure.locked ? 'warn' : 'danger'}>{listFailure.error}</Alert>
			{:else if saved}
				<Alert tone="success" autoDismiss>Budgets saved.</Alert>
			{/if}
			{#if budgets && budgets.length > 0}
				<Table label="Budgets">
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col">Resource</th>
							<th scope="col">Period</th>
							<th scope="col">Amount</th>
							<th scope="col">Spend</th>
							<th scope="col">Window</th>
							<th scope="col">Alerts at</th>
							<th scope="col" class="text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each budgets as budget (budget.id)}
							<tr data-testid="budget-row">
								<td data-cell="nowrap" class="font-medium text-fg">{budget.name}</td>
								<td data-cell="nowrap">{budget.resource_type ? RESOURCE_LABEL[budget.resource_type] : 'Every resource'}</td>
								<td data-cell="nowrap">{budget.period}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{money(budget.amount, budget.currency)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{budget.current_spend}</td>
								<td data-cell="nowrap" class="text-xs text-muted">
									{formatDate(budget.period_start)} to {formatDate(lastDay(budget.period_end))}
								</td>
								<td data-cell="nowrap" class="text-xs text-muted">{budget.alert_thresholds.map((t) => `${t}%`).join(', ') || NO_VALUE}</td>
								<td data-cell="nowrap" class="text-right">
									<form method="POST" action="?/deleteBudget" use:enhance={deleteBudget(budget.name)}>
										<input type="hidden" name="id" value={budget.id} />
										<Button
											variant="ghost"
											size="sm"
											type="submit"
											title="Delete"
											aria-label="Delete {budget.name}"
										>
											<Trash2 size={ICON.sm} class="text-danger" />
										</Button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{:else if budgets}
				<EmptyState
					title="No budgets yet"
					description="Create a budget to cap spend over a month, quarter or year, for one resource or all of them. An event is published when spend crosses a threshold."
				>
					{#snippet iconSnippet()}<Coins size={ICON.lg} />{/snippet}
					{#snippet action()}
						<Button variant="secondary" onclick={openCreate}>
							<Plus size={ICON.sm} /> New budget
						</Button>
					{/snippet}
				</EmptyState>
			{:else if !data.budgets.ok}
				<GateNotice gate={data.budgets.gate} title="the budgets" absent="Cost budgets are not included in this build." />
			{/if}
		</section>
	{/if}
</PageShell>

<Drawer bind:open title="New budget">
	<form
		method="POST"
		action="?/createBudget"
		id="budget-form"
		use:enhance={submit.enhance}
		class="flex flex-col gap-4"
	>
		<!-- A refusal for an instance the ledger is not enabled on keeps the warn
		     tone the list gives it. Both regions stay mounted, so either message
		     arrives in a region a screen reader already watches. -->
		<FormErrors message={budgetFailure && !budgetFailure.locked ? budgetFailure.error : undefined} />
		<div class="contents" aria-live="assertive" aria-atomic="true">
			{#if budgetFailure?.locked}
				<Alert tone="warn">{budgetFailure.error}</Alert>
			{/if}
		</div>
		<input type="hidden" name="period_start" value={budgetStart} />
		<input type="hidden" name="period_end" value={budgetEnd} />
		<Input id="budget-name" name="name" label="Name" required bind:value={budgetName} placeholder="Q4 storage" />
		<div class="grid gap-4 sm:grid-cols-2">
			<Input
				id="budget-amount"
				name="amount"
				label="Amount"
				required
				hint="A decimal, in the currency beside it."
				bind:value={budgetAmount}
				autocomplete="off"
				mono
			/>
			<Input
				id="budget-currency"
				name="currency"
				label="Currency"
				bind:value={budgetCurrency}
				autocomplete="off"
				mono
			/>
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			<SegmentedControl name="period" label="Period" options={periodOptions} bind:value={budgetPeriod} />
			<Select
				id="budget-resource"
				name="resource_type"
				label="Resource"
				options={resourceOptions}
				bind:value={budgetResource}
			/>
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			<DatePicker id="budget-start" label="First day" bind:value={budgetStart} required />
			<DatePicker id="budget-end" label="Last day" bind:value={budgetEnd} required />
		</div>
		<Input
			id="budget-thresholds"
			name="alert_thresholds"
			label="Alert thresholds"
			hint="Percentages of the amount, comma separated. Each publishes cost.budget.exceeded once per window."
			bind:value={budgetThresholds}
			autocomplete="off"
			mono
		/>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="budget-form" loading={submit.pending}>Create</Button>
	{/snippet}
</Drawer>
