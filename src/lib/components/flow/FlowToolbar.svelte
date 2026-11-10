<script lang="ts">
	import { Badge, Button, ButtonGroup, Dropdown, Input, Kbd, Toolbar, Tooltip } from '@lyeve-labs/ui-kit';
	import {
		ArrowLeft,
		Ban,
		Database,
		Ellipsis,
		Expand,
		FlaskConical,
		PanelLeft,
		PanelRight,
		Redo2,
		Rocket,
		Save,
		Shrink,
		Trash2,
		Undo2,
		Variable,
		WandSparkles,
	} from '@lucide/svelte';
	import type { ComponentProps } from 'svelte';
	import { hasFlowCanvas } from '$lib/canvas/flow';
	import ProblemsMenu, { type ProblemItem } from '$lib/components/ProblemsMenu.svelte';
	import { fromFlow } from '$lib/flow/back';
	import type { FlowAction } from '$lib/flow/permissions';
	import type { WriteButtons } from '$lib/flow/publish';
	import { statusTone } from '$lib/flow/triggers';
	import type { FlowStatus } from '$lib/flow/types';
	import { ICON } from '$lib/icon';

	interface Props {
		back: { href: string; label: string };
		flowId: string;
		/** The datasources and the variables are admin routes, so their shortcuts are drawn for an admin only. */
		shortcuts: boolean;
		overflow: ComponentProps<typeof Dropdown>['items'];
		name: string;
		onname: (name: string) => void;
		slug: string;
		status: FlowStatus;
		version: number;
		dirty: boolean;
		/** What the status pill says on hover. */
		pillHint: string;
		problems: ProblemItem[];
		showProblems: boolean;
		onjump: (problem: ProblemItem) => void;
		/** Asks the assistant about a problem. Absent while the assistant is off. */
		onask?: (problem: ProblemItem) => void;
		askBusy: boolean;
		showPalette: boolean;
		showInspector: boolean;
		history: { canUndo: boolean; canRedo: boolean };
		onundo: () => void;
		onredo: () => void;
		focus: boolean;
		can: Record<FlowAction, boolean>;
		ondisable: () => void;
		ondelete: () => void;
		ontest: () => void;
		testing: boolean;
		writes: WriteButtons;
		saving: boolean;
		publishing: boolean;
		showKeys: boolean;
	}

	let {
		back,
		flowId,
		shortcuts,
		overflow,
		name,
		onname,
		slug,
		status,
		version,
		dirty,
		pillHint,
		problems,
		showProblems = $bindable(),
		onjump,
		onask,
		askBusy,
		showPalette = $bindable(),
		showInspector = $bindable(),
		history,
		onundo,
		onredo,
		focus = $bindable(),
		can,
		ondisable,
		ondelete,
		ontest,
		testing,
		writes,
		saving,
		publishing,
		showKeys,
	}: Props = $props();

	// One word for where the flow stands, with the live version beside it.
	// Draft, published and disabled are the states an editor sets. Blocked
	// is the engine's, for a published flow whose version names a node type
	// that no started plugin contributes.
	const STATUS_WORD: Record<FlowStatus, string> = { draft: 'Draft', active: 'Published', disabled: 'Disabled', blocked: 'Blocked' };
	const statusLabel = $derived.by(() => {
		const word = STATUS_WORD[status] ?? 'Draft';
		return version > 0 ? `${word} v${version}` : word;
	});
</script>

