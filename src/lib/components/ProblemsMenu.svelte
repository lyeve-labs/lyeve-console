<script lang="ts" module>
	/** One entry: where the problem is, what is wrong, and a key that stays put while the list changes. */
	export interface ProblemItem {
		key: string;
		where: string;
		what: string;
	}
</script>

<script lang="ts">
	/**
	 * The problem count in an editor's toolbar, and the list behind it.
	 *
	 * Both editors open this list from the button itself: where each problem
	 * is, what is missing, and a row that takes the reader to it. A list drawn
	 * at the top of a scrolled or folded pane would be off screen, so pressing
	 * the count would appear to do nothing.
	 */
	import type { Snippet } from 'svelte';
	import { Button, motion } from '@lyeve-labs/ui-kit';
	import { CircleAlert, CornerDownRight } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { plural } from '$lib/format';

	interface Props {
		problems: ProblemItem[];
		/** The heading over the list, which says what the problems block. */
		title: string;
		/** Takes the reader to the problem: select its node, focus its field. */
		onjump: (problem: ProblemItem) => void;
		open?: boolean;
		/** The id of the panel, for the trigger's aria-controls. */
		id: string;
		/** A control of the page's own at the end of a row, such as asking the assistant. */
		action?: Snippet<[ProblemItem]>;
	}

	let { problems, title, onjump, open = $bindable(false), id, action }: Props = $props();

	let root = $state<HTMLDivElement>();

	const count = $derived(`${problems.length} ${plural(problems.length, 'problem')}`);

	// The list closes with its last problem: left open, it would be an empty
	// box under the toolbar.
	$effect(() => {
		if (problems.length === 0 && open) open = false;
	});

	function close(returnFocus: boolean) {
		open = false;
		if (returnFocus) root?.querySelector<HTMLButtonElement>('button[aria-controls]')?.focus();
	}

	function jump(p: ProblemItem) {
		close(false);
		onjump(p);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			e.stopPropagation();
			close(true);
		}
	}

	/** A press anywhere else closes the list, the way the kit's menus close. */
	function onWindowPointer(e: PointerEvent) {
		if (!open || !root) return;
		if (!root.contains(e.target as Node)) close(false);
	}
</script>

<svelte:window onpointerdown={onWindowPointer} />

{#if problems.length > 0}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="relative inline-flex" bind:this={root} onkeydown={onKey}>
		<Button
			variant="ghost"
			size="sm"
			class="text-danger"
			aria-expanded={open}
			aria-controls={id}
			hint={false}
			onclick={() => (open = !open)}
		>
			<CircleAlert size={ICON.sm} />
			{count}
		</Button>
		{#if open}
			<div
				{id}
				role="region"
				aria-label={title}
				data-testid={id}
				transition:motion.popover
				class="absolute start-0 top-full z-dropdown mt-1 w-96 max-w-[calc(100vw-2rem)] origin-top-left overflow-hidden rounded-xl border border-line bg-surface text-fg shadow-popover inset-shadow-highlight"
			>
				<p class="px-3 pb-1 pt-2.5 text-xs font-medium text-muted">{title}</p>
				<ul class="flex max-h-panel-max flex-col gap-0.5 overflow-y-auto overscroll-contain px-1 pb-1">
					{#each problems as p (p.key)}
						<li class="flex items-center gap-1">
							<button
								type="button"
								class="group flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-2 text-start outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
								data-problem={p.key}
								onclick={() => jump(p)}
							>
								<CircleAlert size={ICON.sm} class="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
								<span class="flex min-w-0 flex-1 flex-col">
									<span class="truncate text-xs text-faint">{p.where}</span>
									<span class="text-sm text-fg">{p.what}</span>
								</span>
								<span class="mt-0.5 flex shrink-0 items-center gap-1 text-xs text-faint transition-colors group-hover:text-fg">
									<CornerDownRight size={ICON.xs} aria-hidden="true" />
									Go to
								</span>
							</button>
							{#if action}{@render action(p)}{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
{/if}
