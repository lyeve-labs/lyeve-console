<script lang="ts">
	import { Alert, Badge, Button, Card, Input, MultiSelect, SectionHeading, Select, Textarea, type StatusTone } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { Check, Eye, EyeOff, RotateCcw, X } from '@lucide/svelte';
	import {
		actionsFor,
		type ReviewAssignment,
		type ReviewDefinition,
		type ReviewStatus,
		type StageSLA,
		type TransitionAction,
	} from '$lib/api/review';
	import { formatDateTime } from '$lib/format';
	import { shortId } from '$lib/utils/entry-identity';
	import { ICON } from '$lib/icon';
	import { couldNotLoad } from '$lib/outage';

	let {
		entryId,
		assignment,
		stages,
		definitions = [],
		approvalsNeeded = 1,
		userId = '',
		people = [],
		unavailable = false,
		forbidden = false,
		definitionsFailed = false,
		error = null,
		errorStatus = 0,
	}: {
		entryId: string;
		/** The entry's latest assignment, null when it is under no review. */
		assignment: ReviewAssignment | null;
		/** Every stage of the assignment's definition, with its timing. */
		stages: StageSLA[];
		/** What a review can be started through. Empty for a caller who may not list them. */
		definitions?: ReviewDefinition[];
		/** Approvals the current stage needs before it moves. Above 1 is a quorum stage. */
		approvalsNeeded?: number;
		/** The signed-in user, so the assignee reads as "you" when it is. */
		userId?: string;
		/**
		 * The accounts a review can be handed to, by email. Empty for a caller
		 * who may not list them, who types the ids instead.
		 */
		people?: { id: string; email: string }[];
		/** The plugin is compiled in and did not answer. */
		unavailable?: boolean;
		/** The engine refused to show this entry's review to the caller. */
		forbidden?: boolean;
		/** The definitions could not be read, so no review can be started from here. */
		definitionsFailed?: boolean;
		/** The last review action's refusal, as the engine worded it. */
		error?: string | null;
		/** The status the refusal came with. A 403 is named as a permission. */
		errorStatus?: number;
	} = $props();

	const STATUS_LABEL: Record<ReviewStatus, string> = {
		draft: 'Draft',
		pending_review: 'Pending review',
		in_review: 'In review',
		changes_requested: 'Changes requested',
		approved: 'Approved',
		rejected: 'Rejected',
		published: 'Published',
	};
	const STATUS_TONE: Record<ReviewStatus, StatusTone> = {
		draft: 'neutral',
		pending_review: 'brand',
		in_review: 'brand',
		changes_requested: 'warn',
		approved: 'success',
		rejected: 'danger',
		published: 'success',
	};
	const ACTION_LABEL: Record<TransitionAction, string> = {
		approve: 'Approve',
		reject: 'Reject',
		request_changes: 'Request changes',
		publish: 'Publish',
		unpublish: 'Unpublish',
	};

	let stageIndex = $derived(
		assignment ? stages.findIndex((s) => s.stage_id === assignment.current_stage_id) : -1,
	);
	let stageName = $derived(
		stageIndex >= 0 ? stages[stageIndex].stage_name : assignment ? shortId(assignment.current_stage_id) : '',
	);
	// The scheduled check marks an assignment overdue every five minutes. A due
	// time that has passed since is read here, so the bar does not wait for it.
	let overdue = $derived(
		!!assignment &&
			!isSettled(assignment.status) &&
			(assignment.overdue || (!!assignment.due_at && new Date(assignment.due_at).getTime() < Date.now())),
	);
	let actions = $derived(assignment ? actionsFor(assignment.status) : []);

	function isSettled(status: ReviewStatus): boolean {
		return status === 'approved' || status === 'published';
	}

	let emails = $derived(new Map(people.map((p) => [p.id, p.email])));

	function assignee(id: string): string {
		if (!id || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id)) return 'Nobody';
		return id === userId ? 'You' : (emails.get(id) ?? shortId(id));
	}

	let definitionOptions = $derived(
		definitions.map((d) => ({
			value: d.id,
			label: d.content_schema ? `${d.name} (${d.content_schema})` : d.name,
		})),
	);
	let definitionId = $state<string | null>(null);
	let assigneeId = $state('');
	$effect(() => {
		if (!assigneeId && userId && (people.length === 0 || emails.has(userId))) assigneeId = userId;
	});

	// The picker offers the accounts the page could read. The signed-in user
	// reads as themselves, so the default needs no lookup.
	let personOptions = $derived(
		people.map((p) => ({ value: p.id, label: p.id === userId ? `${p.email} (you)` : p.email })),
	);
	let otherIds = $state<string[]>([]);
	let otherOptions = $derived(personOptions.filter((o) => o.value !== assigneeId));

	// Every assignee, the primary first. A plugin that answers no list has one.
	let assignees = $derived(
		assignment ? (assignment.assignee_ids?.length ? assignment.assignee_ids : [assignment.assignee_id]) : [],
	);
	let quorum = $derived(approvalsNeeded > 1);
	let approvals = $derived(assignment?.approvals ?? []);
	let youApproved = $derived(!!userId && approvals.includes(userId));

	let comment = $state('');
	let submitting = $state<TransitionAction | 'start' | null>(null);
