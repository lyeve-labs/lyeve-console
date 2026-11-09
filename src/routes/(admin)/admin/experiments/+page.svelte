<script lang="ts">
	import {
		Badge,
		Button,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		SearchInput,
		Table,
		Textarea,
		Toggle,
		confirm as confirmDialog,
		toast,
		Pagination,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { CONFIRM_FIELD, CONFIRMED } from '$lib/confirmation';
	import { confirmed, tracked } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Copy, FlaskConical, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import { duplicateRow } from '$lib/duplicate';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import {
		STATUS_LABELS,
		TRANSITION_LABELS,
		isFinished,
		movesFrom,
		statusTone,
		type Experiment,
	} from '$lib/api/ab-testing';
	import { formatDateTime, plural } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/*
	 * The drawer and the row actions share one `form` result. Each failure
	 * names its action: a save shows in the drawer, a delete or a move on the
	 * page, so a failed delete never reads as a failed save in the next drawer.
	 * Opening the drawer clears what an earlier attempt left.
	 */
	let cleared = $state<unknown>(null);
	const failure = $derived.by(() => {
		const f = form as { action?: unknown; error?: unknown } | null;
		if (!f || f === cleared || typeof f.error !== 'string') return null;
		return { action: String(f.action ?? ''), error: f.error };
	});
	const saveFailure = $derived(failure?.action === 'save' ? failure.error : undefined);
	const pageFailure = $derived(failure && failure.action !== 'save' ? failure.error : undefined);

	let narrow = $state('');
	const visible = $derived(
		narrow.trim()
			? data.experiments.filter((e) =>
					`${e.name} ${e.description ?? ''}`.toLowerCase().includes(narrow.trim().toLowerCase()),
				)
			: data.experiments,
	);
	const running = $derived(data.experiments.filter((e) => e.status === 'running').length);

	let open = $state(false);
	let editing = $state<Experiment | null>(null);

	let name = $state('');
	let description = $state('');
	let threshold = $state('0.95');
	let minSample = $state('100');
	let autoStop = $state(false);

	function openCreate() {
		cleared = form;
		editing = null;
		name = '';
		description = '';
		threshold = '0.95';
		minSample = '100';
		autoStop = false;
		open = true;
	}

	function openEdit(e: Experiment) {
		cleared = form;
		editing = e;
		name = e.name;
		description = e.description ?? '';
		threshold = String(e.significance_threshold);
		minSample = String(e.min_sample_size);
		autoStop = e.auto_stop_enabled;
		open = true;
	}

	/**
	 * Copy an experiment into the create drawer.
	 *
	 * The thresholds and the sample size are the shape somebody pressed
	 * Duplicate for. The results are not copied, because they belong to the
	 * run that produced them, and auto-stop arrives off so a copy cannot end
	 * itself on the original's numbers.
	 */
	function openDuplicate(source: Experiment) {
		cleared = form;
		const draft = duplicateRow(source as unknown as Record<string, unknown>, {
			taken: data.experiments.map((x) => x.name),
		});
		editing = null;
		name = String(draft.name ?? source.name);
		description = source.description ?? '';
		threshold = String(source.significance_threshold);
		minSample = String(source.min_sample_size);
		autoStop = false;
		open = true;
	}

	const saveExperiment: SubmitFunction = () => {
		const subject = name;
		const verb = editing ? 'Saved' : 'Created';
		return async ({ result, update }) => {
			if (result.type !== 'failure') open = false;
			await update();
			if (result.type === 'success') toast.success(`${verb} ${subject}`);
		};
	};

	/** What an experiment is once a move has landed, for the confirmation. */
	const AFTER_MOVE: Record<string, string> = {
		start: 'running',
		pause: 'paused',
		resume: 'running',
		stop: 'stopped',
	};

	/**
	 * Stopping ends an experiment for good: stopped and completed are both
	 * terminal, so there is no way back to running. That is worth asking about,
	 * where starting and pausing are not.
	 */
	function moveExperiment(e: Experiment, move: string): SubmitFunction {
		return async ({ cancel, formData }) => {
			if (move === 'stop') {
				const ok = await confirmDialog(
					`Stop ${e.name}?`,
					'A stopped experiment cannot be started again. Pause it instead if you mean to come back to it.',
					{ confirmLabel: 'Stop' },
				);
				if (!ok) {
					cancel();
					return;
				}
				formData.set(CONFIRM_FIELD, CONFIRMED);
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`${e.name} is ${AFTER_MOVE[move] ?? move}`);
			};
		};
	}

	function removeExperiment(e: Experiment): SubmitFunction {
		return confirmed(
			`Delete experiment ${e.name}?`,
			'Its variants, metrics and recorded exposures are deleted too.',
			{ confirmLabel: 'Delete', success: `${e.name} deleted.` },
		);
	}

	const saveExperimentSubmit = tracked(saveExperiment);
</script>

<PageShell
	title="Experiments"
	description="Split traffic between variants and see which one wins."
	width="wide"
