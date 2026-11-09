<script lang="ts">
	import { Alert, Checkbox, CheckboxGroup, Collapsible, Input, Panel, SearchInput, SegmentedControl, Table } from '@lyeve-labs/ui-kit';
	import { Database, BookOpen, Plug } from '@lucide/svelte';
	import {
		KEY_ACTIONS,
		READS_EVERY_SCHEMA,
		accessSchemas,
		accessScopes,
		contentSummary,
		namesProblem,
		type KeyAccess,
		type ResourceGroup,
	} from '$lib/api/key-access';
	import { narrows } from '$lib/narrow';
	import { plural } from '$lib/format';

	/**
	 * What a new key may reach: content by schema and action, the schema
	 * catalog, and every other route group the engine says a key can call.
	 * Each section folds, so a key that only reads content is one glance, and
	 * a key held to one flow endpoint is two clicks.
	 *
	 * The choices reach the form action as one `scopes` field per scope and
	 * one `schemas` field per chosen schema, so the action reads the same
	 * thing a script would send.
	 */
	let {
		access = $bindable(),
		schemas,
		groups,
		privileged = false,
		error,
		schemasFailed = false,
		catalogFailed = false,
	}: {
		access: KeyAccess;
		schemas: string[];
		groups: ResourceGroup[];
		privileged?: boolean;
		error?: string;
		/** The schema list did not answer, so an empty list means nothing. */
		schemasFailed?: boolean;
		/** The route catalog did not answer, so no resource below is offered. */
		catalogFailed?: boolean;
	} = $props();

	const scopes = $derived(accessScopes(access));
	const heldSchemas = $derived(accessSchemas(access));

	const MODES = [
		{ value: 'all', label: 'Every content type' },
		{ value: 'chosen', label: 'Chosen content types' },
	] as const;

	let schemaQuery = $state('');
	const shownSchemas = $derived(schemas.filter((s) => narrows(schemaQuery, s)));

	function toggle(list: readonly string[], action: string, on: boolean): string[] {
		return on ? [...new Set([...list, action])] : list.filter((a) => a !== action);
	}

	function setSchemaAction(schema: string, action: string, on: boolean) {
		const next = toggle(access.perSchema[schema] ?? [], action, on);
		access = { ...access, perSchema: { ...access.perSchema, [schema]: next } };
	}

	/** How many of the shown schemas allow an action, for the column's own box. */
	function columnState(action: string): { checked: boolean; indeterminate: boolean } {
		const n = shownSchemas.filter((s) => access.perSchema[s]?.includes(action)).length;
		return { checked: n > 0 && n === shownSchemas.length, indeterminate: n > 0 && n < shownSchemas.length };
	}

	function setColumn(action: string, on: boolean) {
		const perSchema = { ...access.perSchema };
		for (const s of shownSchemas) perSchema[s] = toggle(perSchema[s] ?? [], action, on);
		access = { ...access, perSchema };
	}

	function resourceState(resource: string) {
		return access.resources[resource] ?? { actions: [], names: '' };
	}

	function setResource(resource: string, patch: Partial<{ actions: string[]; names: string }>) {
		access = { ...access, resources: { ...access.resources, [resource]: { ...resourceState(resource), ...patch } } };
	}

	function resourceBadge(g: ResourceGroup): string {
		const st = resourceState(g.resource);
		if (st.actions.length === 0) return 'Off';
		return st.names.trim() ? `${st.actions.join(', ')}, named only` : st.actions.join(', ');
	}

	function actionLabel(action: string): string {
		return KEY_ACTIONS.find((a) => a.value === action)?.label ?? action;
	}
</script>

