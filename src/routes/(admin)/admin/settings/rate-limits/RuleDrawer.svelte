<script lang="ts">
	import { Autocomplete, Button, Drawer, Input, RadioGroup, Toggle, toast } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { tracked } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { duplicateRow } from '$lib/duplicate';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import type { KeyBy, RateRule } from '$lib/api/rate-limit';
	import type { RouteOption } from '$lib/api/route-options';

	interface Props {
		/** A failure of this drawer's own save that came back after it opened. */
		error: string;
		/** The routes the instance serves, to pick the endpoint from. */
		routes: RouteOption[];
		/** Only a super admin names the tenant a rule applies to. */
		superAdmin: boolean;
	}

	let { error, routes, superAdmin }: Props = $props();

	// Each way of counting needs its sentence, so the choice is a radio group
	// that shows both rather than a list that hides one.
	const KEY_OPTIONS = [
		{ value: 'ip', label: 'Per address', description: 'Each address a request comes from has a budget of its own.' },
		{
			value: 'user',
			label: 'Per signed-in account',
			description:
				'One budget across every address an account calls from. A caller who is not signed in is counted by address.',
		},
	];

	let open = $state(false);
	let editing = $state<RateRule | null>(null);

	let endpoint = $state('*');
	let tenantId = $state('');
	let rate = $state('10');
	let burst = $state('20');
	let role = $state('');
	let keyBy = $state<KeyBy>('ip');
	let enabled = $state(true);

	export function openCreate() {
		editing = null;
		endpoint = '*';
		tenantId = '';
		rate = '10';
		burst = '20';
		role = '';
		keyBy = 'ip';
		enabled = true;
		open = true;
	}

	export function openEdit(r: RateRule) {
		editing = r;
		endpoint = r.endpoint;
		tenantId = r.tenant_id ?? '';
		rate = String(r.rate);
		burst = String(r.burst);
		role = r.role ?? '';
		keyBy = r.key_by ?? 'ip';
		enabled = r.enabled;
		open = true;
	}

	/**
	 * Copy a rule into the create drawer.
	 *
	 * No endpoint is involved: the row is already on screen, so this is the
	 * create form with its fields filled in. The shared helper is what keeps
	 * the four rules that matter, and the one that matters here is that the
	 * copy arrives switched off. A duplicated rate limit that starts enforcing
	 * the moment it saves is a surprise nobody asked for, and the operator has
	 * not yet changed the one field they pressed Duplicate to change.
	 *
	 * The endpoint stands in for the name, because that is what identifies a
	 * rule in this list and what a second rule has to differ in. `taken` holds
	 * the endpoints already listed.
	 */
	export function openDuplicate(r: RateRule, taken: string[]) {
		const draft = duplicateRow(r as unknown as Record<string, unknown>, {
			nameField: 'endpoint',
			taken,
		});
		editing = null;
		endpoint = String(draft.endpoint ?? r.endpoint);
		tenantId = String(draft.tenant_id ?? '');
		rate = String(r.rate);
		burst = String(r.burst);
		role = String(draft.role ?? '');
		// The copy keeps how the original counted callers, which is part of
		// the shape somebody pressed Duplicate for.
		keyBy = r.key_by ?? 'ip';
		enabled = false;
		open = true;
	}

	const saveRule: SubmitFunction = () => {
		const subject = endpoint;
		const verb = editing ? 'Saved' : 'Created';
		return async ({ result, update }) => {
			if (result.type !== 'failure') open = false;
			await update();
			if (result.type === 'success') toast.success(`${verb} ${subject}`);
		};
	};

	const saveRuleSubmit = tracked(saveRule);
</script>

<Drawer bind:open title={editing ? 'Edit rule' : 'New rule'}>
	<form
		id="rate-rule-form"
		method="POST"
		action={editing ? '?/update' : '?/create'}
		use:enhance={saveRuleSubmit.enhance}
	>
		<div class="flex flex-col gap-4">
			<FormErrors message={error || undefined} />
			{#if editing}
				<input type="hidden" name="id" value={editing.id} />
			{/if}
			<Autocomplete
				id="rl-route"
				label="Choose a route"
				hint="Choose from every route on this engine, including plugin routes such as the realtime stream and GraphQL, and your flow URLs. Your choice fills in the endpoint below."
				placeholder="Search by path, method or name"
				options={routes}
				onchange={(v) => {
					if (v) endpoint = v;
				}}
			/>
			<Input
				id="rl-endpoint"
				name="endpoint"
				label="Endpoint"
				hint="* for every request, or a method and a path. A segment may be {'{name}'}, and the last may be * for everything below it."
				bind:value={endpoint}
				required
			/>
			{#if superAdmin}
				<!-- On an edit the plugin reads an absent tenant as "keep", so a rule
				     can move to another tenant but not to every tenant. -->
				<Input
					id="rl-tenant"
					name="tenant_id"
					label="Tenant"
					hint={!editing
						? 'Leave empty to apply the rule to every tenant.'
						: editing.tenant_id
							? 'Enter another tenant to move the rule there. To apply it to every tenant, delete it and create it again.'
							: 'Leave empty to keep the rule on every tenant, or name a tenant to move it there.'}
					placeholder={editing && !editing.tenant_id ? 'Every tenant' : undefined}
					required={!!editing?.tenant_id}
					bind:value={tenantId}
				/>
			{/if}
			<Input
				id="rl-role"
				name="role"
				label="Role"
				hint="Leave empty for every caller. anonymous matches callers who are not signed in."
				bind:value={role}
			/>
			<RadioGroup label="Count" name="key_by" bind:value={keyBy} options={KEY_OPTIONS} />
			<div class="grid gap-4 sm:grid-cols-2">
				<Input
					id="rl-rate"
					name="rate"
					label="Requests per second"
					hint="The sustained rate, which is how fast the allowance refills."
					bind:value={rate}
				/>
				<Input
					id="rl-burst"
					name="burst"
					label="Burst"
					hint="How many requests can arrive at once. At least one."
					bind:value={burst}
				/>
			</div>
			<!-- Toggle renders a button, which submits nothing, and the action
			     reads an absent field as off. -->
			<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
			<Toggle id="rl-enabled" label="Enforce this rule" bind:checked={enabled} />
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="rate-rule-form" loading={saveRuleSubmit.pending}>
			{editing ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>
