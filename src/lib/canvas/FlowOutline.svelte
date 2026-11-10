<script lang="ts">
	import { onMount } from 'svelte';
	import { Badge, Button, Select, type StatusTone } from '@lyeve-labs/ui-kit';
	import { StickyNote, X } from '@lucide/svelte';
	import type { FlowCanvasProps } from './contract';
	import type { RunStep } from '$lib/api/flows';
	import { categoryIcon, categoryText } from '$lib/flow/categories';
	import { formatDuration } from '$lib/flow/time';
	import { describeError } from '$lib/flow/problems';
	import { TRIGGER_ID, type FlowDefinition, type FlowEdge, type Port, type Position } from '$lib/flow/types';
	import {
		TRIGGER_OUTPUTS,
		addEdge,
		addNode,
		addNote,
		canConnect,
		configSummary,
		edgeId,
		fromPort,
		inputsOf,
		outputsOf,
		removeEdge,
		removeNodes,
		removeNote,
		specFor,
		toPort,
		topoDepths,
	} from '$lib/flow/graph';
	import { ICON } from '$lib/icon';

	/**
	 * The flow as a list, for a build that carries no visual editor. It edits
	 * the same definition through the same graph functions, and it never moves
	 * a node, so a flow edited here opens as it was drawn in an editor that
	 * shows positions.
	 */
	let {
		definition = $bindable(),
		catalog,
		selected = $bindable(null),
		runSteps = [],
		errors = [],
		onchange,
		onhistory,
		empty,
	}: FlowCanvasProps = $props();

	/** Room a new node is given below the lowest one, so it lands clear of it in a positioned editor. */
	const NEW_ROW_GAP = 160;

	let list = $state<HTMLElement>();

	type Row = {
		id: string;
		kind: 'trigger' | 'node';
		label: string;
		type: string;
		category: string | undefined;
		summary: { key: string; value: string }[];
		inputs: Port[];
	};

	// Run order: the trigger, then each node by its depth from a root, and
	// the order they were added in within one depth.
	const rows = $derived.by((): Row[] => {
		const depth = topoDepths(definition);
		const nodes = definition.nodes
			.map((n, i) => ({ n, i }))
			.sort((a, b) => (depth.get(a.n.id) ?? 0) - (depth.get(b.n.id) ?? 0) || a.i - b.i)
			.map(({ n }) => n);
		const trigger = specFor(catalog, definition.trigger.type);
		return [
			{
				id: TRIGGER_ID,
				kind: 'trigger',
				label: trigger?.label ?? definition.trigger.type,
				type: definition.trigger.type,
				category: 'trigger',
				summary: configSummary({ id: TRIGGER_ID, type: definition.trigger.type, position: { x: 0, y: 0 }, config: definition.trigger.config }, trigger),
				inputs: [],
			},
			...nodes.map((n): Row => {
				const spec = specFor(catalog, n.type);
				return {
					id: n.id,
					kind: 'node',
					label: n.name || spec?.label || n.id,
					type: n.type,
					category: spec?.category,
					summary: configSummary(n, spec),
					inputs: inputsOf(definition, catalog, n.id),
				};
			}),
		];
	});

	const labelOf = $derived(new Map(rows.map((r) => [r.id, r.label])));
	const stepByNode = $derived(new Map(runSteps.map((s) => [s.node_id, s])));
	const problemsByNode = $derived.by(() => {
		const out = new Map<string, string[]>();
		errors.forEach((e, i) => {
			if (!e.node_id) return;
			const what = describeError(e, definition, catalog, i).what;
			out.set(e.node_id, [...(out.get(e.node_id) ?? []), what]);
		});
		return out;
	});

	/** The run outcome in the words a positioned editor uses on its cards. */
	function pill(step: RunStep): { label: string; tone: StatusTone } {
		const took = formatDuration(step.duration_ms);
		if (step.dry_run) return { label: `dry-run ${took}`, tone: 'warn' };
		if (step.status === 'succeeded') return { label: `ok ${took}`, tone: 'success' };
		if (step.status === 'failed') return { label: `failed ${took}`, tone: 'danger' };
		return { label: 'skipped', tone: 'neutral' };
	}

	function commit(next: FlowDefinition) {
		definition = next;
		onchange?.(next);
	}

	function isSelected(id: string): boolean {
		if (id === TRIGGER_ID) return selected === null;
		return selected !== null && selected.kind !== 'edge' && selected.id === id;
	}

	/** The trigger has no inspector of its own: picking it shows the flow settings, as a positioned editor does. */
	function pick(id: string, kind: 'trigger' | 'node' | 'note') {
		selected = kind === 'trigger' ? null : { kind, id };
	}

	function rowKey(e: KeyboardEvent) {
		if (e.key !== 'Delete' && e.key !== 'Backspace') return;
		e.preventDefault();
		deleteSelection();
	}

	/** The edges that land on one input port. */
	function sourcesOf(to: string, port: string): FlowEdge[] {
		return definition.edges.filter((e) => e.to === to && toPort(e) === port);
	}

	/** Every output that may feed this port now, as the graph rules decide. */
	function candidates(to: string, port: string): { from: string; port: string }[] {
		const outs: { from: string; port: string }[] = [];
		for (const r of rows) {
			const ports = r.kind === 'trigger' ? TRIGGER_OUTPUTS : outputsOf(definition, catalog, r.id);
			for (const p of ports) {
				if (canConnect(definition, catalog, r.id, p.name, to, port).ok) outs.push({ from: r.id, port: p.name });
			}
		}
		return outs;
	}

	function sourceLabel(from: string, port: string): string {
		const name = labelOf.get(from) ?? from;
		return port === 'out' ? name : `${name}, ${port}`;
	}

	function connect(to: string, port: string, choice: string) {
		const c = candidates(to, port)[Number(choice)];
		if (c) commit(addEdge(definition, c.from, c.port, to, port));
	}

	/** Below the lowest node, at its left edge: clear of every card a positioned editor draws. */
	function nextSpot(): Position {
		const placed = [definition.trigger.position, ...definition.nodes.map((n) => n.position), ...(definition.notes ?? []).map((n) => n.position)].filter(
			(p): p is Position => p !== undefined
		);
		if (placed.length === 0) return { x: 0, y: 0 };
		const lowest = placed.reduce((a, b) => (b.y > a.y ? b : a));
		return { x: lowest.x, y: lowest.y + NEW_ROW_GAP };
	}

	export function addNodeAtCenter(type: string) {
		if (type === 'note') {
			addNoteAtCenter();
			return;
		}
		const spec = specFor(catalog, type);
		if (!spec) return;
		const next = addNode(definition, spec, nextSpot());
		commit(next);
		const id = next.nodes.at(-1)?.id;
		if (id) selected = { kind: 'node', id };
	}

	export function addNoteAtCenter() {
		const next = addNote(definition, nextSpot());
		commit(next);
		const id = (next.notes ?? []).at(-1)?.id;
		if (id) selected = { kind: 'note', id };
	}

	export function deleteSelection() {
		if (!selected) return;
		if (selected.kind === 'edge') commit(removeEdge(definition, selected.id));
		else if (selected.kind === 'note') commit(removeNote(definition, selected.id));
		else commit(removeNodes(definition, [selected.id]));
		selected = null;
	}

	export function reveal(id: string) {
		const row = [...(list?.querySelectorAll<HTMLElement>('[data-node-id], [data-note-id]') ?? [])].find((el) => (el.dataset.nodeId ?? el.dataset.noteId) === id);
		row?.scrollIntoView?.({ block: 'nearest' });
	}

	// A list has no history, layout or viewport of its own. These answer the
	// page's calls and change nothing.
	export function undo() {}
	export function redo() {}
	export function autoLayout() {}
	export function fit() {}
	export function openingFit() {}

	onMount(() => onhistory?.({ canUndo: false, canRedo: false }));