>
	{#snippet actions()}
		{#if data.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New experiment
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="A/B testing"
			absent="A/B testing is not included in this build."
		/>
	{:else}
		<FormErrors message={pageFailure} />

		{#if data.experiments.length === 0}
			<EmptyState
				level={2}
				title="No experiments yet"
				description="Create an experiment to split traffic between variants and measure the difference."
			>
				{#snippet iconSnippet()}
					<FlaskConical size={ICON.lg} />
				{/snippet}
				{#snippet action()}
					<Button variant="secondary" onclick={openCreate}>
						<Plus size={ICON.sm} /> New experiment
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<ListToolbar label="Filter experiments">
				{#snippet search()}
					<label for="experiment-search" class="sr-only">Search experiments</label>
					<SearchInput id="experiment-search" bind:value={narrow} placeholder="Search experiments" />
				{/snippet}
			</ListToolbar>

			<p class="text-xs text-muted">
				{running}
				{plural(running, 'experiment is', 'experiments are')} running and splitting traffic now.
			</p>

			{#if visible.length === 0}
				<EmptyState
					level={2}
					title="No experiments match this search"
					description="The search covers names and descriptions."
				>
					{#snippet iconSnippet()}
						<FlaskConical size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Experiments">
					<thead>
						<tr>
							<th scope="col">Experiment</th>
							<th scope="col">Status</th>
							<th scope="col">Exposures needed</th>
							<th scope="col">Created</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each visible as e (e.id)}
							<tr>
								<td>
									<a class="relative hit-area font-medium text-brand hover:underline" href="/admin/experiments/{e.id}">
										{e.name}
									</a>
									{#if e.description}
										<div class="max-w-md truncate text-xs text-faint">{e.description}</div>
									{/if}
								</td>
								<td data-cell="nowrap">
									<Badge tone={statusTone(e.status)} dot>{STATUS_LABELS[e.status]}</Badge>
								</td>
								<td data-cell="nowrap" class="text-xs text-faint">
									{e.min_sample_size} across all variants
								</td>
								<td data-cell="nowrap" class="text-xs text-faint">
									{formatDateTime(e.created_at)}
								</td>
								<td data-cell="nowrap">
									<div class="flex items-center justify-end gap-1">
										<!-- Only the moves the engine accepts from this status. A
										     button that can only answer 409 is worse than no
										     button, so the map is mirrored rather than guessed. -->
										{#each movesFrom(e.status) as move (move)}
											<form method="POST" action="?/move" use:enhance={moveExperiment(e, move)}>
												<input type="hidden" name="id" value={e.id} />
												<input type="hidden" name="move" value={move} />
												<Button variant="ghost" size="sm" type="submit">
													{TRANSITION_LABELS[move]}
												</Button>
											</form>
										{/each}
										{#if !isFinished(e.status)}
											<Button
												variant="ghost"
												size="sm"
												aria-label="Edit {e.name}"
												onclick={() => openEdit(e)}
											>
												<Pencil size={ICON.sm} />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												aria-label="Duplicate {e.name}"
												onclick={() => openDuplicate(e)}
											>
												<Copy size={ICON.sm} />
											</Button>
										{/if}
										<form method="POST" action="?/delete" use:enhance={removeExperiment(e)}>
											<input type="hidden" name="id" value={e.id} />
											<Button
												variant="ghost"
												size="sm"
												type="submit"
												aria-label="Delete {e.name}"
											>
												<Trash2 size={ICON.sm} class="text-danger" />
											</Button>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.experiments.length}
					total={data.total ?? undefined}
					hasNext={data.hasMore}
					noun="experiments"
					href={pageHref('/admin/experiments', data.limit)}
				/>
			{/if}
		{/if}
	{/if}
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New experiment'}>
	<form
		id="experiment-form"
		method="POST"
		action={editing ? '?/update' : '?/create'}
		use:enhance={saveExperimentSubmit.enhance}
	>
		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
		{/if}

		<div class="flex flex-col gap-4">
			<FormErrors message={saveFailure} />
			<Input id="exp-name" name="name" label="Name" bind:value={name} required />
			<Textarea
				id="exp-description"
				name="description"
				label="What it is testing"
				hint="Write the question this experiment answers, for whoever reads the result later."
				rows={3}
				bind:value={description}
			/>
			<Input
				id="exp-threshold"
				name="significance_threshold"
				label="Confidence level"
				hint="How sure a result has to be before it counts, from 0.5 to 0.999. 0.95 is the usual choice and means a p-value below 0.05."
				bind:value={threshold}
			/>
			<Input
				id="exp-min-sample"
				name="min_sample_size"
				label="Minimum exposures"
				hint="Total exposures across all variants. Below this, no result counts as significant, whatever the p-value says."
				bind:value={minSample}
			/>
			<!-- Toggle renders a button, which submits nothing, and the action
			     reads an absent field as off. -->
			<input type="hidden" name="auto_stop_enabled" value={autoStop ? 'true' : 'false'} />
			<Toggle
				id="exp-auto-stop"
				label="Stop automatically once significant"
				hint="When on, the experiment stops as soon as the confidence level is met."
				bind:checked={autoStop}
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="experiment-form" loading={saveExperimentSubmit.pending}>
			{editing ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>
