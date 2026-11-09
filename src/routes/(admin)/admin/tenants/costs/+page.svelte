<script lang="ts">
	import { Alert, Badge, Button, Card, PageShell, SectionHeading, Stat } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { RefreshCw } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';
	import CostTabs from '$lib/components/CostTabs.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { costShares } from '$lib/api/cost';
	import { NO_VALUE, plural } from '$lib/format';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The tenant list is the super admin's. An admin who can read this page
	// would be sent to a 403 by a way back that names it.
	const back = $derived(
		data.user?.roles?.includes('super_admin') ? { href: '/admin/tenants', label: 'Tenants' } : undefined,
	);

	// Each read is its value or null, and the gate beside it says why it is null.
	const summary = $derived(data.summary.ok ? data.summary.value : null);
	const dashboard = $derived(data.dashboard.ok ? data.dashboard.value : null);

	function money(amount: string, currency: string): string {
		return currency ? `${amount} ${currency}` : amount;
	}

	let failure = $derived(
		form && 'error' in form && typeof form.error === 'string' && form.error
			? { form: String(form.form ?? ''), message: form.error, locked: form.locked === true }
			: null,
	);
	let aggregated = $derived(
		form && 'result' in form && form.result && form.form === 'aggregate' ? form.result : null,
	);
	let submitting = $state(false);

	function track() {
		submitting = true;
		return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
			submitting = false;
			await update({ reset: false });
		};
	}
</script>

<PageShell
	title="Tenant costs"
	description="See what this tenant's resources cost this month."
	width="wide"
	{back}
>
	{#snippet actions()}
		{#if data.enabled}
			<Badge tone="violet" size="sm">Beta</Badge>
			<form method="POST" action="?/aggregate" use:enhance={track}>
				<Button
					type="submit"
					variant="secondary"
					size="sm"
					loading={submitting}
					title="Update this tenant's costs now"
				>
					<RefreshCw size={ICON.sm} /> Update costs
				</Button>
			</form>
		{/if}
	{/snippet}

	<CostTabs active="month" />

	{#if !data.enabled}
		<NotEnabled
			level={2}
			title="Tenant costs"
			description="See what each tenant's usage costs, set prices and track budgets."
			url={data.upgradeUrl}
		/>
	{:else}
		<div class="flex flex-col gap-6">
			{#if aggregated}
				<Alert tone="success" title="Costs updated" autoDismiss>
					{aggregated.entries_saved} cost lines written, {aggregated.budget_events} budget events published,
					{aggregated.anomalies} anomalies opened.
				</Alert>
			{:else if failure?.form === 'aggregate'}
				<Alert tone={failure.locked ? 'warn' : 'danger'}>{failure.message}</Alert>
			{/if}

			<section class="flex flex-col gap-4" aria-label="This month">
				<SectionHeading level={2}>This month</SectionHeading>
				{#if summary || dashboard}
					<Card>
						<div class="grid gap-6 lg:grid-cols-2">
							<div class="flex flex-col gap-4">
								<Stat
									label="Spend so far"
									value={summary ? money(summary.total_amount, summary.currency) : (dashboard?.total_cost_this_month ?? NO_VALUE)}
									mono
								/>
								{#if dashboard}
									<div class="grid gap-3 sm:grid-cols-3" data-testid="cost-dashboard">
										<Stat
											label="Budgets at risk"
											value={dashboard.budgets_at_risk.length}
											size="sm"
											tone={dashboard.budgets_at_risk.length > 0 ? 'warn' : undefined}
										/>
										<Stat
											label="Open anomalies"
											value={dashboard.open_anomalies}
											size="sm"
											tone={dashboard.open_anomalies > 0 ? 'warn' : undefined}
										/>
										<Stat label="Could save" value={money(dashboard.potential_savings, summary?.currency ?? '')} size="sm" mono />
									</div>
								{/if}
							</div>
							{#if summary}
								<div class="flex flex-col gap-2" data-testid="cost-summary">
									<p class="text-xs font-medium tracking-wide text-faint uppercase">By resource</p>
									<ul class="flex flex-col gap-2">
										{#each costShares(summary) as share (share.label)}
											<li class="grid grid-cols-[6rem_minmax(0,1fr)_7rem] items-center gap-3 text-sm">
												<span class="text-muted">{share.label}</span>
												<span class="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
													<span class="block h-full rounded-full bg-brand" style="width: {share.percent}%"></span>
												</span>
												<span class="text-right font-mono text-xs text-fg">{money(share.amount, summary.currency)}</span>
											</li>
										{/each}
									</ul>
									<p class="text-xs text-faint">From {summary.entry_count} cost {plural(summary.entry_count, 'line')} since the first of the month. Costs are updated every hour from the usage and AI meters.</p>
								</div>
							{:else if !data.summary.ok}
								<GateNotice gate={data.summary.gate} title="the split by resource" absent="The split by resource is not included in this build." />
							{/if}
						</div>
					</Card>
					{#if dashboard && dashboard.budgets_at_risk.length > 0}
						<ul class="flex flex-col gap-1 text-sm" aria-label="Budgets at risk">
							{#each dashboard.budgets_at_risk as alert (alert.budget_id + ':' + alert.threshold)}
								<li class="flex flex-wrap items-center gap-2">
									<Badge tone={alert.triggered ? 'danger' : 'warn'} size="sm">{alert.threshold}%</Badge>
									<span class="text-fg">{alert.budget_name}</span>
									<span class="font-mono text-xs text-muted">
										{alert.current_spend} of {alert.budget_amount} ({Math.round(alert.spend_percent)}%)
									</span>
								</li>
							{/each}
						</ul>
					{/if}
				{:else if !data.dashboard.ok}
					<GateNotice gate={data.dashboard.gate} title="this month's costs" absent="The cost ledger is not included in this build." />
				{/if}
			</section>
		</div>
	{/if}
</PageShell>
