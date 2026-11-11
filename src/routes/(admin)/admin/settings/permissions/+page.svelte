<script lang="ts">
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		Alert,
		Badge,
		Button,
		PageShell,
		EmptyState,
		SearchInput,
		SectionHeading,
		Table,
		Toggle,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { Asterisk, ChevronRight, Plus } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import type { PageData, ActionData } from './$types';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { Permission } from '@lyeve-labs/client';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { ALL_FLOWS, isFlowResource } from '$lib/flow/permissions';
	import { ICON } from '$lib/icon';
	import { drawerFailure } from '$lib/forms.svelte';
	import { plural } from '$lib/format';
	import FieldMaskCell from './FieldMaskCell.svelte';
	import MarkCell from './MarkCell.svelte';
	import RoleDrawer from './RoleDrawer.svelte';
	import RuleControls from './RuleControls.svelte';
	import RuleDrawer from './RuleDrawer.svelte';
	import RulesLegend from './RulesLegend.svelte';
	import SummaryCell from './SummaryCell.svelte';
	import {
		ACTIONS,
		ACTION_LABEL,
		EXEMPT_ROLE,
		RuleMatrix,
		WILDCARD,
		parentLabel,
		schemaLabel,
	} from './rules.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const refusal = $derived(formRefusal(form));

	// The rule drawer and the new role drawer each show their own failure, and
	// a failed delete shows above the matrix.
	type Failure = { error?: unknown; action?: string; roleCapReached?: boolean } | null;
	const failure = $derived(form as Failure);
	const failures = drawerFailure(() => form as Failure, ['rule', 'role']);
	const textOf = (f: Failure) => (typeof f?.error === 'string' ? f.error : undefined);
	const freshIn = (drawer: 'rule' | 'role') => (failures.drawer?.action === drawer ? failures.drawer : null);
	const pageRefusal = $derived(formRefusal(failures.page));
	const pageError = $derived(textOf(failures.page));

	// The matrix, its cells and the rule drawer read the rules through one
	// object, so the index over them is built once per load.
	const rules = new RuleMatrix(() => data);

	// Set when the read failed. An empty matrix and a failed read look the same
	// on this screen, so the table is withheld rather than drawn from nothing.
	const loadGate = $derived(data.loadGate ?? null);
	const loadError = $derived(loadGate !== null);

	// What the plugin counts against the ceiling: roles that have at least one
	// rule, as its limits read reports them. Without that read the count comes
	// from the rules on screen. The matrix's roles are wider, because they seed
	// the built-in names so the matrix has rows before anybody writes a rule,
	// and counting those would report a ceiling reached on an empty instance.
	const storedRoleCount = $derived(data.roleCount ?? new Set(data.permissions.map((p) => p.role)).size);

	// The ceiling comes from the plugin on every load. Nothing here holds a
	// number: a console that knew it would keep enforcing one the plugin had
	// lifted. 0 is unlimited.
	const roleCap = $derived<number>(data.roleCap ?? 0);
	const atRoleCap = $derived(roleCap > 0 && storedRoleCount >= roleCap);

	// A refusal at the ceiling carries the numbers the plugin checked. They
	// win over the load's, which are 0 and a guess when the limits read failed.
	const capRefusal = $derived(failure?.roleCapReached && refusal?.kind === 'cap' ? refusal : null);
	const refusedLimit = $derived(capRefusal?.limit ?? (roleCap > 0 ? roleCap : null));
	const refusedCount = $derived(capRefusal?.current ?? (roleCap > 0 ? storedRoleCount : null));

	let schemaFilter = $state('');
	let showUnruled = $state(false);
	const filterText = $derived(schemaFilter.trim().toLowerCase());

	/** Whether the filter, when there is one, leaves anything to look at. */
	const filterMatches = $derived(
		filterText === '' || rules.allRoles.some((role: string) => childRows(role).length > 0),
	);

	/**
	 * The child rows of a role: the schemas it holds a rule for, or every schema
	 * once the operator asks for the ones with none. The cross product of roles
	 * and schemas is not a model of anything: it is hundreds of rows of which a
	 * few carry a rule.
	 */
	function childRows(role: string): { schema: string; perm: Permission | undefined }[] {
		const names = showUnruled
			? (rules.roleSchemas[role] ?? [])
			: data.permissions
					.filter((p: Permission) => p.role === role && p.schema_name !== WILDCARD)
					.map((p: Permission) => p.schema_name)
					.sort((a: string, b: string) => a.localeCompare(b));
		return names
			.filter((name) => name.toLowerCase().includes(filterText))
			.map((schema) => ({ schema, perm: rules.rule(role, schema) }));
	}

	/**
	 * Which roles are open. A search opens the roles that match it, and a click
	 * overrides that until the search changes, so the disclosure a search opened
	 * can still be closed by hand.
	 */
	let opened = $state<{ filter: string; roles: Record<string, boolean> }>({
		filter: '',
		roles: {},
	});

	function isOpen(role: string): boolean {
		const override = opened.filter === filterText ? opened.roles[role] : undefined;
		if (override !== undefined) return override;
		if (filterText !== '') return childRows(role).length > 0;
		return rules.ruleCount(role) > 0;
	}

	function toggleRole(role: string) {
		const roles = opened.filter === filterText ? { ...opened.roles } : {};
		roles[role] = !isOpen(role);
		opened = { filter: filterText, roles };
	}

	// The rule drawer owns its fields. The page sets the old failure aside
	// first, so a drawer opened after a failure starts clean.
	let ruleDrawer = $state<RuleDrawer>();

	function openRule(role: string, schema: string | null) {
		failures.opened();
		ruleDrawer?.edit(role, schema);
	}

	// Removal goes through the kit's confirm dialog, then a hidden form, so
	// the row's button never posts on its own and the action stays a form
	// action. The message says what the parent rule grants once this one is
	// gone, because a removal can open as much as it closes.
	let deleteId = $state('');
	let deleteForm = $state<HTMLFormElement>();

	async function askDelete(target: Permission) {
		const inherited = rules.inheritedActions(target.role, target.schema_name);
		const where = schemaLabel(target.schema_name);
		let message = '';
		if (target.schema_name === WILDCARD) {
			message = 'Every content type falls back to its own rule, and any content type without one is denied.';
		} else if (target.schema_name === ALL_FLOWS) {
			message = 'Every flow falls back to its own rule, and any flow without one is denied.';
		} else if (inherited.length > 0) {
			message = `The ${parentLabel(target.schema_name)} for ${target.role} then applies to this ${isFlowResource(target.schema_name) ? 'flow' : 'content type'} and grants ${inherited.join(', ')}.`;
		}
		const ok = await confirmDialog(`Delete the rule for ${target.role} on ${where}?`, message, { confirmLabel: 'Delete' });
		if (!ok) return;
		deleteId = target.id;
		// The hidden field takes the id on the next render, and the form posts
		// what the field holds, so the submit waits for that render.
		await tick();
		deleteForm?.requestSubmit();
	}

	// The row and the drawer that asked for a removal are gone once it lands,
	// so focus would fall to the document body and the next Tab would start
	// from the top of the page. It goes to the filter above the rules instead.
	const afterDelete: SubmitFunction = () => async ({ result, update }) => {
		await update();
		if (result.type === 'success') document.getElementById('schema-filter')?.focus();
	};

	let roleOpen = $state(false);
	function openRole() {
		failures.opened();
		roleOpen = true;
	}
