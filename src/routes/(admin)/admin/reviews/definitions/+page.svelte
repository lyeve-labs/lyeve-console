<script lang="ts">
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { Alert, Badge, Button, EmptyState, PageShell, SectionHeading, Table } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ReviewTabs from '$lib/components/ReviewTabs.svelte';
	import { ClipboardCheck, Plus, Trash2 } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';
	import { confirmed, fieldErrors } from '$lib/forms.svelte';
	import { approvalsNeeded, conditionText, type ReviewStage } from '$lib/api/review';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { formRefusal, type Refusal } from '$lib/api/refusal';
	import { NO_VALUE, plural } from '$lib/format';
	import { couldNotLoad } from '$lib/outage';
	import { shortId } from '$lib/utils/entry-identity';
	import { ICON } from '$lib/icon';
	import DefinitionDrawer from './DefinitionDrawer.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let definitionRows = $derived(data.definitions.ok ? data.definitions.value : []);

	/** The account's email, or its short id when the page could not read one. */
	function personName(userId: string): string {
		if (!userId || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(userId)) return 'Nobody';
		return data.people[userId] ?? shortId(userId);
	}

	function hours(seconds: number): string {
		return seconds > 0 ? `${Math.round((seconds / 3600) * 10) / 10}h` : NO_VALUE;
	}

	// What the definitions read says this install allows. The ceiling and the
	// count are the plugin's, so a lifted ceiling never reads as a stale one.
	let limits = $derived(data.limits);
	let workflows = $derived(limits?.workflows ?? null);
	let atCeiling = $derived(!!workflows && workflows.limit !== null && workflows.current >= workflows.limit);
	let ceilingRefusal = $derived<Refusal | null>(
		atCeiling && workflows
			? { kind: 'cap', cap: 'review.workflows', limit: workflows.limit, current: workflows.current, upgradeUrl: '' }
			: null,
	);
	// The paid stage settings. False closes them, null (a plugin that does
	// not say) leaves them open and a refused create says why.
	let stagesLocked = $derived(limits?.licensed === false);
	let refused = $derived(formRefusal(form));
	let formError = $derived(form && 'error' in form && form.error ? String(form.error) : undefined);
	// The New definition drawer shows only a failed create. A failed delete
	// stays on the page, so the next drawer never opens with it.
	let createFailed = $derived(form && 'action' in form && form.action === 'create');

	function stageNotes(stage: ReviewStage): string[] {
		const notes: string[] = [];
		if (approvalsNeeded(stage) > 1) notes.push(`${approvalsNeeded(stage)} approvals`);
		if (stage.escalate_to_role) notes.push(`escalates to ${stage.escalate_to_role}`);
		else if (stage.escalate_to_user_id) notes.push(`escalates to ${personName(stage.escalate_to_user_id)}`);
		if (stage.condition) notes.push(`when ${conditionText(stage.condition)}`);
		return notes;
	}

	let open = $state(false);
	let drawer = $state<ReturnType<typeof DefinitionDrawer>>();
	const openCreate = () => drawer?.start();
	let errors = $derived(fieldErrors(form));

	function deleteDefinition(name: string) {
		return confirmed(`Delete ${name}?`, 'Its assignments, their history and their comments go with it.', {
			confirmLabel: 'Delete',
			success: `${name} deleted.`,
		});
	}
</script>

<PageShell
	title="Reviews"
	documentTitle="Definitions - Reviews"
	description="Define the review stages content moves through."
	width="wide"
>
	{#snippet actions()}
		<Badge tone="violet" size="sm">Beta</Badge>
		{#if data.definitions.ok}
			<Button variant="primary" size="sm" onclick={openCreate} disabled={atCeiling}>
				<Plus size={ICON.sm} />
				New definition
			</Button>
		{/if}
	{/snippet}

	{#if (!open || !createFailed) && (formError || refused)}
		<FormErrors message={formError} {refused} />
	{:else if form && 'created' in form && form.created}
		<Alert tone="success" autoDismiss>Definition created.</Alert>
	{:else if form && 'deleted' in form && form.deleted}
		<Alert tone="success" autoDismiss>Definition deleted.</Alert>
	{/if}

	<ReviewTabs active="definitions" operator />

	<section class="flex flex-col gap-4" aria-label="Definitions">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<SectionHeading level={2}>Definitions</SectionHeading>
			{#if workflows && workflows.limit !== null}
				<span class="text-xs text-muted" data-testid="workflow-count">
					{workflows.current} of {workflows.limit}
					{plural(workflows.limit, 'workflow')}
				</span>
			{/if}
		</div>
		{#if ceilingRefusal}
			<RefusalNotice refusal={ceilingRefusal} />
		{/if}
		{#if !data.definitions.ok}
			<GateNotice
				gate={data.definitions.gate}
				title="Review definitions"
				absent="Review definitions are not included in this build."
			/>
		{:else if definitionRows.length === 0}
			<EmptyState
				title="No definitions yet"
				description="Create a definition to send content through review stages, each with a required role and an SLA."
			>
				{#snippet iconSnippet()}<ClipboardCheck size={ICON.lg} />{/snippet}
				{#snippet action()}
					<Button variant="secondary" onclick={openCreate}>
						<Plus size={ICON.sm} />
						New definition
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Review definitions">
				<thead>
					<tr>
						<th scope="col">Name</th>
						<th scope="col">Content type</th>
						<th scope="col">Stages</th>
						<th scope="col">On approval</th>
						<th scope="col" class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each definitionRows as row (row.definition.id)}
						<tr data-testid="definition-row">
							<td data-cell="nowrap">
								<span class="font-medium text-fg">{row.definition.name}</span>
								<span class="ml-2 font-mono text-xs text-faint">{row.definition.slug}</span>
							</td>
							<td data-cell="nowrap" class="font-mono text-xs">{row.definition.content_schema || 'default'}</td>
							<td>
								{#if row.stages === null}
									<span class="text-xs text-warn">{couldNotLoad('stages', { reload: true })}</span>
								{:else}
								<ol class="flex flex-wrap items-center gap-1.5">
									{#each row.stages as stage, i (stage.id)}
										<li class="flex items-center gap-1 whitespace-nowrap text-xs" data-testid="stage-chip">
											<span class="text-faint">{i + 1}.</span>
											<span class="text-fg">{stage.name}</span>
											{#if stage.required_role}
												<Badge tone="neutral" size="sm">{stage.required_role}</Badge>
											{/if}
											<span class="text-faint">{hours(stage.sla_duration_seconds)}</span>
											{#each stageNotes(stage) as note (note)}
												<Badge tone="violet" size="sm">{note}</Badge>
											{/each}
										</li>
									{/each}
								</ol>
								{/if}
							</td>
							<td data-cell="nowrap">
								<Badge tone={row.definition.publish_on_approve ? 'success' : 'neutral'}>
									{row.definition.publish_on_approve ? 'Publishes' : 'No change'}
								</Badge>
							</td>
							<td data-cell="nowrap" class="text-right">
								<form method="POST" action="?/delete" use:enhance={deleteDefinition(row.definition.name)}>
									<input type="hidden" name="id" value={row.definition.id} />
									<Button
										variant="ghost"
										size="sm"
										type="submit"
										title="Delete"
										aria-label="Delete {row.definition.name}"
									>
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
	</section>
</PageShell>

<DefinitionDrawer
	bind:this={drawer}
	bind:open
	schemas={data.schemas}
	people={data.people}
	{stagesLocked}
	error={createFailed ? formError : undefined}
	refused={createFailed ? refused : null}
	fields={errors}
/>