</script>

<Card>
	{#snippet header()}
		<SectionHeading level={3}>
			<span class="flex items-center gap-2">
				Review
				<Badge tone="violet" size="sm">Beta</Badge>
			</span>
		</SectionHeading>
	{/snippet}

	<div class="flex flex-col gap-4" data-testid="review-bar">
		{#if unavailable}
			<Alert tone="warn" title="Could not load the review">
				The review plugin is not running on this engine, so this review is not available.
			</Alert>
		{:else if forbidden}
			<Alert tone="warn" title="You cannot see this entry's review">
				Your roles have no read permission on reviews. Ask a super admin for a rule on
				<span class="font-mono">reviews</span> or on the definition's own resource.
			</Alert>
		{:else if !assignment}
			<p class="text-sm text-muted" data-testid="review-none">Not under review.</p>
			{#if definitions.length > 0}
				<form
					method="POST"
					action="?/reviewStart"
					use:enhance={() => {
						submitting = 'start';
						return async ({ update }) => {
							submitting = null;
							await update();
						};
					}}
					class="flex flex-col gap-3"
					aria-label="Start a review"
				>
					<input type="hidden" name="entry_id" value={entryId} />
					<div class="grid gap-3 md:grid-cols-2">
						<Select
							id="review-definition"
							name="definition_id"
							label="Definition"
							placeholder="Choose a definition"
							options={definitionOptions}
							searchable
							bind:value={definitionId}
							required
						/>
						{#if people.length > 0}
							<Select
								id="review-assignee"
								name="assignee_id"
								label="Assignee"
								hint="The first reviewer."
								placeholder="Choose a user"
								options={personOptions}
								searchable
								bind:value={assigneeId}
								required
							/>
						{:else}
							<Input
								id="review-assignee"
								name="assignee_id"
								label="Assignee"
								hint="The user id of the first reviewer."
								bind:value={assigneeId}
								autocomplete="off"
								required
								mono
							/>
						{/if}
					</div>
					{#if people.length > 0}
						{#each otherIds.filter((id) => id !== assigneeId) as id (id)}
							<input type="hidden" name="other_assignees" value={id} />
						{/each}
						<MultiSelect
							id="review-other-assignees"
							label="More assignees"
							hint="A stage that needs several approvals gets them from these assignees, so pick at least as many people as it needs."
							placeholder="Choose users"
							options={otherOptions}
							searchable
							bind:value={otherIds}
						/>
					{:else}
						<Textarea
							id="review-other-assignees"
							name="other_assignees"
							label="More assignees"
							hint="One user id per line. A stage that needs several approvals gets them from these assignees, so add at least as many people as it needs."
							rows={2}
						/>
					{/if}
					{#if error}
						<Alert tone="danger">{error}</Alert>
					{/if}
					<div>
						<Button type="submit" size="sm" loading={submitting === 'start'} disabled={!definitionId || !assigneeId}>
							Start review
						</Button>
					</div>
				</form>
			{:else if definitionsFailed}
				<p class="text-sm text-muted">{couldNotLoad('the review definitions', { reload: true })}</p>
			{:else if error}
				<Alert tone="danger">{error}</Alert>
			{/if}
		{:else}
			<dl class="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4" data-testid="review-facts">
				<div class="flex flex-col gap-1">
					<dt class="text-xs text-faint">Stage</dt>
					<dd class="text-fg" data-testid="review-stage">
						{#if stageIndex >= 0}
							<span class="text-muted">{stageIndex + 1} of {stages.length}:</span>
						{/if}
						{stageName}
					</dd>
				</div>
				<div class="flex flex-col gap-1">
					<dt class="text-xs text-faint">Status</dt>
					<dd>
						<Badge tone={STATUS_TONE[assignment.status]} dot>{STATUS_LABEL[assignment.status]}</Badge>
					</dd>
				</div>
				<div class="flex flex-col gap-1">
					<dt class="text-xs text-faint">{assignees.length > 1 ? 'Assignees' : 'Assignee'}</dt>
					<dd class="font-mono text-fg" data-testid="review-assignee">{assignees.map((id) => assignee(id)).join(', ')}</dd>
					{#if assignment.escalated_role}
						<dd data-testid="review-escalated">
							<Badge tone="warn" size="sm">Escalated to {assignment.escalated_role}</Badge>
						</dd>
					{/if}
				</div>
				<div class="flex flex-col gap-1">
					<dt class="text-xs text-faint">Due</dt>
					<dd class={overdue ? 'text-danger' : 'text-fg'} data-testid="review-due" data-overdue={overdue}>
						{#if assignment.due_at}
							{formatDateTime(assignment.due_at)}
							{#if overdue}
								<Badge tone="danger" size="sm">Overdue</Badge>
							{/if}
						{:else}
							<span class="text-faint">No SLA</span>
						{/if}
					</dd>
				</div>
			</dl>

			{#if quorum && !isSettled(assignment.status)}
				<!-- A quorum stage moves on the approval that makes its count, and
				     each assignee approves once per visit to the stage. -->
				<p class="text-sm text-muted" data-testid="review-approvals">
					<span class="font-medium text-fg">{approvals.length} of {approvalsNeeded} approvals</span>
					on this stage{#if approvals.length > 0}, from {approvals.map((id) => assignee(id)).join(', ')}{/if}.
					{#if youApproved}You have approved it.{/if}
				</p>
			{/if}

			{#if actions.length > 0}
				<form
					method="POST"
					action="?/reviewTransition"
					use:enhance={({ submitter }) => {
						const value = (submitter as HTMLButtonElement | null)?.value;
						submitting = actions.find((a) => a === value) ?? null;
						return async ({ update }) => {
							submitting = null;
							await update();
						};
					}}
					class="flex flex-col gap-3"
					aria-label="Move the review"
				>
					<input type="hidden" name="assignment_id" value={assignment.id} />
					<Textarea
						id="review-comment"
						name="comment"
						label="Comment"
						hint="Saved in the stage log and sent with the transition event."
						rows={2}
						bind:value={comment}
					/>
					{#if error}
						<Alert
							tone={errorStatus === 403 ? 'warn' : 'danger'}
							title={errorStatus === 403 ? 'Not allowed' : undefined}
						>
							{error}
						</Alert>
					{/if}
					<div class="flex flex-wrap gap-2" data-testid="review-actions">
						{#each actions as action (action)}
							<Button
								type="submit"
								name="action"
								value={action}
								size="sm"
								variant={action === 'approve' || action === 'publish' ? 'primary' : action === 'reject' ? 'danger' : 'secondary'}
								loading={submitting === action}
							>
								{#if action === 'approve'}
									<Check size={ICON.sm} />
								{:else if action === 'reject'}
									<X size={ICON.sm} />
								{:else if action === 'request_changes'}
									<RotateCcw size={ICON.sm} />
								{:else if action === 'publish'}
									<Eye size={ICON.sm} />
								{:else}
									<EyeOff size={ICON.sm} />
								{/if}
								{ACTION_LABEL[action]}
							</Button>
						{/each}
					</div>
				</form>
			{/if}
		{/if}
	</div>
</Card>
