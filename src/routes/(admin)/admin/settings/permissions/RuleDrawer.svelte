<script lang="ts">
	import { Alert, Autocomplete, Button, CheckboxGroup, Drawer, Input } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { Permission } from '@lyeve-labs/client';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import type { Refusal } from '$lib/api/refusal';
	import { tracked } from '$lib/forms.svelte';
	import {
		ACTIONS,
		ACTION_LABEL,
		EXEMPT_ROLE,
		applies,
		parentLabel,
		schemaLabel,
		type RuleMatrix,
	} from './rules.svelte';

	/**
	 * The rule editor, a drawer over the matrix. The page opens it through
	 * `edit`, because the page decides which failure is old at the moment it
	 * opens. A null schema means the resource is still to be chosen.
	 */
	let {
		rules,
		open = $bindable(false),
		flowsFailed = false,
		error = undefined,
		refused = null,
		ondelete,
	}: {
		rules: RuleMatrix;
		open?: boolean;
		/** The flows did not answer, so a new rule can name only a schema. */
		flowsFailed?: boolean;
		/** A failed save, already filtered by the page to this drawer and to after it opened. */
		error?: string;
		refused?: Refusal | null;
		/** Delete asks through the page, which owns the confirmation and the hidden delete form. */
		ondelete: (perm: Permission) => void;
	} = $props();

	let ruleTarget = $state<{ role: string; schema: string | null } | null>(null);
	let editActions = $state<string[]>([]);
	let editFieldMask = $state('');
	let editSchema = $state('');

	/** Open the drawer on a role's rule for a resource, or on a new resource for null. */
	export function edit(role: string, schema: string | null) {
		const perm = schema ? rules.rule(role, schema) : undefined;
		// A new rule starts from what applies now, its parent's actions,
		// because saving it replaces them on this resource.
		editActions = perm ? [...perm.actions] : schema ? [...rules.inheritedActions(role, schema)] : [];
		editFieldMask = perm ? perm.field_mask.join(', ') : '';
		editSchema = '';
		ruleTarget = { role, schema };
		open = true;
	}

	/**
	 * Returning a callback replaces SvelteKit's own handling, so this one calls
	 * update() itself. Without it load never reruns: the drawer closes over a
	 * table still showing the rule the save replaced, and a failed save closes
	 * the drawer and reports nothing.
	 */
	const saveRule = tracked(() => async ({ result, update }) => {
		if (result.type !== 'failure') open = false;
		await update({ reset: false });
	});
</script>

{#if ruleTarget}
	{@const role = ruleTarget.role}
	{@const schema = ruleTarget.schema}
	{@const stored = schema ? rules.rule(role, schema) : undefined}
	{@const resource = schema ?? editSchema}
	{@const inherited = rules.inheritedActions(role, resource)}
	{@const noGrant = editActions.length === 0 && editFieldMask.trim() === ''}
	{@const emptyWrite = noGrant && !rules.replacesAGrant(role, resource)}
	<Drawer
		bind:open
		title="Rule for {role} on {schema === null ? 'a new resource' : schemaLabel(schema)}"
	>
		<form
			method="POST"
			action="?/upsert"
			id="rule-form"
			use:enhance={saveRule.enhance}
			class="space-y-4"
		>
			<!-- A refused save keeps the drawer open, so the reason has to be in
			     it and not behind the panel on the page. -->
			<FormErrors message={error} {refused} />
			<input type="hidden" name="drawer" value="rule" />
			<input type="hidden" name="role" value={role} />

			{#if schema === null}
				{#if flowsFailed}
					<Alert tone="warn">Could not load flows, so only content types are listed. Reload the page to try again.</Alert>
				{/if}
				<!-- The combobox posts whatever text is in its box, so the write reads
				     the chosen option instead. A typed fragment nobody picked would
				     otherwise create a rule for a schema that does not exist. -->
				<Autocomplete
					label="Resource"
					bind:value={editSchema}
					options={rules.unruledSchemas(role)}
					placeholder="Search content types and flows"
					required
				/>
				<input type="hidden" name="schema_name" value={editSchema} />
			{:else}
				<input type="hidden" name="schema_name" value={schema} />
			{/if}

			{#if resource !== '' && inherited.length > 0}
				<Alert tone="warn" title="This rule replaces the {parentLabel(resource)} on {schemaLabel(resource)}">
					{#snippet children()}
						The {parentLabel(resource)} grants {role} {inherited.join(', ')}. On {schemaLabel(resource)} only this
						rule applies, so any action you leave clear is denied there.
					{/snippet}
				</Alert>
			{/if}

			<!-- The kit's group, not a hand-rolled fieldset: a bare m-0 there outranks
			     the form's space-y-4 and sets "Field mask" on the boxes. -->
			<CheckboxGroup
				name="actions"
				label="Actions allowed for {role} on {schema === null ? 'the chosen resource' : schemaLabel(schema)}"
				orientation="horizontal"
				options={ACTIONS.filter((action) => applies(action, resource)).map((action) => ({
					value: action,
					label: ACTION_LABEL[action],
					description:
						inherited.includes(action)
							? `The ${parentLabel(resource)} grants it. If you leave it clear, it is denied here.`
							: undefined
				}))}
				bind:value={editActions}
				disabled={role === EXEMPT_ROLE}
			/>

			<Input
				id="field-mask"
				label="Field mask"
				name="field_mask"
				bind:value={editFieldMask}
				placeholder="secret_token, internal_notes"
				hint="Comma-separated field names, removed from read responses for this role."
			/>

			{#if emptyWrite}
				<Alert tone="warn" title="This rule would do nothing">
					{#snippet children()}
						A rule with no action and no field mask changes nothing here, but it still counts against the
						role ceiling.
					{/snippet}
				</Alert>
			{:else if noGrant}
				<Alert tone="warn" title="This rule blocks {role}">
					{#snippet children()}
						With no action selected, {role} is denied every action on {schemaLabel(resource)}.
					{/snippet}
				</Alert>
			{/if}
		</form>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
			{#if stored && emptyWrite}
				<Button
					variant="danger"
					onclick={() => {
						open = false;
						ondelete(stored);
					}}
				>
					Delete
				</Button>
			{:else}
				<Button
					variant="primary"
					type="submit"
					form="rule-form"
					disabled={emptyWrite || role === EXEMPT_ROLE || (schema === null && editSchema === '')} loading={saveRule.pending}>
					{stored ? 'Save' : 'Create'}
				</Button>
			{/if}
		{/snippet}
	</Drawer>
{/if}
