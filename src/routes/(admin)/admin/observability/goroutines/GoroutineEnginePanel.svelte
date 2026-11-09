<script lang="ts">
	import { Alert, Badge, Button, Card, Checkbox, EmptyState, Input, NumberInput, SectionHeading, Stat, Table } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { Cpu } from '@lucide/svelte';
	import {
		ASYNC_QUEUE_SIZE,
		ASYNC_TIMEOUT_MAX,
		ASYNC_WORKERS,
		PARALLEL_MAX_CONCURRENT,
		PARALLEL_TIMEOUT_MAX,
		POOL_SIZE,
	} from '$lib/api/goroutine-engine';
	import { formRefusal } from '$lib/api/refusal';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { NO_VALUE, formatGoDuration } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import type { TunableForm } from './+page.server';
	import { ICON } from '$lib/icon';

	interface Props {
		/** What the page load read from the goroutine engine plugin. */
		engine: PageData['goroutineEngine'];
		/** The page's last action answer. Each tunable form shows only its own. */
		form: ActionData;
	}

	let { engine: ge, form }: Props = $props();

	const geAnswered = $derived(Boolean(ge.snapshot || ge.pool || ge.parallel || ge.asyncHooks));
	// The writes need super_admin and a license that lets tuning through. A
	// form that could only ever answer 403 or 402 is shown disabled with the
	// reason. The tiles above it are reads and stay either way.
	const canTune = $derived(ge.superAdmin && ge.licensed);

	// The forms open on the live values and send them all back, so a field
	// the operator did not touch is saved as it was. They are seeded once:
	// a refresh must not overwrite an edit in progress.
	// svelte-ignore state_referenced_locally
	const seed = ge;
	let poolSize = $state(seed.pool?.size ?? POOL_SIZE.min);
	let parallelMax = $state(seed.parallel?.max_concurrent ?? PARALLEL_MAX_CONCURRENT.min);
	let parallelTimeout = $state(seed.parallel?.timeout ?? '30s');
	let asyncWorkers = $state(seed.asyncHooks?.workers ?? ASYNC_WORKERS.min);
	let asyncQueue = $state(seed.asyncHooks?.queue_size ?? ASYNC_QUEUE_SIZE.min);
	let asyncTimeout = $state(seed.asyncHooks?.timeout ?? '5s');
	let asyncEnabled = $state(seed.asyncHooks?.enabled ?? false);
	let saving = $state<TunableForm | null>(null);

	/** The last action's answer, only for the form that asked. */
	function tunableNote(which: TunableForm) {
		return form?.form === which ? form : null;
	}

	function tunable(which: TunableForm) {
		return () => {
			saving = which;
			return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
				saving = null;
				await update({ reset: false });
			};
		};
	}

	const onOff = (v: boolean | undefined) => (v ? 'On' : 'Off');
</script>

