<script lang="ts">
	import { Badge, Label, Textarea } from '@lyeve-labs/ui-kit';
	import TablesPanel, { type TablesState } from './TablesPanel.svelte';

	/**
	 * A plain code field: the kit's Textarea in a monospace face with a line
	 * number gutter beside it, Tab inserting two spaces, and for SQL a panel
	 * of the datasource's tables that inserts a name at the cursor. Not an
	 * editor library: the bundle rules leave no room for one, and a query of
	 * thirty lines does not need one.
	 */
	interface Props {
		id: string;
		label: string;
		value: string;
		language?: string;
		hint?: string;
		error?: string;
		required?: boolean;
		placeholder?: string;
		/** Shows text the reader cannot edit, such as a draft they accept or discard whole. */
		readonly?: boolean;
		/** The tables of the datasource the query names. Only a SQL editor shows them. */
		tables?: TablesState;
		onretry?: () => void;
		oninput?: (value: string) => void;
	}

	let { id, label, value, language = 'text', hint, error, required = false, placeholder, readonly = false, tables, onretry, oninput }: Props = $props();

	const MIN_ROWS = 6;
	const MAX_ROWS = 20;
	const INDENT = '  ';

	let wrapper = $state<HTMLDivElement>();
	let scrollTop = $state(0);

	const lineCount = $derived(value.split('\n').length);
	const rows = $derived(Math.min(MAX_ROWS, Math.max(MIN_ROWS, lineCount)));
	const numbers = $derived(Array.from({ length: Math.max(rows, lineCount) }, (_, i) => i + 1));

	function textarea(): HTMLTextAreaElement | null {
		return wrapper?.querySelector('textarea') ?? null;
	}

	/** Writes `text` in place of the selection, keeps the caret after it, and reports the value. */
	function replaceSelection(el: HTMLTextAreaElement, text: string) {
		const start = el.selectionStart ?? el.value.length;
		const end = el.selectionEnd ?? start;
		const next = el.value.slice(0, start) + text + el.value.slice(end);
		el.value = next;
		const caret = start + text.length;
		el.setSelectionRange(caret, caret);
		// The kit binds its own value on the input event, so the write has to
		// arrive as one for the control and this component to agree.
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.focus();
	}

	/** Inserts at the cursor. A table name clicked in the panel lands where the reader was typing. */
	export function insert(text: string) {
		const el = textarea();
		if (!el) return;
		replaceSelection(el, text);
	}

	/** Selects the first line holding `needle` and scrolls it into view, so a problem can point at its line. */
	export function reveal(needle: string) {
		const el = textarea();
		if (!el) return;
		const at = el.value.indexOf(needle);
		if (at < 0) return;
		const start = el.value.lastIndexOf('\n', at) + 1;
		const lineEnd = el.value.indexOf('\n', at);
		const end = lineEnd < 0 ? el.value.length : lineEnd;
		el.focus();
		el.setSelectionRange(start, end);
		const line = el.value.slice(0, start).split('\n').length - 1;
		el.scrollTop = Math.max(0, line * 20 - el.clientHeight / 2);
		scrollTop = el.scrollTop;
	}

	function onKeyDown(e: KeyboardEvent) {
		if (readonly || e.key !== 'Tab' || e.shiftKey) return;
		const el = e.target as HTMLElement;
		if (el.tagName !== 'TEXTAREA') return;
		e.preventDefault();
		replaceSelection(el as HTMLTextAreaElement, INDENT);
	}

	function onScroll(e: Event) {
		const el = e.target as HTMLElement;
		if (el.tagName === 'TEXTAREA') scrollTop = el.scrollTop;
	}
</script>

<div class="flex flex-col gap-1.5" data-testid="code-editor" data-language={language}>
	<div class="flex items-center justify-between gap-2">
		<Label for={id} {required}>{label}</Label>
		<Badge size="sm">{language}</Badge>
	</div>
	<!-- The tables sit beside the editor where there is room and wrap under it
	     in a narrow inspector, so neither one is squeezed to a sliver. -->
	<div class="flex flex-wrap gap-3">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			bind:this={wrapper}
			class="group flex min-w-64 flex-1 basis-64 items-start rounded-lg"
			onkeydowncapture={onKeyDown}
			onscrollcapture={onScroll}
		>
			<!-- The gutter is the left part of the field's frame, so its border
			     follows the textarea's at rest, under the pointer and on focus.
			     A textarea in error keeps its red border and marks focus with a
			     1px ring inside it, so the gutter's ::after repeats that ring
			     along its side. -->
			<div
				class="relative shrink-0 select-none overflow-hidden rounded-l-lg border border-r-0 bg-surface-2 py-2 pl-2 pr-1.5 text-right font-mono text-sm leading-5 text-faint tabular-nums transition-colors after:pointer-events-none after:absolute after:inset-0 after:rounded-l-[7px] after:border after:border-r-0 after:border-transparent {error ? 'border-danger group-has-[textarea:focus-visible]:after:border-danger' : 'border-line group-has-[textarea:hover:not(:focus)]:border-line-strong group-has-[textarea:focus]:border-focus'}"
				style="height:{rows * 20 + 18}px"
				aria-hidden="true"
				data-testid="code-gutter"
			>
				<div style="transform: translateY(-{scrollTop}px)">
					{#each numbers as n (n)}
						<div>{n}</div>
					{/each}
				</div>
			</div>
			<Textarea
				{id}
				{value}
				{rows}
				{required}
				{placeholder}
				{error}
				{hint}
				{readonly}
				resize={false}
				class="min-w-0 flex-1 [&_textarea]:overflow-auto [&_textarea]:whitespace-pre [&_textarea]:rounded-l-none [&_textarea]:leading-5"
				oninput={(e) => oninput?.(e.currentTarget.value)}
				mono
			/>
		</div>
		{#if language === 'sql' && tables}
			<div class="h-72 grow basis-56 rounded-lg border border-line p-2">
				<TablesPanel {tables} oninsert={insert} {onretry} />
			</div>
		{/if}
	</div>
</div>
