<script lang="ts">
	import { Alert, Button, Card, Input, NumberInput, PageShell, SectionHeading } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { Download, Flame } from '@lucide/svelte';
	import { PROFILE_SECONDS, PROFILE_TYPES } from '$lib/api/profiler';
	import { NO_VALUE, formatDateTime } from '$lib/format';
	import ProfilerTabs from '$lib/components/ProfilerTabs.svelte';
	import type { ActionData } from './$types';
	import { ICON } from '$lib/icon';

	let { form }: { form: ActionData } = $props();

	let capturing = $state(false);
	let flameEndpoint = $state('');
	let flameSeconds = $state<number>(PROFILE_SECONDS.default);
	let cpuSeconds = $state<number>(PROFILE_SECONDS.default);

	// The flamegraph is the last action's answer while the page holds it. It
	// is drawn as an image from a data URL rather than inlined as markup: the
	// SVG comes from the engine's pprof renderer, and an image cannot run the
	// script such a file may carry.
	const graph = $derived(form?.form === 'flamegraph' && 'graph' in form ? form.graph : null);
	const graphSrc = $derived(graph ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(graph.svg)}` : null);

	const PROFILE_LABELS: Record<(typeof PROFILE_TYPES)[number], string> = {
		cpu: 'CPU',
		goroutine: 'Goroutines',
		heap: 'Heap',
		allocs: 'Allocations',
	};
</script>

<PageShell
	title="Profiler"
	documentTitle="Profiles - Profiler"
	description="Capture a CPU flamegraph or download a pprof profile."
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	<ProfilerTabs active="capture" />

	<div class="grid gap-4 lg:grid-cols-2">
		<!-- A pprof export is a file. The form posts without enhancement so the
		     browser takes the engine's attachment as a download. -->
		<Card>
			{#snippet header()}
				<div class="flex flex-wrap items-center gap-2">
					<SectionHeading level={3}>pprof export</SectionHeading>
				</div>
			{/snippet}
			<div class="flex flex-col gap-4" data-testid="profiler-exports">
				<p class="text-xs text-muted">
					Each download is a gzipped pprof profile. A heap or allocations profile contains raw
					process memory, so each export is logged, and the engine can refuse it.
				</p>
				<NumberInput
					id="cpu-seconds"
					name="cpu_seconds"
					label="CPU window"
					hint="Seconds the CPU profile samples, {PROFILE_SECONDS.min} to {PROFILE_SECONDS.max}."
					min={PROFILE_SECONDS.min}
					max={PROFILE_SECONDS.max}
					bind:value={cpuSeconds}
				/>
				<div class="flex flex-wrap gap-2">
					{#each PROFILE_TYPES as type (type)}
						<!-- A download, so it posts to an endpoint and stays a plain form. -->
						<form method="POST" action="/admin/observability/profiler/profile/{type}">
							{#if type === 'cpu'}
								<input type="hidden" name="duration_sec" value={cpuSeconds} />
							{/if}
							<Button type="submit" variant="secondary" size="sm">
								<Download size={ICON.sm} /> {PROFILE_LABELS[type]}
							</Button>
						</form>
					{/each}
				</div>
			</div>
		</Card>

		<Card>
			{#snippet header()}
				<div class="flex flex-wrap items-center gap-2">
					<SectionHeading level={3}>Flamegraph</SectionHeading>
				</div>
			{/snippet}
			<form
				method="POST"
				action="?/flamegraph"
				class="flex flex-col gap-4"
				aria-label="Capture a flamegraph"
				use:enhance={() => {
					capturing = true;
					return async ({ update }) => {
						capturing = false;
						await update({ reset: false });
					};
				}}
			>
				<p class="text-xs text-muted">
					Captures a CPU profile over the window and draws it as a graph. The endpoint only
					labels the result. The profile covers every goroutine in the process.
				</p>
				<Input
					id="flame-endpoint"
					name="endpoint"
					label="Endpoint"
					placeholder="/api/v1/content"
					bind:value={flameEndpoint}
					autocomplete="off"
					mono
				/>
				<NumberInput
					id="flame-seconds"
					name="duration_sec"
					label="Window"
					hint="Seconds, {PROFILE_SECONDS.min} to {PROFILE_SECONDS.max}."
					min={PROFILE_SECONDS.min}
					max={PROFILE_SECONDS.max}
					bind:value={flameSeconds}
				/>
				<div>
					<Button type="submit" variant="primary" size="sm" loading={capturing}>
						<Flame size={ICON.sm} /> Capture
					</Button>
				</div>
				{#if form?.form === 'flamegraph' && 'error' in form && form.error}
					<Alert tone="danger">{form.error}</Alert>
				{/if}
			</form>
		</Card>
	</div>

	{#if graph && graphSrc}
		<Card>
			{#snippet header()}
				<div class="flex flex-wrap items-center gap-2">
					<SectionHeading level={3}><span class="font-mono">{graph.endpoint}</span></SectionHeading>
					<span class="ms-auto text-xs text-faint">{graph.duration_sec}s CPU, captured {formatDateTime(graph.captured_at, NO_VALUE)}</span>
				</div>
			{/snippet}
			<div class="overflow-x-auto" data-testid="flamegraph">
				<img src={graphSrc} alt="CPU flamegraph for {graph.endpoint}" class="max-w-none" />
			</div>
		</Card>
	{/if}
</PageShell>
