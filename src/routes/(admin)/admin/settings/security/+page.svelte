<script lang="ts">
	import { Alert, Badge, Card, PageShell, SectionHeading, Stat, EmptyState, type StatusTone } from '@lyeve-labs/ui-kit';
	import { CircleCheck, CircleAlert, CircleX, CircleDashed } from '@lucide/svelte';
	import type { PageData } from './$types';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import {
		CONTROL_LABEL,
		CONTROL_SUMMARY,
		STATUS_LABEL,
		type ControlStatus,
		type SecurityControl,
	} from '$lib/api/security';
	import { formatDateTime } from '$lib/format';
	import { ICON as RUNG } from '$lib/icon';

	let { data }: { data: PageData } = $props();

	const TONE: Record<ControlStatus, StatusTone> = {
		PASS: 'success',
		WARN: 'warn',
		FAIL: 'danger',
		SKIP: 'neutral',
	};
	const ICON = { PASS: CircleCheck, WARN: CircleAlert, FAIL: CircleX, SKIP: CircleDashed };
	const ICON_CLASS: Record<ControlStatus, string> = {
		PASS: 'text-success',
		WARN: 'text-warn',
		FAIL: 'text-danger',
		SKIP: 'text-faint',
	};

	// Failures first, then what is compiled and off, then what is enforcing,
	// then what is not built in. The list is what to do, in that order.
	const ORDER: Record<ControlStatus, number> = { FAIL: 0, WARN: 1, PASS: 2, SKIP: 3 };
	const controls = $derived(
		[...(data.report.ok ? data.report.value.controls : [])].sort((a, b) => ORDER[a.status] - ORDER[b.status])
	);
	const count = (status: ControlStatus) => controls.filter((c) => c.status === status).length;
	const label = (c: SecurityControl) => CONTROL_LABEL[c.control] ?? c.control;
</script>

<PageShell
	title="Security"
	description="See which controls protect this engine, and how to turn on the rest."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#if !data.report.ok}
		<GateNotice
			level={2}
			gate={data.report.gate}
			title="Security"
			absent="The security report is not included in this build. You can find the same controls in the engine's boot log."
		/>
	{:else}
		{@const report = data.report.value}
		{#if report.failures > 0}
			<Alert tone="danger" title="Configured but not enforcing">
				{report.failures === 1
					? 'One control is switched on and not in the request path.'
					: `${report.failures} controls are switched on and not in the request path.`}
				Fix this first, because the engine looks protected and is not.
			</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-4">
			<Stat size="sm" mono label={STATUS_LABEL.PASS} value={count('PASS')} tone="success" />
			<Stat size="sm" mono label={STATUS_LABEL.FAIL} value={count('FAIL')} tone={count('FAIL') ? 'danger' : 'neutral'} />
			<Stat size="sm" mono label={STATUS_LABEL.WARN} value={count('WARN')} tone={count('WARN') ? 'warn' : 'neutral'} />
			<Stat size="sm" mono label={STATUS_LABEL.SKIP} value={count('SKIP')} tone="neutral" />
		</div>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Controls</SectionHeading>

			{#if controls.length === 0}
				<EmptyState
					title="No controls reported"
					description="The security report came back empty. Check that the plugins that supply it are running."
				/>
			{:else}
				<Card pad="none">
					<ul class="divide-y divide-line">
						{#each controls as c (c.control)}
							{@const Icon = ICON[c.status]}
							<li class="flex flex-wrap items-start gap-x-4 gap-y-2 p-4">
								<Icon size={RUNG.md} class="mt-0.5 shrink-0 {ICON_CLASS[c.status]}" aria-hidden="true" />
								<div class="min-w-0 flex-1 basis-64">
									<div class="flex flex-wrap items-center gap-2">
										<span class="text-sm font-medium text-fg">{label(c)}</span>
										<Badge tone={TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
									</div>
									{#if CONTROL_SUMMARY[c.control]}
										<p class="mt-1 text-sm text-muted">{CONTROL_SUMMARY[c.control]}</p>
									{/if}
									<p class="mt-1 font-mono text-xs text-faint">{c.detail}</p>
								</div>
								{#if c.remedy}
									<p class="basis-full text-sm text-fg sm:basis-72 sm:text-right">
										<span class="text-faint">To turn it on:</span>
										{c.remedy}
									</p>
								{/if}
							</li>
						{/each}
					</ul>
				</Card>
			{/if}

			<p class="text-xs text-faint">
				Checked {formatDateTime(report.checked_at)}. Crawlers are refused on every admin response
				and at /robots.txt. The public content API is left open to the crawlers a site invites.
			</p>
		</section>
	{/if}
</PageShell>
