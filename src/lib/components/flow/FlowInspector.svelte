<script lang="ts">
	import { Badge, Button, Collapsible, CopyField, Input, NumberInput, RadioGroup, SectionHeading, Select, Textarea } from '@lyeve-labs/ui-kit';
	import { BookOpen, Lock, WandSparkles } from '@lucide/svelte';
	import NodeConfigForm from './NodeConfigForm.svelte';
	import EventTriggerForm from './EventTriggerForm.svelte';
	import InlineDataEditor from './InlineDataEditor.svelte';
	import type { TablesState } from './TablesPanel.svelte';
	import { isLocked, type DatasourceOption, type EventTypes, type FlowDefinition, type FlowOption, type NodeSpec, type SchemaOption, type Selection } from '$lib/flow/types';
	import { findEdge, fromPort, nodeById, removeEdge, removeNodes, removeNote, specFor, toPort, updateNode } from '$lib/flow/graph';
	import { categoryIcon, categoryText, pluginLabel } from '$lib/flow/categories';
	import type { ValidationError } from '$lib/api/flows';
	import { hasKnownKey, isLockedOption } from '$lib/flow/schema';
	import { isInlineDataSchema } from '$lib/flow/inline';
	import { isEventTriggerSchema } from '$lib/flow/events';
	import { flowEndpoints, slugError, type FlowEndpoint } from '$lib/flow/endpoints';
	import { FILL_NODE } from '$lib/flow/fill';
	import { ICON } from '$lib/icon';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { GATE_OK, type Gate } from '$lib/api/gate';

	interface Props {
		definition: FlowDefinition;
		catalog: NodeSpec[];
		selected: Selection;
		errors?: ValidationError[];
		/** The tenant's content schemas, for the pickers. */
		schemas?: SchemaOption[];
		/** The tenant's datasources, for the pickers and the names list. */
		datasources?: DatasourceOption[];
		/** How each names read went, so a failed read is not drawn as none. */
		datasourcesGate?: Gate;
		variables?: string[];
		variablesGate?: Gate;
		/** The published flows, for the flow picker. */
		flows?: FlowOption[];
		/** The id of the flow on the canvas, which its own flow picker leaves out. */
		flowId?: string;
		/** The event types the engine lists, or null when the read failed or the route is absent. */
		eventTypes?: EventTypes | null;
		/** Introspection results by datasource id, owned by the page. */
		tables?: Record<string, TablesState>;
		onintrospect?: (id: string) => void;
		onchange: (def: FlowDefinition) => void;
		onselect: (sel: Selection) => void;
		/** Opens the Guide tab. */
		onguide?: () => void;
		/** Asks the assistant about the selected node. Absent when the assistant is not on this engine. */
		onassist?: () => void;
		/** The slug the engine holds for this flow, which the old URLs answer at until a save. */
		savedSlug?: string;
		/** The origin the console is served from, which the flow's URLs share. */
		origin?: string;
	}

	let {
		definition,
		catalog,
		selected,
		errors = [],
		schemas = [],
		datasources = [],
		datasourcesGate = GATE_OK,
		variables = [],
		variablesGate = GATE_OK,
		flows = [],
		flowId,
		eventTypes = null,
		tables = {},
		onintrospect,
		onchange,
		onselect,
		onguide,
		onassist,
		savedSlug = '',
		origin = '',
	}: Props = $props();

	const LOCKED = 'Not enabled on this instance';

	const endpoints = $derived(flowEndpoints(origin, flowId ?? '', definition));
	const slugProblem = $derived(slugError(definition.slug ?? ''));
	const slugMoved = $derived(!!savedSlug && definition.slug !== savedSlug && !slugProblem);

	const node = $derived(selected?.kind === 'node' ? nodeById(definition, selected.id) : undefined);
	const nodeSpec = $derived(node ? specFor(catalog, node.type) : undefined);
	const edge = $derived(selected?.kind === 'edge' ? findEdge(definition, selected.id) : undefined);
	const note = $derived(selected?.kind === 'note' ? (definition.notes ?? []).find((n) => n.id === selected?.id) : undefined);

	const triggerSpecs = $derived(catalog.filter((s) => s.trigger));
	const triggerSpec = $derived(specFor(catalog, definition.trigger.type));
	// The built-in kinds first, then a group per contributing plugin under
	// the same name the palette gives its section. The catalog already
	// lists contributed types after the built-ins, by plugin, so the groups
	// are runs and the select shows each heading once.
	// A built-in trigger the plugin says this instance may not use sits under
	// a heading of its own after the others, so the list says which are which
	// before one is picked. A contributed trigger keeps its plugin's heading
	// and the marker under the select says the rest.
	const triggerOptions = $derived.by(() => {
		const usable = triggerSpecs.filter((s) => !s.plugin && !isLocked(s));
		const locked = triggerSpecs.filter((s) => !s.plugin && isLocked(s));
		const contributed = triggerSpecs.filter((s) => s.plugin);
		return [
			...usable.map((s) => ({ value: s.type, label: s.label, keywords: [s.type] })),
			...locked.map((s) => ({ value: s.type, label: s.label, group: LOCKED, keywords: [s.type] })),
			...contributed.map((s) => ({ value: s.type, label: s.label, group: pluginLabel(s.plugin ?? ''), icon: categoryIcon(s.plugin ?? ''), keywords: [s.plugin ?? '', s.type] })),
		];
	});
	const triggerLocked = $derived(isLocked(triggerSpec));
	// An address is locked with its trigger, or with the option it exists
	// through when the plugin locks that option.
	function endpointLocked(option: FlowEndpoint['option']): boolean {
		if (triggerLocked) return true;
		const prop = option ? triggerSpec?.config_schema.properties?.[option] : undefined;
		return prop !== undefined && isLockedOption(prop);
	}
	const events = $derived(eventTypes?.system ?? []);

	const nodeErrors = $derived(node ? errors.filter((e) => e.node_id === node.id) : []);
	const flowErrors = $derived(errors.filter((e) => !e.node_id || e.node_id === 'trigger'));

	// What no field can show: a path outside the config, or a config key the
	// schema does not name. These are listed at the bottom with the full path,
	// because an error only counted in the badge sends the reader hunting.
	const orphanNodeErrors = $derived(
		nodeErrors.filter((e) => !nodeSpec || !hasKnownKey(nodeSpec.config_schema, '/config', e.path))
	);
	const orphanFlowErrors = $derived(
		flowErrors.filter((e) => !triggerSpec || !hasKnownKey(triggerSpec.config_schema, '/trigger/config', e.path))
	);

	function patchTrigger(type: string) {
		const s = specFor(catalog, type);
		const config = JSON.parse(JSON.stringify(s?.example ?? {})) as Record<string, unknown>;
		onchange({ ...definition, trigger: { type, config } });
	}

	function patchSettings(patch: Partial<FlowDefinition['settings']>) {
		onchange({ ...definition, settings: { ...definition.settings, ...patch } });
	}

	function deleteSelection() {
		if (!selected) return;
		let next = definition;
		if (selected.kind === 'node') next = removeNodes(next, [selected.id]);
		else if (selected.kind === 'edge') next = removeEdge(next, selected.id);
		else next = removeNote(next, selected.id);
		onchange(next);
		onselect(null);
	}

	const ON_ERROR = [
		{ value: 'stop', label: 'Stop', description: 'The run ends at the first node that fails, and nothing after it runs.' },
		{ value: 'continue', label: 'Continue', description: 'The node is marked failed and the run goes on to the nodes after it.' },
	];

	// A read that may answer on a second try is drawn as failed, with Try
	// again. A role refused the names, a license without them and a plugin
	// that does not serve them are not, because the toolbar draws no way to
	// them either.
	const RETRYABLE: ReadonlySet<Gate['state']> = new Set(['unavailable', 'busy', 'error']);
	const datasourcesUnread = $derived(RETRYABLE.has(datasourcesGate.state));
	const variablesUnread = $derived(RETRYABLE.has(variablesGate.state));
	// A refused or unlicensed read listed nothing, so its row would say none
	// where the answer is unknown. Only a read that ran or can run again shows.
	const datasourcesRow = $derived(datasourcesGate.state === 'ok' || datasourcesUnread);
	const variablesRow = $derived(variablesGate.state === 'ok' || variablesUnread);
