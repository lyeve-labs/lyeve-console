<script lang="ts">
	import { Alert, Button, Spinner, Textarea } from '@lyeve-labs/ui-kit';
	import { Check, WandSparkles, X } from '@lucide/svelte';
	import { enhance } from '#lib/enhance.ts';
	import type { SubmitFunction } from '$app/forms';
	import CodeEditor from './CodeEditor.svelte';
	import Markdown from '#lib/components/Markdown.svelte';
	import NotEnabled from '#lib/components/NotEnabled.svelte';
	import { parseCost, type AssistProblem, type AssistUsage } from '#lib/api/assist.ts';
	import { AI_OFF_HREF, type AssistantAnswer, type AssistantDraft, type AssistantStatus } from '#lib/flow/assistant.ts';
	import { formatCount } from '#lib/format.ts';
	import { ICON } from '#lib/icon.ts';

	/**
	 * The Assistant tab of the editor drawer. The prompt on the left posts to
	 * the page's assist action. The right shows what came back: a YAML draft
	 * with the problems the validator still has with it, or a Markdown answer
	 * about a node or a problem. Nothing here reaches the engine on its own.
	 * The page owns every result and this renders it.
	 */
	interface Props {
		status: AssistantStatus;
		/** The sentence for `unavailable` and `error`. Empty otherwise. */
		message?: string;
		/** Which call is in flight, so the pane says what it waits for. */
		busy?: 'draft' | 'answer' | null;
		definitionJSON: string;
		conversationId?: string;
		prompt?: string;
		draft?: AssistantDraft | null;
		answer?: AssistantAnswer | null;
		onsubmit: SubmitFunction;
		onaccept: () => void;
		ondiscard: () => void;
		onclose: () => void;
		onreset: () => void;
		/** A problem's node was clicked. The page selects it when the canvas has it. */
		onproblem?: (problem: AssistProblem) => void;
	}

	let {
		status,
		message = '',
		busy = null,
		definitionJSON,
		conversationId = '',
		prompt = $bindable(''),
		draft = null,
		answer = null,
		onsubmit,
		onaccept,
		ondiscard,
		onclose,
		onreset,
		onproblem,
	}: Props = $props();

	let editor = $state<CodeEditor>();

	const gated = $derived(status === 'locked' || status === 'off');
	const problems = $derived(draft?.draft.problems ?? []);
	const acceptReason = $derived.by(() => {
		if (!draft) return '';
		if (!draft.draft.definition) return 'The assistant did not return a flow. Ask again.';
		if (problems.length > 0) {
			return `The draft has ${problems.length} problem${problems.length === 1 ? '' : 's'}. Ask the assistant to fix ${problems.length === 1 ? 'it' : 'them'} before accepting.`;
		}
		return '';
	});
	const usage = $derived<AssistUsage | null>(draft?.draft ?? answer?.answer ?? null);

	function usageLine(u: AssistUsage): string {
		const tokens = formatCount(u.tokens, '?');
		const dollars = parseCost(u.cost);
		const cost = dollars === null ? '' : `$${dollars.toFixed(4)}`;
		return [u.model, `${tokens} tokens`, cost].filter(Boolean).join(', ');
	}

	/** Puts the problem's line in view, and hands the node to the page. */
	function focusProblem(p: AssistProblem) {
		if (p.node_id) editor?.reveal(`id: ${p.node_id}`);
		onproblem?.(p);
	}

	/** Ctrl+Enter sends, so a prompt typed in the textarea does not need the pointer. */
	function sendOnEnter(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && prompt.trim() && !gated && !busy) {
			e.preventDefault();
			(e.currentTarget as HTMLFormElement).requestSubmit();
		}
	}
</script>

