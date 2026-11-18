<script lang="ts">
	import { Alert, Badge, Button, CopyButton, SectionHeading, SegmentedControl, type StatusTone } from '@lyeve-labs/ui-kit';
	import { RotateCw } from '@lucide/svelte';
	import JsonTree from './JsonTree.svelte';
	import type { FlowRun, RunStep } from '#lib/api/flows.ts';
	import { formatDuration } from '#lib/flow/time.ts';
	import { statusTone } from '#lib/flow/triggers.ts';
	import { ICON } from '#lib/icon.ts';

	interface Props {
		/** The run as the plugin served it. */
		run: FlowRun | null;
		/** The step to open first. The reader picks another from the list. */
		focus?: string | null;
		/** Runs the test again with the same input. */
		onrerun?: () => void;
		rerunning?: boolean;
	}

	let { run, focus = null, onrerun, rerunning = false }: Props = $props();

	// The tree is the default. Raw text is one click away for a paste.
	let view = $state<'tree' | 'raw'>('tree');

	let picked = $state<string | null>(null);

	const steps = $derived(run?.steps ?? []);

	const withheld = $derived(run?.withheld === true);

	// A withheld run carries no error text, so its status says it failed.
	const failed = $derived(steps.find((s) => s.status === 'failed' && (!!s.error || withheld)) ?? null);

	const current = $derived.by<RunStep | null>(() => {
		const want = picked ?? focus;
		return steps.find((s) => s.node_id === want) ?? failed ?? steps.find((s) => s.status === 'failed') ?? steps[0] ?? null;
	});

	function stepTone(step: RunStep): StatusTone {
		if (step.dry_run) return 'warn';
		if (step.status === 'succeeded') return 'success';
		if (step.status === 'failed') return 'danger';
		return 'neutral';
	}

	function stepLabel(step: RunStep): string {
		return step.dry_run ? 'dry-run' : step.status;
	}

	function pretty(v: unknown): string {
		if (v === undefined) return '';
		return JSON.stringify(v, null, 2) ?? 'null';
	}
</script>

{#if !run}
	<p class="p-4 text-sm text-muted">No run yet. Press Run test to execute the draft.</p>
{:else}
	<div class="flex h-full min-h-0 flex-col" data-testid="run-viewer">
		<div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-2 text-xs text-muted">
			<Badge tone={statusTone(run.status)} dot>{run.status}</Badge>
			<span>{run.is_test ? 'Test run' : 'Live run'}</span>
			<span>{formatDuration(run.duration_ms)}</span>
			<span class="font-mono">{run.id}</span>
			<span class="ml-auto flex items-center gap-2">
				<SegmentedControl
					label="Value view"
					labelHidden
					size="sm"
					value={view}
					options={[
						{ value: 'tree', label: 'Tree' },
						{ value: 'raw', label: 'Raw' },
					]}
					onchange={(v) => (view = v)}
				/>
				{#if onrerun}
					<Button variant="secondary" size="sm" onclick={onrerun} loading={rerunning} title="Run the test again with the same input">
						<RotateCw size={ICON.sm} />
						Run again
					</Button>
				{/if}
			</span>
		</div>
		<!-- The message is printed once, on the step that raised it. The banner
		     only says where to look, and carries the text itself only when no
		     step owns it: a timeout or a refused trigger fails the run as a
		     whole. -->
		{#if withheld}
			<div class="shrink-0 px-4 pt-3" data-testid="run-withheld">
				<Alert tone="info" title="Values withheld">
					{#snippet children()}Your role cannot see the data this run used, so its inputs, outputs and errors are hidden.{/snippet}
				</Alert>
			</div>
		{/if}
		{#if run.error || (withheld && run.status === 'failed')}
			<div class="shrink-0 px-4 pt-3" data-testid="run-failure">
				<Alert tone="danger">
					{#snippet children()}
						{#if failed}
							Run failed at <span class="font-mono">{failed.node_id}</span>.
							{#if current?.id !== failed.id}
								<button type="button" class="underline transition-colors hover:text-fg" onclick={() => (picked = failed.node_id)}>Show the step</button>
							{/if}
						{:else}
							{run.error || 'The run failed.'}
						{/if}
					{/snippet}
				</Alert>
			</div>
		{/if}
		<div class="flex min-h-0 flex-1">
			<ul class="w-64 shrink-0 overflow-y-auto border-r border-line" aria-label="Steps">
				{#each steps as step (step.id)}
					<li>
						<button
							type="button"
							class="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2 {current?.id === step.id ? 'bg-surface-2' : ''}"
							aria-pressed={current?.id === step.id}
							onclick={() => (picked = step.node_id)}
						>
							<span class="min-w-0 flex-1">
								<span class="block truncate font-medium text-fg">{step.node_id}</span>
								<span class="block truncate font-mono text-xs text-faint">{step.node_type}</span>
							</span>
							<span class="text-xs tabular-nums text-faint">{formatDuration(step.duration_ms)}</span>
							<Badge tone={stepTone(step)} size="sm">{stepLabel(step)}</Badge>
						</button>
					</li>
				{:else}
					<li class="p-3 text-sm text-muted">No step ran.</li>
				{/each}
			</ul>
			<div class="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
				{#if current}
					{#if current.error}
						<Alert tone="danger" title="{current.node_id} failed" class="mb-3">
							{#snippet children()}{current.error}{/snippet}
						</Alert>
					{/if}
					<div class="mb-3 flex items-center justify-between gap-2">
						<span class="text-xs text-muted">Step <span class="font-mono text-fg">{current.node_id}</span>, attempt {current.attempt}</span>
						<!-- A withheld value comes back as null, which a copy would pass off as real. -->
						{#if !withheld}
							<CopyButton value={pretty({ input: current.input, output: current.output, error: current.error || undefined })} label="Copy step" />
						{/if}
					</div>
					<div class="grid gap-4 md:grid-cols-2">
						<section>
							<SectionHeading level={3} variant="eyebrow" class="mb-1">
								Input
								{#snippet actions()}{#if !withheld}<CopyButton value={pretty(current.input)} label="Copy input" />{/if}{/snippet}
							</SectionHeading>
							{@render valueBox(current.input)}
						</section>
						<section>
							<SectionHeading level={3} variant="eyebrow" class="mb-1">
								Output
								{#snippet actions()}{#if !withheld}<CopyButton value={pretty(current.output)} label="Copy output" />{/if}{/snippet}
							</SectionHeading>
							{@render valueBox(current.output)}
						</section>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

{#snippet valueBox(value: unknown)}
	<div class="max-h-80 overflow-auto rounded-md border border-line bg-surface-2 p-3">
		{#if withheld}
			<p class="text-xs text-muted">Withheld from you.</p>
		{:else if view === 'tree'}
			<JsonTree {value} />
		{:else}
			<pre class="font-mono text-xs text-fg">{pretty(value)}</pre>
		{/if}
	</div>
{/snippet}