</script>

<PageShell
	title="Row-level permissions"
	description="Set what each role can do with each content type and flow."
	width="wide"
>
	{#snippet actions()}
		{#if !loadError && !atRoleCap}
			<Button variant="primary" size="sm" onclick={openRole}>
				<Plus size={ICON.sm} />
				New role
			</Button>
		{/if}
	{/snippet}

	{#if !loadError && atRoleCap && !failure?.roleCapReached}
		<Alert tone="info" title="{storedRoleCount} of {roleCap} roles">
			This engine's role ceiling is {roleCap}, so you cannot add another role. Your existing roles keep working.
		</Alert>
	{/if}

	{#if pageRefusal}
		<!-- New role is withdrawn in the same states, so the way forward is then
		     the one action on the page. -->
		<RefusalNotice refusal={pageRefusal} lead={loadError || atRoleCap} />
	{:else if failure?.roleCapReached}
		<Alert tone="warn" title="Role ceiling reached">
			{#snippet children()}
				{#if refusedLimit !== null && refusedCount !== null}
					The ceiling is {refusedLimit} roles and this engine has {refusedCount}.
				{:else if refusedLimit !== null}
					The ceiling is {refusedLimit} roles.
				{:else}
					This engine allows no more roles.
				{/if}
				Nothing was saved, and your existing roles keep working.
			{/snippet}
		</Alert>
	{:else if pageError}
		<Alert tone="danger" title="The change was not saved">
			{#snippet children()}{pageError}{/snippet}
		</Alert>
	{/if}

	{#if loadGate}
		<GateNotice
			level={2}
			gate={loadGate}
			title="Row-level permissions"
			absent="Row-level permissions are not included in this build."
		/>
	{:else}
		<!-- The explanatory card below renders its title as an h3, so without this
		     the page would go from its own title straight to a level three. -->
		<SectionHeading level={2}>Rules by role</SectionHeading>

		<div class="flex flex-col gap-3">
			<ListToolbar label="Filter rules">
				{#snippet search()}
					<label for="schema-filter" class="sr-only">Filter resources</label>
					<SearchInput id="schema-filter" bind:value={schemaFilter} placeholder="Content type or flow name" />
				{/snippet}
				{#snippet filters()}
					<Toggle
						id="show-unruled"
						bind:checked={showUnruled}
						label="Show resources with no rule"
						hint="Shows content types that use the wildcard rule and flows that use the All flows rule."
					/>
				{/snippet}
			</ListToolbar>

			{#if !filterMatches}
				<EmptyState
					title="No resources match this search"
					description="Clear the search, or turn on Show resources with no rule to include content types and flows without a rule of their own."
				/>
			{:else}
				<Table label="Rules by role">
					<thead>
						<tr>
							<th scope="col">Role and resource</th>
							{#each ACTIONS as action}
								<th scope="col" class="text-center">{ACTION_LABEL[action]}</th>
							{/each}
							<th scope="col">Field mask</th>
							<th scope="col"><span class="sr-only">Rule controls</span></th>
						</tr>
					</thead>

					{#each rules.allRoles as role (role)}
						{@const open = isOpen(role)}
						{@const rows = childRows(role)}
						{@const wildcard = rules.rule(role, WILDCARD)}
						<tbody>
							<tr class="bg-surface-2/30">
								<td data-cell="nowrap">
									<button
										type="button"
										class="relative -my-1 py-1 flex w-full items-center gap-2 hit-area text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
										aria-expanded={open}
										aria-controls="rules-{role}"
										onclick={() => toggleRole(role)}
									>
										<ChevronRight
											size={ICON.sm}
											class="shrink-0 text-faint transition-transform {open
												? 'rotate-90'
												: ''}"
										/>
										<span class="font-mono text-xs font-medium text-fg">{role}</span>
										{#if role === EXEMPT_ROLE}
											<Badge tone="violet">Exempt</Badge>
										{:else if rules.ruleCount(role) === 0}
											<Badge tone="warn">No rules</Badge>
										{:else}
											<Badge>{rules.ruleCount(role)} {plural(rules.ruleCount(role), 'rule')}</Badge>
										{/if}
									</button>
								</td>
								{#each ACTIONS as action}
									<td data-cell="nowrap" class="text-center"><SummaryCell {rules} {role} {action} /></td>
								{/each}
								<td></td>
								<td>
									<div class="flex justify-end">
										<Button
											variant="ghost"
											size="sm"
											disabled={role === EXEMPT_ROLE || rules.unruledSchemas(role).length === 0}
											aria-label="Add a content type rule for {role}"
											onclick={() => openRule(role, null)}
										>
											<Plus size={ICON.sm} />
										</Button>
									</div>
								</td>
							</tr>
						</tbody>

						<tbody id="rules-{role}">
							{#if open}
								<tr class="bg-brand/5">
									<td data-cell="nowrap">
										<span class="flex items-center gap-2 pl-6">
											<Asterisk size={ICON.sm} class="shrink-0 text-brand" />
											<span class="font-mono text-xs text-brand">*</span>
											<Badge tone="brand">Every content type</Badge>
										</span>
									</td>
									{#each ACTIONS as action}
										<td data-cell="nowrap" class="text-center"><MarkCell {rules} {role} schema={WILDCARD} {action} /></td>
									{/each}
									<td><FieldMaskCell {rules} {role} schema={WILDCARD} perm={wildcard} /></td>
									<td><RuleControls {role} schema={WILDCARD} perm={wildcard} onedit={openRule} ondelete={askDelete} /></td>
								</tr>

								{#each rows as row (row.schema)}
									<tr class={row.schema === ALL_FLOWS ? 'bg-brand/5' : ''}>
										<td data-cell="nowrap">
											<span class="flex items-center gap-2 pl-6">
												<span class="font-mono text-xs text-fg">{row.schema}</span>
												{#if row.schema === ALL_FLOWS}
													<Badge tone="brand">Every flow</Badge>
												{:else if isFlowResource(row.schema)}
													<Badge size="sm">flow</Badge>
												{/if}
											</span>
											{#if !row.perm}
												<span class="block pl-6 text-xs text-faint">no rule, denied</span>
											{:else if row.perm.actions.length === 0}
												<span class="block pl-6 text-xs text-faint">rule grants nothing</span>
											{/if}
										</td>
										{#each ACTIONS as action}
											<td data-cell="nowrap" class="text-center"><MarkCell {rules} {role} schema={row.schema} {action} /></td>
										{/each}
										<td><FieldMaskCell {rules} {role} schema={row.schema} perm={row.perm} /></td>
										<td><RuleControls {role} schema={row.schema} perm={row.perm} onedit={openRule} ondelete={askDelete} /></td>
									</tr>
								{/each}

								{#if rows.length === 0}
									<tr>
										<td colspan="8" class="text-sm text-muted">
											{#if filterText}
												No content types in this role match this search.
											{:else if wildcard}
												No content type rules of its own. Every content type uses the wildcard rule above, and every flow is denied.
											{:else}
												{role} has no rules, so it is denied every action on every content type and flow.
											{/if}
										</td>
									</tr>
								{/if}
							{/if}
						</tbody>
					{/each}
				</Table>
			{/if}
		</div>

		<RulesLegend />
	{/if}
</PageShell>

<RuleDrawer
	bind:this={ruleDrawer}
	{rules}
	flowsFailed={data.flowsFailed}
	error={textOf(freshIn('rule'))}
	refused={formRefusal(freshIn('rule'))}
	ondelete={(perm) => void askDelete(perm)}
/>

<form method="POST" action="?/delete" use:enhance={afterDelete} bind:this={deleteForm} class="hidden">
	<input type="hidden" name="id" value={deleteId} />
</form>

<RoleDrawer
	bind:open={roleOpen}
	error={textOf(freshIn('role'))}
	refused={formRefusal(freshIn('role'))}
/>