<div class="flex h-full min-h-0" data-testid="assistant-panel">
	<!-- The keydown is the Ctrl+Enter shortcut for the textarea inside, which the kit's control does not forward. -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form
		method="POST"
		action="?/assist"
		use:enhance={onsubmit}
		class="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line p-3 lg:w-80"
		data-testid="assist-form"
		onkeydown={sendOnEnter}
	>
		<input type="hidden" name="definition" value={definitionJSON} />
		<input type="hidden" name="conversation_id" value={conversationId} />
		<Textarea
			id="assist-prompt"
			name="prompt"
			label={conversationId ? 'Refine the draft' : 'Describe the flow'}
			hint={conversationId
				? 'A follow-up refines the same draft. Nothing is saved until you accept it and save.'
				: 'Say what starts the flow, what it reads and what it does. The flow on the canvas is sent with your request.'}
			rows={5}
			disabled={gated}
			bind:value={prompt}
		/>
		<div class="flex items-center gap-2">
			<Button variant="primary" type="submit" loading={busy === 'draft'} disabled={gated || busy !== null || !prompt.trim()}>
				<WandSparkles size={ICON.sm} />
				Send
			</Button>
			{#if conversationId}
				<Button variant="ghost" size="sm" type="button" onclick={onreset}>Start over</Button>
			{/if}
		</div>
		{#if usage}
			<p class="text-xs text-muted" data-testid="assist-usage">{usageLine(usage)}</p>
		{/if}
	</form>

	<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
		{#if status === 'locked'}
			<NotEnabled
				title="Flow assistant"
				description="Drafting and explaining flows with a language model is part of the AI plugin."
			/>
		{:else if status === 'off'}
			<Alert tone="info" title="The assistant is switched off">
				{#snippet children()}
					It is off for this tenant. Turn it on under <a class="text-brand underline" href={AI_OFF_HREF}>AI settings</a>.
				{/snippet}
			</Alert>
		{:else if status === 'unavailable'}
			<Alert tone="warn" title="The assistant is not available">
				{#snippet children()}{message}{/snippet}
			</Alert>
		{:else if status === 'error'}
			<Alert tone="danger" dismissible>
				{#snippet children()}{message}{/snippet}
			</Alert>
		{/if}

		{#if busy}
			<div class="flex items-center gap-2 text-sm text-muted" role="status" data-testid="assist-loading">
				<Spinner size={ICON.md} />
				{busy === 'draft' ? 'Drafting the flow' : 'Asking the assistant'}
			</div>
		{/if}

		{#if answer}
			<section class="flex flex-col gap-2" aria-label="Answer" data-testid="assist-answer">
				<div class="flex items-start justify-between gap-2">
					<p class="min-w-0 truncate text-xs text-faint">About <span class="font-mono text-muted">{answer.subject}</span></p>
					<Button variant="ghost" size="sm" aria-label="Close the answer" onclick={onclose}>
						<X size={ICON.sm} />
					</Button>
				</div>
				<Markdown source={answer.answer.answer} />
			</section>
		{/if}

		{#if draft}
			<section class="flex flex-wrap gap-3" aria-label="Draft" data-testid="assist-draft">
				<div class="min-w-64 flex-1 basis-64">
					<CodeEditor bind:this={editor} id="assist-yaml" label="Draft" language="yaml" value={draft.draft.yaml} readonly />
				</div>
				<div class="flex w-64 shrink-0 flex-col gap-2">
					<p class="text-xs text-faint">For: {draft.prompt}</p>
					{#if problems.length > 0}
						<ul class="flex flex-col gap-1 text-xs" aria-label="Draft problems" data-testid="assist-problems">
							{#each problems as p (p.path + p.message)}
								<li>
									<button type="button" class="flex w-full items-baseline gap-2 text-left hover:text-fg" onclick={() => focusProblem(p)}>
										<span class="shrink-0 font-mono text-danger">{p.node_id ?? 'flow'}{p.path}</span>
										<span class="min-w-0 text-muted">{p.message}</span>
									</button>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="text-xs text-success">This draft has no problems.</p>
					{/if}
					<div class="flex flex-wrap gap-2">
						<Button variant="primary" size="sm" disabled={acceptReason !== ''} title={acceptReason || 'Put the draft on the canvas'} onclick={onaccept}>
							<Check size={ICON.sm} />
							Accept
						</Button>
						<Button variant="secondary" size="sm" onclick={ondiscard}>
							<X size={ICON.sm} />
							Discard
						</Button>
					</div>
					{#if acceptReason}
						<p class="text-xs text-muted" data-testid="accept-reason">{acceptReason}</p>
					{/if}
				</div>
			</section>
		{/if}

		{#if !busy && !draft && !answer && status === 'idle'}
			<p class="text-sm text-muted" data-testid="assist-empty">
				Describe a flow and the assistant drafts it from the node types available here, or select a node and ask about it. Your prompt, the flow and the list of node types are sent to the AI provider set for this tenant, and nothing else is.
			</p>
		{/if}
	</div>
</div>
