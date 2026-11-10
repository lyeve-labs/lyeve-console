<script lang="ts">
	import { onMount } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import {
		Bold, Italic, Underline, Strikethrough,
		List, ListOrdered,
		Heading1, Heading2, Heading3,
		Code, SquareCode, Quote, Minus,
		Link, Unlink,
		Undo2, Redo2,
	} from '@lucide/svelte';
	import { Button, Input, assistField, closeDialog, dismissDialog, openDialog } from '@lyeve-labs/ui-kit';
	import { ICON } from '$lib/icon';
	import AssistChoice from './AssistChoice.svelte';

	let {
		value = $bindable(''),
		required = false,
		id,
		label,
		name,
		hint,
		noAI = false,
	}: {
		value?: string;
		required?: boolean;
		id?: string;
		/**
		 * TipTap edits a contenteditable div, and `<label for>` only binds to
		 * labelable elements, so the field's visible label never named this
		 * control. The name is carried here instead.
		 */
		label?: string;
		/** The key a FormAssist knows the field by. Without one the editor does not register. */
		name?: string;
		/** A sentence under the editor, which the assistant also follows. */
		hint?: string;
		/** Keeps the document from an assistant: it is never reported or filled. */
		noAI?: boolean;
	} = $props();

	// The kit's controls register themselves, and this editor is not one of
	// them. A suggestion is HTML, written into `value`, which the effect
	// below hands to the editor.
	const assist = assistField({
		get name() {
			return name;
		},
		get label() {
			return label;
		},
		get hint() {
			return hint;
		},
		kind: 'multiline',
		get required() {
			return required;
		},
		get noAI() {
			return noAI;
		},
		get value() {
			return value ?? '';
		},
		set value(v) {
			value = v as string;
		},
	});
	const hintId = $derived(id ? `${id}-hint` : undefined);

	let editorEl: HTMLDivElement;
	let editor = $state<Editor | null>(null);

	let editorState = $state({
		bold: false,
		italic: false,
		underline: false,
		strike: false,
		h1: false,
		h2: false,
		h3: false,
		bulletList: false,
		orderedList: false,
		code: false,
		codeBlock: false,
		blockquote: false,
		link: false,
		canUndo: false,
		canRedo: false,
	});

	function syncState() {
		if (!editor) return;
		editorState = {
			bold: editor.isActive('bold'),
			italic: editor.isActive('italic'),
			underline: editor.isActive('underline'),
			strike: editor.isActive('strike'),
			h1: editor.isActive('heading', { level: 1 }),
			h2: editor.isActive('heading', { level: 2 }),
			h3: editor.isActive('heading', { level: 3 }),
			bulletList: editor.isActive('bulletList'),
			orderedList: editor.isActive('orderedList'),
			code: editor.isActive('code'),
			codeBlock: editor.isActive('codeBlock'),
			blockquote: editor.isActive('blockquote'),
			link: editor.isActive('link'),
			canUndo: editor.can().undo(),
			canRedo: editor.can().redo(),
		};
	}

	let mounted = $state(true);

	onMount(() => {
		let instance: Editor;

		Promise.all([
			import('@tiptap/core'),
			import('@tiptap/starter-kit'),
			import('@tiptap/extension-link'),
			import('@tiptap/extension-underline'),
		]).then(([{ Editor }, { default: StarterKit }, { default: LinkExt }, { default: UnderlineExt }]) => {
			if (!mounted) return;
			instance = new Editor({
				element: editorEl,
				extensions: [
					StarterKit,
					LinkExt.configure({ openOnClick: false }),
					UnderlineExt,
				],
				content: value ?? '',
				onUpdate: ({ editor: e }) => {
					value = e.getHTML();
					syncState();
				},
				onTransaction: syncState,
				onSelectionUpdate: syncState,
			});
			editor = instance;
			syncState();
		});

		return () => {
			mounted = false;
			instance?.destroy();
		};
	});

	// Content passed to the Editor constructor is a snapshot. Without this, a
	// value replaced by the parent (loading another entry, restoring a revision)
	// never reaches the editor and the field keeps showing the old document.
	// emitUpdate: false keeps this write from echoing back into `value`.
	$effect(() => {
		const next = value ?? '';
		if (!editor || editor.getHTML() === next) return;
		editor.commands.setContent(next, { emitUpdate: false });
	});

	const linkId = $props.id();
	let linkUrl = $state('');

	async function handleSetLink() {
		const existing: string = editor?.getAttributes('link').href ?? '';
		linkUrl = existing;
		const ok = await openDialog<boolean>({
			title: linkLabel,
			body: linkBody,
			footer: linkFooter,
			size: 'sm',
		}).catch(() => false);
		if (!ok) return;
		const url = linkUrl.trim();
		if (url === '') {
			editor?.chain().focus().unsetLink().run();
		} else {
			editor?.chain().focus().setLink({ href: url }).run();
		}
	}

	/*
	 * Sized from --spacing-control, the token every single-line control in the
	 * kit takes its height from, rather than from a literal. A literal cannot
	 * follow the token when the token moves, so the toolbar would drift away
	 * from the controls beside it. And these buttons sit against each other in
	 * a row with no gap to borrow, so SC 2.5.8's spacing exception does not
	 * apply and a 28px square leaves only 4px over the 24px floor.
	 *
	 * The kit ships no icon-square button. Its sm size is padding-driven and
	 * would make seventeen of these far wider than the field, so the toolbar
	 * keeps its own, reading the same token.
	 */
	const btn =
		'flex items-center justify-center h-control w-control rounded-md text-muted hover:text-fg hover:bg-line transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted';
	const btnOn = 'bg-brand !text-ink hover:!bg-brand';
	const sep = 'w-px h-4 bg-line mx-0.5 shrink-0';

	/*
	 * The link button is the one control whose name depends on the selection, so
	 * its two spellings live here. Everywhere else the name is a literal, and
	 * `title` repeats it: a screen reader reads aria-label, and a pointer user
	 * gets nothing at all without the tooltip. Both are set from the same string
	 * at every call site so the two cannot drift.
	 */
	const linkLabel = $derived(editorState.link ? 'Edit link' : 'Insert link');