{#snippet noGoroutineEngine()}
	<Cpu size={ICON.lg} />
{/snippet}

{#snippet tunableStatus(which: TunableForm)}
	{@const note = tunableNote(which)}
	{@const refusal = formRefusal(note)}
	<FormErrors message={note?.error} refused={refusal} />
	{#if note?.saved}
		<!-- The confirmation clears itself. The caveat is a standing fact about
		     the value now in force, so it stays beside the form. -->
		<Alert tone="success" autoDismiss>Applied.</Alert>
		<p class="text-xs text-muted">The change lasts until the engine restarts.</p>
	{/if}
{/snippet}

<!-- The goroutine engine plugin's views of the engine's scaling
     primitives. Every admin reads the four views and the per-owner counts.
     The tunables need super_admin, and a form that cannot succeed says why
     instead of failing. -->
<section class="flex flex-col gap-4" data-testid="goroutine-engine">
	<div class="flex flex-wrap items-center gap-2">
		<SectionHeading level={2}>Goroutine engine</SectionHeading>
		<Badge tone="violet" size="sm">Beta</Badge>
		<span class="text-xs text-faint">Changes last until the engine restarts.</span>
	</div>

	{#if !geAnswered}
		<EmptyState
			iconSnippet={noGoroutineEngine}
			title="Goroutine engine unavailable"
			description="Could not load the worker pool, parallel engine or async hook state. Reload the page to try again."
		/>
	{:else}
		<div class="grid gap-4 md:grid-cols-2" data-testid="goroutine-views">
			<Card>
				{#snippet header()}
					<SectionHeading level={3}>Tracker</SectionHeading>
				{/snippet}
				{#if ge.snapshot}
					<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
						<Stat size="sm" label="Tracked" mono value={ge.snapshot.total} />
						<Stat size="sm" label="Runtime" mono value={ge.snapshot.runtime_total ?? NO_VALUE} />
						<Stat size="sm" label="Ceiling" mono value={ge.snapshot.max_goroutines ?? NO_VALUE} />
						<Stat size="sm" label="Leak threshold" mono value={formatGoDuration(ge.snapshot.leak_threshold)} />
					</div>
				{:else}
					<p class="text-xs text-muted">Could not load the tracker.</p>
				{/if}
			</Card>

			<Card>
				{#snippet header()}
					<SectionHeading level={3}>Worker pool</SectionHeading>
				{/snippet}
				{#if ge.pool}
					<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
						<Stat size="sm" label="Size" mono value={ge.pool.size} />
						<Stat size="sm" label="Active" mono value={ge.pool.active} />
						<Stat size="sm" label="Waiting" mono value={ge.pool.waiting ?? NO_VALUE} />
						<Stat size="sm" label="Completed" mono value={ge.pool.completed} />
						<Stat size="sm" label="Failed" mono value={ge.pool.failed} tone={ge.pool.failed > 0 ? 'warn' : undefined} />
						<Stat size="sm" label="Dropped" mono value={ge.pool.dropped} tone={ge.pool.dropped > 0 ? 'danger' : undefined} />
						<Stat size="sm" label="Avg latency" mono value={formatGoDuration(ge.pool.avg_latency)} />
						<Stat size="sm" label="Task timeout" mono value={formatGoDuration(ge.pool.task_timeout)} />
					</div>
				{:else}
					<p class="text-xs text-muted">This engine runs without a worker pool.</p>
				{/if}
			</Card>

			<Card>
				{#snippet header()}
					<SectionHeading level={3}>Parallel engine</SectionHeading>
				{/snippet}
				{#if ge.parallel}
					<div class="grid grid-cols-2 gap-4">
						<Stat size="sm" label="Max concurrent" mono value={ge.parallel.max_concurrent} />
						<Stat size="sm" label="Timeout" mono value={formatGoDuration(ge.parallel.timeout)} />
					</div>
				{:else}
					<p class="text-xs text-muted">This engine runs without a parallel engine.</p>
				{/if}
			</Card>

			<Card>
				{#snippet header()}
					<SectionHeading level={3}>Async hooks</SectionHeading>
				{/snippet}
				{#if ge.asyncHooks}
					<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
						<Stat size="sm" label="Enabled" value={onOff(ge.asyncHooks.enabled)} tone={ge.asyncHooks.enabled ? 'success' : undefined} />
						<Stat size="sm" label="Workers" mono value={ge.asyncHooks.workers ?? NO_VALUE} />
						<Stat size="sm" label="Queue size" mono value={ge.asyncHooks.queue_size ?? NO_VALUE} />
						<Stat size="sm" label="Timeout" mono value={formatGoDuration(ge.asyncHooks.timeout)} />
						<Stat size="sm" label="Queued" mono value={ge.asyncHooks.queued ?? NO_VALUE} />
						<Stat size="sm" label="Running" mono value={ge.asyncHooks.running ?? NO_VALUE} />
						<Stat size="sm" label="Overflow" mono value={ge.asyncHooks.overflow ?? NO_VALUE} tone={(ge.asyncHooks.overflow ?? 0) > 0 ? 'warn' : undefined} />
						<Stat size="sm" label="Dropped" mono value={ge.asyncHooks.dropped ?? NO_VALUE} tone={(ge.asyncHooks.dropped ?? 0) > 0 ? 'danger' : undefined} />
					</div>
				{:else}
					<p class="text-xs text-muted">This engine runs without an async hook executor.</p>
				{/if}
			</Card>
		</div>

		<Card>
			{#snippet header()}
				<div class="flex flex-wrap items-center gap-2">
					<SectionHeading level={3}>Goroutines by owner</SectionHeading>
					<span class="ms-auto text-xs text-faint">{ge.byOwner.length} owners</span>
				</div>
			{/snippet}
			{#if ge.byOwner.length === 0}
				<p class="text-sm text-muted">
					No goroutines with an owner yet. Goroutines that a plugin or an engine subsystem
					starts through the tracker appear here under the owner's name.
				</p>
			{:else}
				<div data-testid="goroutine-owners">
				<Table label="Goroutines by owner">
					<thead>
						<tr>
							<th scope="col">Owner</th>
							<th scope="col" class="text-right">Goroutines</th>
							<th scope="col" class="text-right">Oldest</th>
						</tr>
					</thead>
					<tbody>
						{#each ge.byOwner as row (row.owner)}
							<tr>
								<td data-cell="nowrap" class="font-mono text-xs">{row.owner}</td>
								<td data-cell="nowrap" class="text-right font-mono text-xs">{row.total}</td>
								<td data-cell="nowrap" class="text-right font-mono text-xs">{row.oldest || NO_VALUE}</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				</div>
			{/if}
		</Card>

		{#if !ge.superAdmin}
			<p class="text-xs text-muted" data-testid="goroutine-role-note">
				Only a super admin can change these.
			</p>
		{/if}
		{#if !ge.licensed}
			<p class="text-xs text-muted" data-testid="goroutine-license-note">
				Tuning the goroutine engine is not enabled on this engine. You can still see the readings above.
			</p>
		{/if}

		<div class="grid gap-4 lg:grid-cols-3" data-testid="goroutine-tunables">
			<Card>
				{#snippet header()}
					<SectionHeading level={3}>Resize the pool</SectionHeading>
				{/snippet}
				<form method="POST" action="?/pool" use:enhance={tunable('pool')} class="flex flex-col gap-4" aria-label="Resize the pool">
					<fieldset disabled={!canTune || !ge.pool} class="flex flex-col gap-4">
						<NumberInput
							id="ge-pool-size"
							name="size"
							label="Pool size"
							hint="Workers running at the same time, {POOL_SIZE.min} to {POOL_SIZE.max}."
							min={POOL_SIZE.min}
							max={POOL_SIZE.max}
							bind:value={poolSize}
						/>
						<div>
							<Button type="submit" variant="primary" size="sm" loading={saving === 'pool'}>Apply</Button>
						</div>
					</fieldset>
					{@render tunableStatus('pool')}
				</form>
			</Card>

			<Card>
				{#snippet header()}
					<SectionHeading level={3}>Parallel engine</SectionHeading>
				{/snippet}
				<form method="POST" action="?/parallel" use:enhance={tunable('parallel')} class="flex flex-col gap-4" aria-label="Reconfigure the parallel engine">
					<fieldset disabled={!canTune || !ge.parallel} class="flex flex-col gap-4">
						<NumberInput
							id="ge-parallel-max"
							name="max_concurrent"
							label="Max concurrent"
							hint="Items processed at the same time, {PARALLEL_MAX_CONCURRENT.min} to {PARALLEL_MAX_CONCURRENT.max}."
							min={PARALLEL_MAX_CONCURRENT.min}
							max={PARALLEL_MAX_CONCURRENT.max}
							bind:value={parallelMax}
						/>
						<Input
							id="ge-parallel-timeout"
							name="timeout"
							label="Timeout"
							hint="Per-item deadline as a duration, up to {PARALLEL_TIMEOUT_MAX}."
							placeholder="30s"
							bind:value={parallelTimeout}
							autocomplete="off"
							mono
						/>
						<div>
							<Button type="submit" variant="primary" size="sm" loading={saving === 'parallel'}>Apply</Button>
						</div>
					</fieldset>
					{@render tunableStatus('parallel')}
				</form>
			</Card>

			<Card>
				{#snippet header()}
					<SectionHeading level={3}>Async hooks</SectionHeading>
				{/snippet}
				<form method="POST" action="?/asyncHooks" use:enhance={tunable('asyncHooks')} class="flex flex-col gap-4" aria-label="Reconfigure the async hooks">
					<fieldset disabled={!canTune || !ge.asyncHooks} class="flex flex-col gap-4">
						<NumberInput
							id="ge-async-workers"
							name="workers"
							label="Workers"
							hint="{ASYNC_WORKERS.min} to {ASYNC_WORKERS.max}."
							min={ASYNC_WORKERS.min}
							max={ASYNC_WORKERS.max}
							bind:value={asyncWorkers}
						/>
						<NumberInput
							id="ge-async-queue"
							name="queue_size"
							label="Queue size"
							hint="How many hooks can wait for a worker before the next one runs inline, {ASYNC_QUEUE_SIZE.min} to {ASYNC_QUEUE_SIZE.max}."
							min={ASYNC_QUEUE_SIZE.min}
							max={ASYNC_QUEUE_SIZE.max}
							bind:value={asyncQueue}
						/>
						<Input
							id="ge-async-timeout"
							name="timeout"
							label="Timeout"
							hint="Per-hook deadline as a duration, up to {ASYNC_TIMEOUT_MAX}."
							placeholder="5s"
							bind:value={asyncTimeout}
							autocomplete="off"
							mono
						/>
						<Checkbox
							id="ge-async-enabled"
							name="enabled"
							label="Run hooks asynchronously"
							description="When on, hooks run in the background on the async workers. When off, each hook runs during the request that fired it."
							bind:checked={asyncEnabled}
						/>
						<div>
							<Button type="submit" variant="primary" size="sm" loading={saving === 'asyncHooks'}>Apply</Button>
						</div>
					</fieldset>
					{@render tunableStatus('asyncHooks')}
				</form>
			</Card>
		</div>
	{/if}
</section>