</script>

<div class="h-full overflow-y-auto bg-surface p-4" data-testid="flow-outline" bind:this={list}>
	<ol class="mx-auto flex max-w-2xl flex-col gap-2" aria-label="Flow steps">
		{#each rows as row (row.id)}
			{@const Icon = categoryIcon(row.category)}
			{@const step = stepByNode.get(row.id)}
			{@const problems = problemsByNode.get(row.id) ?? []}
			<li
				class="rounded-lg border bg-surface-2 transition-colors {isSelected(row.id) ? 'border-brand ring-2 ring-brand/40' : problems.length > 0 ? 'border-danger' : 'border-line-strong'}"
				data-node-id={row.id}
			>
				<button
					type="button"
					class="flex w-full items-center gap-2 rounded-t-lg px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
					aria-label="{row.label}, {row.kind === 'trigger' ? 'trigger' : row.type}"
					aria-pressed={isSelected(row.id)}
					onclick={() => pick(row.id, row.kind)}
					onkeydown={row.kind === 'node' ? rowKey : undefined}
				>
					<Icon size={ICON.sm} class="shrink-0 {categoryText(row.category)}" />
					<span class="flex min-w-0 flex-1 flex-col leading-tight">
						<span class="truncate text-sm font-medium text-fg">{row.label}</span>
						<span class="truncate font-mono text-xs text-faint">{row.type}</span>
					</span>
					{#if step}
						{@const p = pill(step)}
						<Badge tone={p.tone} size="sm">{p.label}</Badge>
					{/if}
				</button>
				{#if row.summary.length > 0 || problems.length > 0 || row.inputs.length > 0}
					<div class="flex flex-col gap-2 border-t border-line px-3 py-2 text-xs">
						{#each row.summary as s (s.key)}
							<div class="flex items-center gap-1 font-mono">
								<span class="text-faint">{s.key}</span>
								<span class="truncate text-fg">{s.value}</span>
							</div>
						{/each}
						{#each problems as what, i (i)}
							<p class="text-danger">{what}</p>
						{/each}
						{#each row.inputs as port (port.name)}
							{@const sources = sourcesOf(row.id, port.name)}
							{@const offers = candidates(row.id, port.name)}
							<div class="flex flex-col gap-1" data-testid="outline-port">
								{#if offers.length === 0}
									<span class="text-muted">Input {port.label ?? port.name}</span>
								{:else}
									<Select
										label="Input {port.label ?? port.name}"
										placeholder="Add a source"
										searchable
										value=""
										options={offers.map((o, i) => ({ value: String(i), label: sourceLabel(o.from, o.port) }))}
										onvaluechange={(v) => connect(row.id, port.name, v)}
									/>
								{/if}
								{#each sources as edge (edgeId(edge))}
									<div class="flex items-center gap-1">
										<span class="truncate text-fg">{sourceLabel(edge.from, fromPort(edge))}</span>
										<Button
											variant="ghost"
											size="sm"
											aria-label="Disconnect {sourceLabel(edge.from, fromPort(edge))} from {row.label}"
											hint={false}
											onclick={() => commit(removeEdge(definition, edgeId(edge)))}
										>
											<X size={ICON.xs} />
										</Button>
									</div>
								{/each}
							</div>
						{/each}
					</div>
				{/if}
			</li>
		{/each}
		{#each definition.notes ?? [] as note (note.id)}
			<li
				class="rounded-lg border bg-surface-2 transition-colors {isSelected(note.id) ? 'border-brand ring-2 ring-brand/40' : 'border-line'}"
				data-note-id={note.id}
			>
				<button
					type="button"
					class="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
					aria-label="Note {note.id}"
					aria-pressed={isSelected(note.id)}
					onclick={() => pick(note.id, 'note')}
					onkeydown={rowKey}
				>
					<StickyNote size={ICON.sm} class="mt-0.5 shrink-0" />
					<span class="whitespace-pre-wrap">{note.text || 'Empty note'}</span>
				</button>
			</li>
		{/each}
	</ol>
	{#if definition.nodes.length === 0 && empty}
		<div class="mt-6 flex justify-center" data-testid="outline-empty">
			{@render empty()}
		</div>
	{/if}
</div>