</script>

<div class="flex flex-col gap-4 p-4" data-testid="flow-inspector">
	{#if node}
		{@const Icon = categoryIcon(nodeSpec?.category)}
		<div class="flex items-center gap-2" data-testid="inspector-header">
			<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 {categoryText(nodeSpec?.category)}">
				<Icon size={ICON.md} />
			</span>
			<!-- The title takes the row's free width. The badge sits on the meta
			     line under it, where it wraps below the node type in a narrow
			     inspector instead of covering the title. -->
			<div class="min-w-0 flex-1">
				<SectionHeading level={2}>{nodeSpec?.label ?? node.type}</SectionHeading>
				<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
					<p class="min-w-0 truncate font-mono text-xs text-muted" title={nodeSpec?.description}>{node.type}</p>
					{#if nodeSpec?.side_effects}<Badge tone="warn" size="sm">side effects</Badge>{/if}
				</div>
			</div>
			{#if onassist || onguide}
				<div class="flex shrink-0 items-center">
					{#if onassist}
						<Button variant="ghost" size="icon" aria-label="Ask the assistant about this node" onclick={onassist}>
							<WandSparkles size={ICON.sm} />
						</Button>
					{/if}
					{#if onguide}
						<Button variant="ghost" size="icon" aria-label="Open the guide" onclick={onguide}>
							<BookOpen size={ICON.sm} />
						</Button>
					{/if}
				</div>
			{/if}
		</div>
		<Input
			id="node-name"
			label="Name"
			value={node.name ?? ''}
			oninput={(e) => onchange(updateNode(definition, node.id, { name: e.currentTarget.value }))}
		/>
		{#if nodeSpec && isInlineDataSchema(nodeSpec.config_schema)}
			<InlineDataEditor
				schema={nodeSpec.config_schema}
				value={node.config}
				errors={nodeErrors}
				idPrefix="node-{node.id}"
				onchange={(config) => onchange(updateNode(definition, node.id, { config }))}
			/>
		{:else if nodeSpec}
			<NodeConfigForm
				schema={nodeSpec.config_schema}
				value={node.config}
				errors={nodeErrors}
				idPrefix="node-{node.id}"
				{schemas}
				{datasources}
				{datasourcesGate}
				{flows}
				selfId={flowId}
				{events}
				{tables}
				{onintrospect}
				fillNode={node.type === FILL_NODE}
				onchange={(config) => onchange(updateNode(definition, node.id, { config }))}
			/>
		{:else}
			<p class="text-sm text-danger">{node.type} is not a known node type, so its settings cannot be edited here.</p>
		{/if}
		<!-- The id is what expressions and edges name the node by. It is set
		     once and read everywhere, so it folds away under the settings the
		     reader came to change. -->
		<Collapsible label="Advanced" class="-mx-1">
			<div class="px-1 pb-1 pt-2">
				<Input
					id="node-id"
					label="Id"
					value={node.id}
					hint="Referenced as nodes.{node.id}.output. Change it before wiring edges."
					onchange={(e) => {
						const id = e.currentTarget.value.trim();
						if (!id || id === node.id || nodeById(definition, id)) return;
						const renamed = updateNode(definition, node.id, { id });
						onchange({
							...renamed,
							edges: renamed.edges.map((ed) => ({
								...ed,
								from: ed.from === node.id ? id : ed.from,
								to: ed.to === node.id ? id : ed.to,
							})),
						});
						onselect({ kind: 'node', id });
					}}
				/>
			</div>
		</Collapsible>
		{@render orphans(orphanNodeErrors)}
		{@render remove('Delete node')}
	{:else if edge}
		<SectionHeading level={2} variant="eyebrow">Edge</SectionHeading>
		<p class="font-mono text-xs text-fg">{edge.from}.{fromPort(edge)} to {edge.to}.{toPort(edge)}</p>
		{@render remove('Delete edge')}
	{:else if note}
		<SectionHeading level={2} variant="eyebrow">Note</SectionHeading>
		<p class="text-xs text-muted">Notes sit on the canvas and never run. Edit the text on the card.</p>
		{@render remove('Delete note')}
	{:else}
		<SectionHeading level={2} variant="eyebrow">Trigger</SectionHeading>
		<Select
			id="trigger-type"
			label="Trigger type"
			searchable
			options={triggerOptions}
			value={definition.trigger.type}
			onvaluechange={(v) => {
				if (v && v !== definition.trigger.type) patchTrigger(v);
			}}
		/>
		{#if triggerLocked}
			<p class="flex items-center gap-2 text-xs text-muted" data-testid="trigger-locked">
				<Lock size={ICON.xs} aria-hidden="true" class="shrink-0" />
				<span>This trigger is not enabled on this instance. A flow that uses it cannot be saved.</span>
			</p>
		{/if}
		{#if triggerSpec && isEventTriggerSchema(triggerSpec.config_schema)}
			<EventTriggerForm
				schema={triggerSpec.config_schema}
				value={definition.trigger.config}
				path="/trigger/config"
				errors={flowErrors}
				idPrefix="trigger"
				{schemas}
				{events}
				onchange={(config) => onchange({ ...definition, trigger: { ...definition.trigger, config } })}
			/>
		{:else if triggerSpec}
			{#if triggerSpec.plugin}
				{@const Icon = categoryIcon(triggerSpec.plugin)}
				<!-- A contributed trigger says whose it is, the way a contributed
				     node's palette section does: it goes when the plugin does. -->
				<div class="flex items-center gap-2" data-testid="trigger-plugin">
					<Icon size={ICON.sm} class="shrink-0 {categoryText(triggerSpec.plugin)}" />
					<span class="min-w-0 truncate text-sm font-medium text-fg">{triggerSpec.label}</span>
					<Badge size="sm">plugin</Badge>
					<span class="truncate text-xs text-faint">{pluginLabel(triggerSpec.plugin)}</span>
				</div>
			{/if}
			<p class="text-xs text-muted">{triggerSpec.description}</p>
			<NodeConfigForm
				schema={triggerSpec.config_schema}
				value={definition.trigger.config}
				path="/trigger/config"
				errors={flowErrors}
				idPrefix="trigger"
				{schemas}
				{datasources}
				{datasourcesGate}
				{flows}
				selfId={flowId}
				{events}
				onchange={(config) => onchange({ ...definition, trigger: { ...definition.trigger, config } })}
			/>
		{/if}
		{#if endpoints.length > 0}
			<div class="flex flex-col gap-3" data-testid="flow-endpoints">
				<SectionHeading level={2} variant="eyebrow">Endpoints</SectionHeading>
				<p class="text-xs text-muted">The flow responds at these addresses once it is published. A new slug takes effect when you save, and a trigger change when you publish.</p>
				{#each endpoints as ep (ep.key)}
					<div class="flex flex-col gap-1">
						<CopyField id="endpoint-{ep.key}" label={ep.label} value={ep.value} hint={ep.hint} copyLabel="Copy {ep.label}" />
						{#if endpointLocked(ep.option)}
							<p class="flex items-center gap-2 text-xs text-muted" data-testid="endpoint-locked-{ep.key}">
								<Lock size={ICON.xs} aria-hidden="true" class="shrink-0" />
								<span>{LOCKED}.</span>
							</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
		<SectionHeading level={2} variant="eyebrow">Flow</SectionHeading>
		<Input
			id="flow-slug"
			label="Slug"
			value={definition.slug ?? ''}
			hint={slugMoved
				? `Saving moves the flow to this slug. /api/v1/flows/${savedSlug} and the name ${savedSlug} on GraphQL, gRPC and realtime stop working, and a permission rule on flow:${savedSlug} no longer applies.`
				: 'Identifies the flow in its REST URL and on GraphQL, gRPC and realtime. Must be unique in this tenant.'}
			error={slugProblem}
			oninput={(e) => onchange({ ...definition, slug: e.currentTarget.value.trim() })}
			mono
		/>
		<Textarea
			id="flow-description"
			label="Description"
			rows={2}
			value={definition.description ?? ''}
			oninput={(e) => onchange({ ...definition, description: e.currentTarget.value })}
		/>
		<!-- The run limits ship with defaults that hold for most flows, so they
		     fold away. An error on one of them opens the block so the field
		     it marks is on screen. -->
		<Collapsible label="Advanced" class="-mx-1" open={orphanFlowErrors.length > 0 || flowErrors.some((e) => e.path.startsWith('/settings'))}>
			<div class="flex flex-col gap-4 px-1 pb-1 pt-2">
				<Input
					id="settings-timeout"
					label="Run timeout"
					hint="The whole run, as a duration such as 10s."
					value={definition.settings.timeout}
					oninput={(e) => patchSettings({ timeout: e.currentTarget.value })}
				/>
				<Input
					id="settings-step-timeout"
					label="Step timeout"
					hint="Each node, as a duration such as 5s."
					value={definition.settings.step_timeout}
					oninput={(e) => patchSettings({ step_timeout: e.currentTarget.value })}
				/>
				<NumberInput
					id="settings-max-steps"
					label="Max steps"
					min={1}
					value={definition.settings.max_steps}
					onchange={(n) => patchSettings({ max_steps: n })}
				/>
				<RadioGroup
					name="settings-on-error"
					label="On error"
					options={ON_ERROR}
					value={definition.settings.on_error}
					onchange={(v) => patchSettings({ on_error: v === 'continue' ? 'continue' : 'stop' })}
				/>
			</div>
		</Collapsible>
		{#if datasources.length > 0 || variables.length > 0 || datasourcesUnread || variablesUnread}
			<SectionHeading level={2} variant="eyebrow">Available names</SectionHeading>
			<dl class="grid gap-3 text-xs">
				{#if datasourcesRow}
					<div>
						<dt class="text-faint">Datasources</dt>
						{#if datasourcesUnread}
							<dd><GateNotice gate={datasourcesGate} title="Datasources" absent="" /></dd>
						{:else}
							<dd class="font-mono text-fg">
								{#each datasources as d (d.id)}<span class="block">{d.name} <span class="text-faint">{d.kind}</span></span>{:else}<span class="text-faint">none</span>{/each}
							</dd>
						{/if}
					</div>
				{/if}
				{#if variablesRow}
					<div>
						<dt class="text-faint">Variables</dt>
						{#if variablesUnread}
							<dd><GateNotice gate={variablesGate} title="Variables" absent="" /></dd>
						{:else}
							<dd class="font-mono text-fg">
								{#each variables as v (v)}<span class="block">vars.{v}</span>{:else}<span class="text-faint">none</span>{/each}
							</dd>
						{/if}
					</div>
				{/if}
			</dl>
		{/if}
		{@render orphans(orphanFlowErrors)}
	{/if}
</div>

{#snippet remove(label: string)}
	<div>
		<Button variant="ghost" size="sm" class="text-danger" onclick={deleteSelection}>{label}</Button>
	</div>
{/snippet}

{#snippet orphans(list: ValidationError[])}
	{#if list.length > 0}
		<div class="flex flex-col gap-1" data-testid="orphan-errors">
			<SectionHeading level={3} variant="eyebrow">Other issues</SectionHeading>
			<ul class="flex flex-col gap-1 text-xs text-danger">
				{#each list as err (err.path + err.message)}
					<li><span class="font-mono">{err.path}</span>: {err.message}</li>
				{/each}
			</ul>
		</div>
	{/if}
{/snippet}