</script>

{#snippet linkBody()}
	<Input id={linkId} type="url" label="URL" hint="Leave it empty to remove the link." bind:value={linkUrl} />
{/snippet}

{#snippet linkFooter()}
	<Button variant="secondary" size="sm" onclick={() => dismissDialog()}>Cancel</Button>
	<Button size="sm" onclick={() => closeDialog(true)}>Save</Button>
{/snippet}

<AssistChoice field={assist} />
<div
	class="border rounded-lg overflow-hidden focus-within:border-focus transition-colors {assist.suggested ? 'border-violet' : 'border-line-strong'}"
>
	<div class="flex flex-wrap items-center gap-0.5 px-2 py-1.5 bg-surface border-b border-line select-none">

		<button type="button" aria-label="Undo" title="Undo"
			class="{btn}" disabled={!editorState.canUndo}
			onclick={() => editor?.chain().focus().undo().run()}>
			<Undo2 size={ICON.sm} />
		</button>
		<button type="button" aria-label="Redo" title="Redo"
			class="{btn}" disabled={!editorState.canRedo}
			onclick={() => editor?.chain().focus().redo().run()}>
			<Redo2 size={ICON.sm} />
		</button>

		<span class={sep}></span>

		<button type="button" aria-label="Bold" title="Bold"
			class="{btn} {editorState.bold ? btnOn : ''}"
			onclick={() => editor?.chain().focus().toggleBold().run()}>
			<Bold size={ICON.sm} />
		</button>
		<button type="button" aria-label="Italic" title="Italic"
			class="{btn} {editorState.italic ? btnOn : ''}"
			onclick={() => editor?.chain().focus().toggleItalic().run()}>
			<Italic size={ICON.sm} />
		</button>
		<button type="button" aria-label="Underline" title="Underline"
			class="{btn} {editorState.underline ? btnOn : ''}"
			onclick={() => editor?.chain().focus().toggleUnderline().run()}>
			<Underline size={ICON.sm} />
		</button>
		<button type="button" aria-label="Strikethrough" title="Strikethrough"
			class="{btn} {editorState.strike ? btnOn : ''}"
			onclick={() => editor?.chain().focus().toggleStrike().run()}>
			<Strikethrough size={ICON.sm} />
		</button>

		<span class={sep}></span>

		<button type="button" aria-label="Heading 1" title="Heading 1"
			class="{btn} {editorState.h1 ? btnOn : ''}"
			onclick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>
			<Heading1 size={ICON.sm} />
		</button>
		<button type="button" aria-label="Heading 2" title="Heading 2"
			class="{btn} {editorState.h2 ? btnOn : ''}"
			onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
			<Heading2 size={ICON.sm} />
		</button>
		<button type="button" aria-label="Heading 3" title="Heading 3"
			class="{btn} {editorState.h3 ? btnOn : ''}"
			onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>
			<Heading3 size={ICON.sm} />
		</button>

		<span class={sep}></span>

		<button type="button" aria-label="Bullet list" title="Bullet list"
			class="{btn} {editorState.bulletList ? btnOn : ''}"
			onclick={() => editor?.chain().focus().toggleBulletList().run()}>
			<List size={ICON.sm} />
		</button>
		<button type="button" aria-label="Ordered list" title="Ordered list"
			class="{btn} {editorState.orderedList ? btnOn : ''}"
			onclick={() => editor?.chain().focus().toggleOrderedList().run()}>
			<ListOrdered size={ICON.sm} />
		</button>

		<span class={sep}></span>

		<button type="button" aria-label="Inline code" title="Inline code"
			class="{btn} {editorState.code ? btnOn : ''}"
			onclick={() => editor?.chain().focus().toggleCode().run()}>
			<Code size={ICON.sm} />
		</button>
		<button type="button" aria-label="Code block" title="Code block"
			class="{btn} {editorState.codeBlock ? btnOn : ''}"
			onclick={() => editor?.chain().focus().toggleCodeBlock().run()}>
			<SquareCode size={ICON.sm} />
		</button>
		<button type="button" aria-label="Blockquote" title="Blockquote"
			class="{btn} {editorState.blockquote ? btnOn : ''}"
			onclick={() => editor?.chain().focus().toggleBlockquote().run()}>
			<Quote size={ICON.sm} />
		</button>
		<button type="button" aria-label="Horizontal rule" title="Horizontal rule"
			class={btn}
			onclick={() => editor?.chain().focus().setHorizontalRule().run()}>
			<Minus size={ICON.sm} />
		</button>

		<span class={sep}></span>

		<button type="button" aria-label={linkLabel} title={linkLabel}
			class="{btn} {editorState.link ? btnOn : ''}"
			onclick={handleSetLink}>
			<Link size={ICON.sm} />
		</button>
		{#if editorState.link}
			<button type="button" aria-label="Remove link" title="Remove link"
				class={btn}
				onclick={() => editor?.chain().focus().unsetLink().run()}>
				<Unlink size={ICON.sm} />
			</button>
		{/if}
	</div>

	<!-- ProseMirror mount point -->
	<div
		bind:this={editorEl}
		{id}
		role="textbox"
		aria-multiline="true"
		aria-label={label}
		aria-required={required ? 'true' : undefined}
		aria-describedby={hint ? hintId : undefined}
		class="rte bg-surface-2 text-fg text-sm min-h-40"
	></div>
</div>
{#if hint}
	<p id={hintId} class="text-xs text-muted">{hint}</p>
{/if}