<section class="flex flex-col gap-3" aria-labelledby="key-access-label">
	<div class="flex flex-col gap-1">
		<p id="key-access-label" class="text-sm font-medium text-fg">Access</p>
		<p class="text-xs text-muted">
			{#if privileged}
				A key with the admin or super admin role gets the access of its role. These choices do not limit it.
			{:else}
				The key can reach only what you choose here. Access rules for its roles still apply, and creating, updating or deleting content also needs the editor role.
			{/if}
		</p>
		{#if error}
			<p class="text-xs text-danger" role="alert">{error}</p>
		{/if}
	</div>

	{#each scopes as scope (scope)}
		<input type="hidden" name="scopes" value={scope} />
	{/each}
	{#each heldSchemas as schema (schema)}
		<input type="hidden" name="schemas" value={schema} />
	{/each}

	<Panel pad="sm">
		<Collapsible label="Content" icon={Database} badge={contentSummary(access)} open>
			<div class="flex flex-col gap-3 pt-2">
				<SegmentedControl
					label="Content types this key reaches"
					size="sm"
					options={[...MODES]}
					bind:value={() => access.contentMode, (v) => (access = { ...access, contentMode: v })}
				/>
				{#if access.contentMode === 'all'}
					<CheckboxGroup
						label="Actions on every content type"
						labelHidden
						orientation="horizontal"
						options={KEY_ACTIONS}
						value={access.contentActions}
						onchange={(v) => (access = { ...access, contentActions: v as typeof access.contentActions })}
					/>
				{:else if schemasFailed}
					<Alert tone="warn">Could not load the content types, so you cannot choose any. Reload the page to try again.</Alert>
				{:else if schemas.length === 0}
					<p class="text-xs text-faint">No content types yet.</p>
				{:else}
					{#if schemas.length > 8}
						<label for="key-schema-search" class="sr-only">Narrow the content types</label>
						<SearchInput id="key-schema-search" bind:value={schemaQuery} placeholder="" />
					{/if}
					<Table label="Actions by content type">
						<thead>
							<tr>
								<th scope="col">Content type</th>
								{#each KEY_ACTIONS as a (a.value)}
									{@const col = columnState(a.value)}
									<th scope="col">
										<Checkbox
											label={a.label}
											checked={col.checked}
											indeterminate={col.indeterminate}
											onchange={(on) => setColumn(a.value, on)}
										/>
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each shownSchemas as schema (schema)}
								<tr>
									<td class="font-mono text-xs">{schema}</td>
									{#each KEY_ACTIONS as a (a.value)}
										<td>
											<Checkbox
												label="{a.label} {schema}"
												labelHidden
												checked={access.perSchema[schema]?.includes(a.value) ?? false}
												onchange={(on) => setSchemaAction(schema, a.value, on)}
											/>
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</Table>
					<p class="text-xs text-muted">The key cannot reach an unticked content type on the content routes.</p>
				{/if}
			</div>
		</Collapsible>
	</Panel>

	<Panel pad="sm">
		<Collapsible label="Content type catalog" icon={BookOpen} badge={access.discoverSchemas ? 'read' : 'Off'}>
			<div class="pt-2">
				<Checkbox
					label="Discover content types"
					description="List the content types and their fields at /api/v1/schemas. A content type is listed only when this key can also read its content."
					checked={access.discoverSchemas}
					onchange={(on) => (access = { ...access, discoverSchemas: on })}
				/>
			</div>
		</Collapsible>
	</Panel>

	{#if catalogFailed}
		<Alert tone="warn">Could not load the route catalog, so you cannot grant other resources. Reload the page to try again.</Alert>
	{/if}

	{#each groups as g (g.resource)}
		{@const st = resourceState(g.resource)}
		<Panel pad="sm">
			<Collapsible label={g.label} icon={Plug} badge={resourceBadge(g)}>
				<div class="flex flex-col gap-3 pt-2">
					{#if access.contentMode === 'chosen' && READS_EVERY_SCHEMA.has(g.resource)}
						<Alert tone="warn">
							{g.label} reads every content type, whatever you chose above. Leave it off for a key limited to some content types.
						</Alert>
					{/if}
					<CheckboxGroup
						label="Actions on {g.label}"
						labelHidden
						orientation="horizontal"
						options={g.actions.map((action) => ({ value: action, label: actionLabel(action) }))}
						value={st.actions}
						onchange={(v) => setResource(g.resource, { actions: v })}
					/>
					{#if g.nameParam}
						<Input
							id="key-names-{g.resource}"
							label="Only these"
							value={st.names}
							oninput={(e: Event) => setResource(g.resource, { names: (e.currentTarget as HTMLInputElement).value })}
							hint="Comma-separated values of {g.nameParam} in the routes below. Leave it empty for every value."
							error={namesProblem(st.names) || undefined}
						/>
					{/if}
					<ul class="flex flex-col gap-1">
						{#each g.routes as r (r.method + r.path)}
							<li class="flex flex-wrap items-baseline gap-x-2 font-mono text-xs text-muted">
								<span class="text-fg">{r.method}</span>
								<span class="break-all">{r.path}</span>
								<span class="text-faint">{actionLabel(r.action).toLowerCase()}</span>
							</li>
						{/each}
					</ul>
				</div>
			</Collapsible>
		</Panel>
	{/each}

	<p class="text-xs text-faint">
		<span aria-live="polite">{scopes.length === 0 ? 'No scope chosen.' : `${scopes.length} ${plural(scopes.length, 'scope')}`}</span>{#if scopes.length > 0}: {scopes.join(', ')}{/if}
	</p>
</section>