<div class="shrink-0 border-b border-line px-3 py-2">
	<Toolbar label="Flow editor">
		<a
			href={back.href}
			data-testid="page-back"
			class="relative hit-area -ms-1 inline-flex shrink-0 items-center gap-1 rounded-md px-1 py-1 text-xs text-muted outline-none transition-colors duration-base hover:text-fg focus-visible:ring-2 focus-visible:ring-focus"
		>
			<ArrowLeft size={ICON.sm} aria-hidden="true" class="shrink-0" />
			{back.label}
		</a>
		<!-- The row reads as the schema builder's: the page's own tools on
		     the left, then the thing being edited and its state. A datasource
		     or a variable is what a node most often turns out to be missing,
		     so both are a click from the canvas. The words show once the row
		     has room for them. -->
		{#if shortcuts}
			<Button variant="ghost" size="sm" href={fromFlow('/admin/flows/datasources', flowId)} aria-label="Datasources" data-testid="flow-datasources">
				<Database size={ICON.sm} />
				<span class="hidden 2xl:inline">Datasources</span>
			</Button>
			<Button variant="ghost" size="sm" href={fromFlow('/admin/flows/variables', flowId)} aria-label="Variables" data-testid="flow-variables">
				<Variable size={ICON.sm} />
				<span class="hidden 2xl:inline">Variables</span>
			</Button>
		{/if}
		<Dropdown items={overflow} align="left">
			{#snippet trigger({ open, toggle })}
				<Button variant="ghost" size="sm" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onclick={toggle}>
					<Ellipsis size={ICON.sm} />
				</Button>
			{/snippet}
		</Dropdown>
		<Input id="flow-name" aria-label="Flow name" value={name} class="w-48 lg:w-56" oninput={(e) => onname(e.currentTarget.value)} />
		<Tooltip text={pillHint} position="bottom">
			<span class="inline-flex items-center gap-2" data-testid="flow-status">
				{#if slug}
					<code class="hidden truncate font-mono text-xs text-faint lg:inline">{slug}</code>
				{/if}
				<Badge tone={statusTone(status)} dot>{statusLabel}</Badge>
				{#if dirty}
					<Badge tone="warn" dot>Unsaved changes</Badge>
				{:else}
					<Badge tone="success" dot>Saved</Badge>
				{/if}
			</span>
		</Tooltip>
		<ProblemsMenu id="flow-problems" title="Fix these before publishing" {problems} bind:open={showProblems} {onjump}>
			{#snippet action(p)}
				{#if onask}
					<Button variant="ghost" size="sm" aria-label="Ask the assistant about this problem" disabled={askBusy} onclick={() => onask(p)}>
						<WandSparkles size={ICON.sm} />
					</Button>
				{/if}
			{/snippet}
		</ProblemsMenu>
		{#snippet actions()}
			<!-- The panes are overlays up to xl:. Docked at md: they would leave
			     a 768px window, with the shell's sidebar, no canvas at all. -->
			<ButtonGroup class="xl:hidden">
				<Button variant="ghost" size="sm" aria-label="Node palette" aria-pressed={showPalette} onclick={() => { showPalette = !showPalette; showInspector = false; }}>
					<PanelLeft size={ICON.sm} />
				</Button>
				<Button variant="ghost" size="sm" aria-label="Inspector" aria-pressed={showInspector} onclick={() => { showInspector = !showInspector; showPalette = false; }}>
					<PanelRight size={ICON.sm} />
				</Button>
			</ButtonGroup>
			<!-- The list editor keeps no history, so it offers no undo. -->
			{#if hasFlowCanvas}
				<ButtonGroup>
					<Button variant="ghost" size="sm" disabled={!history.canUndo} onclick={onundo} aria-label="Undo" hint="Undo (Ctrl+Z)">
						<Undo2 size={ICON.sm} />
					</Button>
					<Button variant="ghost" size="sm" disabled={!history.canRedo} onclick={onredo} aria-label="Redo" hint="Redo (Ctrl+Shift+Z)">
						<Redo2 size={ICON.sm} />
					</Button>
				</ButtonGroup>
			{/if}
			<Button
				variant="ghost"
				size="sm"
				class="hidden md:inline-flex"
				aria-label={focus ? 'Exit focus mode' : 'Focus mode'}
				aria-pressed={focus}
				hint={focus ? 'Exit focus mode (Ctrl+Shift+F)' : 'Focus mode (Ctrl+Shift+F)'}
				data-testid="focus-toggle"
				onclick={() => (focus = !focus)}
			>
				{#if focus}<Shrink size={ICON.sm} />{:else}<Expand size={ICON.sm} />{/if}
			</Button>
			<!-- The flow's lifecycle, icon-only in the danger tone beside the
			     primary actions, as the schema builder places its delete. -->
			{#if status === 'active' && can.activate}
				<Button variant="ghost" size="sm" class="text-danger" aria-label="Disable flow" hint="Stop serving the published version" onclick={ondisable}>
					<Ban size={ICON.sm} />
				</Button>
			{/if}
			{#if can.delete}
				<Button variant="ghost" size="sm" class="text-danger" aria-label="Delete flow" hint="Delete the flow, its versions and its runs" onclick={ondelete}>
					<Trash2 size={ICON.sm} />
				</Button>
			{/if}
			{#if can.activate}
				<Button variant="secondary" size="sm" onclick={ontest} loading={testing}>
					<FlaskConical size={ICON.sm} />
					Test
				</Button>
			{/if}
			{#if can.update}
				<Button variant={writes.save.variant} size="sm" type="submit" form="flow-save" disabled={writes.save.disabled} hint={writes.save.hint} loading={saving}>
					<Save size={ICON.sm} />
					Save
				</Button>
			{/if}
			{#if can.activate}
				<Button variant={writes.publish.variant} size="sm" type="submit" form="flow-publish" disabled={writes.publish.disabled} hint={writes.publish.hint} loading={publishing}>
					<Rocket size={ICON.sm} />
					Publish
				</Button>
			{/if}
		{/snippet}
	</Toolbar>
	{#if showKeys}
		<p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint" data-testid="keyboard-hints">
			{#if hasFlowCanvas}
				<span><Kbd>Ctrl</Kbd> <Kbd>Z</Kbd> undo</span>
				<span><Kbd>Ctrl</Kbd> <Kbd>Shift</Kbd> <Kbd>Z</Kbd> redo</span>
			{/if}
			<span><Kbd>Del</Kbd> remove the selection</span>
			{#if hasFlowCanvas}
				<span><Kbd>Shift</Kbd> drag to select several, <Kbd>Shift</Kbd> click to add one</span>
				<span><Kbd>Space</Kbd> drag to pan</span>
				<span><Kbd>Alt</Kbd> drag off the grid</span>
				<span><Kbd>+</Kbd> <Kbd>-</Kbd> zoom, <Kbd>Shift</Kbd> <Kbd>1</Kbd> fit, <Kbd>Shift</Kbd> <Kbd>0</Kbd> 100%</span>
				<span><Kbd>Tab</Kbd> to a node, <Kbd>Enter</Kbd> to select it, arrows to nudge</span>
			{:else}
				<span><Kbd>Tab</Kbd> to a node, <Kbd>Enter</Kbd> to select it</span>
			{/if}
			<span><Kbd>Ctrl</Kbd> <Kbd>S</Kbd> save</span>
			<span><Kbd>Ctrl</Kbd> <Kbd>Shift</Kbd> <Kbd>F</Kbd> focus mode</span>
		</p>
	{/if}
</div>
