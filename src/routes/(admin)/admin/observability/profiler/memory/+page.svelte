<script lang="ts">
	import { Alert, Badge, Button, Card, EmptyState, PageShell, SectionHeading, Stat, confirm as confirmDialog } from '@lyeve-labs/ui-kit';
	import RefreshButton from '$lib/components/RefreshButton.svelte';
	import { enhance } from '$app/forms';
	import { CONFIRM_FIELD, CONFIRMED } from '$lib/confirmation';
	import { AlertTriangle, CheckCircle, MemoryStick, RotateCcw } from '@lucide/svelte';
	import { NO_VALUE, formatBytes, formatDateTime, formatSignedBytes } from '$lib/format';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ProfilerTabs from '$lib/components/ProfilerTabs.svelte';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let resetting = $state(false);

	const memory = $derived(data.memory.ok ? data.memory.value : null);
	const ABSENT = 'The profiler is not included in this build.';
	const latest = $derived(memory?.snapshots.at(-1) ?? null);
</script>

{#snippet noMemory()}
	<MemoryStick size={ICON.lg} />
{/snippet}

<PageShell
	title="Profiler"
	documentTitle="Memory - Profiler"
	description="Track the heap over time and see whether memory is leaking."
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	{#snippet actions()}
		<RefreshButton />
		<form
			method="POST"
			action="?/reset"
			use:enhance={async ({ cancel, formData }) => {
				const confirmed = await confirmDialog(
					'Reset the profiler?',
					'Sampled requests and memory snapshots are deleted, and a new snapshot is taken. This cannot be undone.',
					{ confirmLabel: 'Reset' },
				);
				if (!confirmed) {
					cancel();
					return;
				}
				formData.set(CONFIRM_FIELD, CONFIRMED);
				resetting = true;
				return async ({ update }) => {
					resetting = false;
					await update({ reset: false });
				};
			}}
		>
			<Button type="submit" variant="secondary" size="sm" loading={resetting}>
				<RotateCcw size={ICON.sm} /> Reset
			</Button>
		</form>
	{/snippet}

	<ProfilerTabs active="memory" />

	{#if form?.form === 'reset'}
		{#if 'error' in form && form.error}
			<Alert tone="danger">{form.error}</Alert>
		{:else}
			<Alert tone="success" autoDismiss>Profiler reset.</Alert>
		{/if}
	{/if}

	<section class="flex flex-col gap-4" data-testid="profiler-memory">
		<div class="flex flex-wrap items-center gap-2">
			<SectionHeading level={2}>Memory</SectionHeading>
			{#if memory}
				{#if memory.leak_likely}
					<Badge tone="danger"><AlertTriangle size={ICON.xs} /> Leak likely</Badge>
				{:else}
					<Badge tone="success"><CheckCircle size={ICON.xs} /> Steady</Badge>
				{/if}
				<span class="ms-auto text-xs text-faint">{memory.snapshots.length} snapshots</span>
			{/if}
		</div>
		{#if !data.memory.ok}
			<GateNotice gate={data.memory.gate} title="the memory trend" absent={ABSENT} />
		{:else if !memory || !latest}
			<EmptyState iconSnippet={noMemory} title="No snapshots yet" description="Snapshots are taken on a schedule, and the first one appears here." />
		{:else}
			<Card>
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6" data-testid="memory-stats">
					<Stat size="sm" label="Heap in use" mono value={formatBytes(latest.heap_alloc)} />
					<Stat size="sm" label="Heap objects" mono value={latest.heap_objects} />
					<Stat size="sm" label="Allocated total" mono value={formatBytes(latest.total_alloc)} />
					<Stat size="sm" label="GC cycles" mono value={latest.num_gc} />
					<Stat size="sm" label="Goroutines" mono value={latest.num_goroutine} />
					<Stat size="sm" label="Heap slope" mono value="{formatSignedBytes(memory.slope_bytes_per_sec)}/s" tone={memory.leak_likely ? 'danger' : undefined} />
				</div>
				<p class="mt-3 text-xs text-muted">
					Last snapshot {formatDateTime(latest.timestamp, NO_VALUE)}.
					{#if memory.leak_reason}{memory.leak_reason}{/if}
				</p>
			</Card>
		{/if}
	</section>

</PageShell>
