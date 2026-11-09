<script lang="ts">
	/**
	 * The New definition drawer: a name, the schema it reviews, the publish
	 * switch and an ordered list of stages serialized into one hidden field.
	 * The page opens it through start(), which clears what the last one typed.
	 */
	import {
		Button,
		Card,
		Drawer,
		Input,
		NumberInput,
		Panel,
		SectionHeading,
		SegmentedControl,
		Select,
		Toggle,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { ArrowDown, ArrowUp, Plus, X } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import { submitter } from '$lib/forms.svelte';
	import type { Section } from '$lib/api/gate';
	import type { Refusal } from '$lib/api/refusal';
	import { couldNotLoad } from '$lib/outage';
	import { shortId } from '$lib/utils/entry-identity';
	import { ICON } from '$lib/icon';

	interface Props {
		open?: boolean;
		/** The schemas a definition can review, or the gate of a read that failed. */
		schemas: Section<string[]>;
		/** Each account's email by its id, for the escalation picker. */
		people: Record<string, string>;
		/** Whether the install refuses the paid stage settings. */
		stagesLocked: boolean;
		/** A failed create's message. */
		error?: string;
		/** A failed create's refusal. */
		refused?: Refusal | null;
		/** A failed create's message for each field it names. */
		fields?: Record<string, string>;
	}

	let {
		open = $bindable(false),
		schemas,
		people,
		stagesLocked,
		error = undefined,
		refused = null,
		fields = {},
	}: Props = $props();

	const submit = submitter(() => (open = false));

	const ESCALATE = [
		{ value: 'none', label: 'Nobody' },
		{ value: 'user', label: 'A user' },
		{ value: 'role', label: 'A role' },
	];
	const OPS = [
		{ value: 'equals', label: 'Is' },
		{ value: 'not_equals', label: 'Is not' },
		{ value: 'in', label: 'One of' },
		{ value: 'exists', label: 'Is set' },
	];

	type StageRow = {
		key: number;
		name: string;
		required_role: string;
		sla_hours: number;
		quorum: number;
		escalate_kind: string;
		escalate_to: string;
		condition_field: string;
		condition_op: string;
		condition_value: string;
	};
	let name = $state('');
	let slug = $state('');
	let contentSchema = $state<string | null>('');
	let publishOnApprove = $state(true);
	let nextKey = 1;
	let stages = $state<StageRow[]>([blankStage()]);

	function blankStage(): StageRow {
		return {
			key: nextKey++,
			name: '',
			required_role: '',
			sla_hours: 0,
			quorum: 1,
			escalate_kind: 'none',
			escalate_to: '',
			condition_field: '',
			condition_op: 'equals',
			condition_value: '',
		};
	}

	let schemaNames = $derived(schemas.ok ? schemas.value : []);

	/** Opens the drawer on a new definition with one empty stage. */
	export function start() {
		name = '';
		slug = '';
		contentSchema = schemaNames[0] ?? '';
		publishOnApprove = true;
		stages = [blankStage()];
		open = true;
	}

	function move(index: number, by: -1 | 1) {
		const to = index + by;
		if (to < 0 || to >= stages.length) return;
		const next = [...stages];
		[next[index], next[to]] = [next[to], next[index]];
		stages = next;
	}

	let stagesJSON = $derived(
		JSON.stringify(
			stages.map((s) => ({
				name: s.name,
				required_role: s.required_role,
				sla_duration_seconds: Math.round(s.sla_hours * 3600),
				quorum: s.quorum,
				escalate_kind: s.escalate_kind,
				escalate_to: s.escalate_to,
				condition_field: s.condition_field,
				condition_op: s.condition_op,
				condition_value: s.condition_value,
			})),
		),
	);
	let schemaOptions = $derived(schemaNames.map((s) => ({ value: s, label: s })));

	// The accounts an escalation can go to, by email. A stage saved with an
	// account the directory no longer lists keeps it as an option, so the field
	// still shows what the stage holds.
	let peopleOptions = $derived(
		Object.entries(people)
			.map(([id, email]) => ({ value: id, label: email }))
			.sort((a, b) => a.label.localeCompare(b.label)),
	);
	function escalateOptions(current: string) {
		if (!current || peopleOptions.some((o) => o.value === current)) return peopleOptions;
		return [...peopleOptions, { value: current, label: shortId(current) }];
	}
</script>

<Drawer bind:open title="New definition">
	<form
		method="POST"
		action="?/create"
		id="definition-form"
		use:enhance={submit.enhance}
		class="flex flex-col gap-4"
	>
		<FormErrors message={error} {refused} />
		<input type="hidden" name="stages" value={stagesJSON} />
		<input type="hidden" name="publish_on_approve" value={publishOnApprove ? 'true' : 'false'} />
		<Input
			id="definition-name"
			name="name"
			label="Name"
			required
			bind:value={name}
			placeholder="Editorial review"
			error={fields.name}
		/>
		<Input
			id="definition-slug"
			name="slug"
			label="Slug"
			hint="Permission rules refer to this definition as review:<slug>. If you leave it empty, it is made from the name. It cannot be changed later."
			bind:value={slug}
			class="font-mono"
			autocomplete="off"
		/>
		{#if schemaOptions.length > 0}
			<Select
				id="definition-schema"
				name="content_schema"
				label="Content type"
				hint="The content type whose entries this definition reviews. Approval publishes the row there."
				options={schemaOptions}
				searchable
				bind:value={contentSchema}
			/>
		{:else}
			<Input
				id="definition-schema"
				name="content_schema"
				label="Content type"
				hint={schemas.ok
					? 'The content type whose entries this definition reviews.'
					: `${couldNotLoad('content types')} Type the name of the content type whose entries this definition reviews.`}
				value={contentSchema ?? ''}
				oninput={(e) => (contentSchema = (e.currentTarget as HTMLInputElement).value)}
				class="font-mono"
			/>
		{/if}
		<Toggle
			id="definition-publish"
			label="Publish on approval"
			hint="The last approval publishes the entry. When off, the entry stays as it was and you publish it separately."
			bind:checked={publishOnApprove}
		/>

		<Card>
			<div class="flex flex-col gap-3">
				<SectionHeading level={3}>Stages, in order</SectionHeading>
				<ol class="flex flex-col gap-3" aria-label="Stages">
					{#each stages as stage, i (stage.key)}
						<li>
							<Panel pad="sm">
								<div class="flex flex-col gap-2">
									<!-- Beside the three stage buttons a phone left the name field
									     about 105px, which cut its placeholder. The field keeps a
									     minimum width beside its number, and the buttons wrap below
									     it as one group when the row is too narrow. -->
									<div class="flex flex-wrap items-center gap-2">
										<span class="text-xs text-faint">{i + 1}.</span>
										<div class="min-w-48 flex-1">
											<Input
												id="stage-name-{stage.key}"
												label="Stage name"
												required
												bind:value={stage.name}
												placeholder="Copy edit"
											/>
										</div>
										<div class="ms-auto flex gap-2">
											<Button
												type="button"
												variant="ghost"
												size="sm"
												aria-label="Move stage {i + 1} up"
												disabled={i === 0}
												onclick={() => move(i, -1)}
											>
												<ArrowUp size={ICON.sm} />
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												aria-label="Move stage {i + 1} down"
												disabled={i === stages.length - 1}
												onclick={() => move(i, 1)}
											>
												<ArrowDown size={ICON.sm} />
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												aria-label="Remove stage {i + 1}"
												disabled={stages.length === 1}
												onclick={() => (stages = stages.filter((s) => s.key !== stage.key))}
											>
												<X size={ICON.sm} />
											</Button>
										</div>
									</div>
									<div class="grid gap-2 sm:grid-cols-2">
										<Input
											id="stage-role-{stage.key}"
											label="Required role"
											hint="Leave empty to allow anyone the permission rules allow. An administrator can always act."
											bind:value={stage.required_role}
											placeholder="editor"
											mono
										/>
										<NumberInput
											id="stage-sla-{stage.key}"
											label="SLA, hours"
											hint="0 for none, up to 240."
											min={0}
											max={240}
											step={1}
											bind:value={stage.sla_hours}
										/>
									</div>
									<div class="flex flex-col gap-3 border-t border-line pt-3" data-testid="stage-paid-settings">
										{#if stagesLocked}
											<NotEnabled compact title="Quorum, escalation and conditions" />
										{/if}
										<NumberInput
											id="stage-quorum-{stage.key}"
											label="Approvals needed"
											hint="1 needs a single approval. A higher number needs that many assignees to approve."
											min={1}
											max={100}
											step={1}
											disabled={stagesLocked}
											bind:value={stage.quorum}
										/>
										<SegmentedControl
											label="Escalate to"
											options={ESCALATE}
											disabled={stagesLocked || stage.sla_hours === 0}
											bind:value={stage.escalate_kind}
										/>
										{#if stage.escalate_kind === 'user' && peopleOptions.length > 0}
											<Select
												id="stage-escalate-{stage.key}"
												label="User"
												hint="The user becomes the assignee when the SLA passes."
												placeholder="Choose a user"
												options={escalateOptions(stage.escalate_to)}
												searchable
												disabled={stagesLocked}
												bind:value={stage.escalate_to}
											/>
										{:else if stage.escalate_kind !== 'none'}
											<Input
												id="stage-escalate-{stage.key}"
												label={stage.escalate_kind === 'user' ? 'User id' : 'Role'}
												hint={stage.escalate_kind === 'user'
													? 'The user becomes the assignee when the SLA passes.'
													: 'Anyone with this role can act on the stage once the SLA passes.'}
												disabled={stagesLocked}
												bind:value={stage.escalate_to}
												mono
											/>
										{/if}
										<div class="grid gap-2 sm:grid-cols-2">
											<Input
												id="stage-condition-field-{stage.key}"
												label="Condition field"
												hint="Leave empty to run the stage for every entry."
												disabled={stagesLocked}
												bind:value={stage.condition_field}
												placeholder="category"
												mono
											/>
											{#if stage.condition_field.trim()}
												<SegmentedControl
													label="Compares"
													options={OPS}
													disabled={stagesLocked}
													bind:value={stage.condition_op}
												/>
											{/if}
										</div>
										{#if stage.condition_field.trim() && stage.condition_op !== 'exists'}
											<Input
												id="stage-condition-value-{stage.key}"
												label={stage.condition_op === 'in' ? 'Values' : 'Value'}
												hint={stage.condition_op === 'in' ? 'One per comma, up to 100.' : 'A text, a number, or true or false.'}
												disabled={stagesLocked}
												bind:value={stage.condition_value}
											/>
										{/if}
									</div>
								</div>
							</Panel>
						</li>
					{/each}
				</ol>
				<div>
					<Button type="button" variant="secondary" size="sm" onclick={() => (stages = [...stages, blankStage()])}>
						<Plus size={ICON.sm} /> New stage
					</Button>
				</div>
			</div>
		</Card>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="definition-form" loading={submit.pending}>Create</Button>
	{/snippet}
</Drawer>
