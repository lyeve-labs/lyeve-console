<script lang="ts">
	/**
	 * The assistant, docked in the shell's panel.
	 *
	 * Every text the assistant sends is drawn as plain text. Nothing in a reply
	 * is read as Markdown or HTML, so a reply cannot show an image, load a file
	 * or carry a link the reader did not type. A request it proposes is shown
	 * in full, method, path, query and body, before the reader runs it.
	 */
	import { Alert, Badge, Button, EmptyState, Textarea, type StatusTone } from '@lyeve-labs/ui-kit';
	import { ArrowUp, Check, Circle, CircleDot, Square, SquarePen, X } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { methodTone } from '$lib/tones';
	import type { AssistantSession, PageContext } from '$lib/assistant/session.svelte';
	import { refusalSentence, retryable } from '$lib/assistant/refusal';
	import type { ApiProposal } from '$lib/assistant/events';
	import type { Action } from 'svelte/action';

	let {
		session,
		administrator,
		page,
		onclose,
	}: {
		session: AssistantSession;
		/** An admin or a super admin, who can change what refuses the assistant. */
		administrator: boolean;
		/** The page the reader has open, read when a message is sent. */
		page: () => PageContext;
		onclose?: () => void;
	} = $props();

	let prompt = $state('');

	function send(text = prompt) {
		if (text.trim() === '' || session.working) return;
		void session.ask(text, page());
		prompt = '';
	}

	// Enter sends and Shift+Enter starts a new line. The kit's Textarea takes
	// no key handler, so the composer form listens for the key as it bubbles.
	const enterSends: Action<HTMLFormElement> = (node) => {
		const keydown = (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target instanceof HTMLTextAreaElement) {
				e.preventDefault();
				send();
			}
		};
		node.addEventListener('keydown', keydown);
		return { destroy: () => node.removeEventListener('keydown', keydown) };
	};

	/** What a proposed request does, in the reader's words, from the effect its operation states. */
	function effectWords(p: ApiProposal): { label: string; tone: StatusTone } {
		switch (p.effect) {
			case 'read':
				return { label: 'Changes nothing', tone: 'neutral' };
			case 'draft':
				return { label: 'Saves a draft', tone: 'neutral' };
			case 'delete':
				return { label: 'Deletes data', tone: 'danger' };
			case 'outbound':
				return { label: 'Sends data out of the engine', tone: 'warn' };
			default:
				return { label: 'Changes data', tone: 'warn' };
		}
	}

	const json = (v: unknown) => JSON.stringify(v, null, 2);
	const shown = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

	const refusalText = $derived(
		session.refusal === 'offline'
			? "You're offline. Ask again once you reconnect."
			: session.refusal
				? refusalSentence(session.refusal, administrator)
				: '',
	);
	const offerRetry = $derived(session.refusal === 'offline' || (session.refusal !== null && retryable(session.refusal)));
	const offerSettings = $derived(administrator && (session.refusal === 'assistant_off' || session.refusal === 'ai_off'));
	const stepsDone = $derived(session.steps.filter((s) => s.status !== 'running').length);
</script>

<div class="flex min-h-0 flex-1 flex-col" data-testid="assistant-panel">
	<!-- Below lg the shell draws the drawer's own title and close. -->
	<div class="hidden h-14 shrink-0 items-center gap-2 border-b border-line px-4 lg:flex">
		<h2 class="flex-1 text-sm font-semibold text-fg">Assistant</h2>
		{#if session.turns.length > 0}
			<Button variant="ghost" size="icon" aria-label="New conversation" onclick={() => session.reset()}>
				<SquarePen size={ICON.sm} aria-hidden="true" />
			</Button>
		{/if}
		{#if onclose}
			<Button variant="ghost" size="icon" aria-label="Close the assistant" onclick={onclose}>
				<X size={ICON.sm} aria-hidden="true" />
			</Button>
		{/if}
	</div>

	<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" aria-live="polite" aria-busy={session.working}>
		{#if session.turns.length === 0 && session.status !== 'refused'}
			<EmptyState
				title="Ask the assistant"
				description="Ask about this page or the engine. Any change waits for you to review it."
			/>
		{/if}

		{#each session.turns as turn (turn.id)}
			{#if turn.kind === 'person'}
				<p class="ms-8 self-end whitespace-pre-wrap break-words rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg" data-turn="person">{turn.text}</p>
			{:else if turn.kind === 'message'}
				<p class="whitespace-pre-wrap break-words text-sm text-fg" data-turn="message">{turn.text}</p>
			{:else if turn.kind === 'failure'}
				<Alert tone="danger">
					<span>{turn.text}</span>
				</Alert>
			{:else if turn.kind === 'form'}
				<section class="rounded-lg border border-line" data-turn="form">
					<div class="flex items-center gap-2 border-b border-line px-3 py-2">
						<h3 class="min-w-0 flex-1 truncate text-sm font-semibold text-fg">Suggested values for {turn.form || 'the form'}</h3>
						{#if turn.applied.length > 0}
							<Badge tone="violet" size="sm">In the form</Badge>
						{/if}
					</div>
					<dl class="divide-y divide-line text-sm">
						{#each turn.values as v (v.name)}
							<div class="px-3 py-2">
								<dt class="font-mono text-xs text-muted">{v.name}</dt>
								<dd class="whitespace-pre-wrap break-words text-fg">{shown(v.value)}</dd>
								{#if v.reason}
									<dd class="text-xs text-muted">{v.reason}</dd>
								{/if}
							</div>
						{/each}
					</dl>
					<p class="border-t border-line px-3 py-2 text-xs text-muted">
						{#if turn.applied.length > 0 && turn.skipped.length === 0}
							Accept or reject each value in the form, then save there.
						{:else if turn.applied.length > 0}
							Accept or reject each value in the form, then save there. Not filled: {turn.skipped.join(', ')}.
						{:else}
							None of these went into a form. Open the form and ask again.
						{/if}
					</p>
				</section>
			{:else if turn.kind === 'proposal'}
				{@const p = turn.proposal}
				{@const effect = effectWords(p)}
				<section class="rounded-lg border border-line" data-turn="proposal">
					<div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
						<h3 class="min-w-0 flex-1 text-sm font-semibold text-fg">Request to review</h3>
						<Badge tone={effect.tone} size="sm">{effect.label}</Badge>
					</div>
					<div class="flex flex-col gap-2 px-3 py-2 text-sm">
						<p class="flex flex-wrap items-center gap-2">
							<Badge tone={methodTone(p.method)} size="sm">{p.method}</Badge>
							<code class="break-all font-mono text-xs text-fg" data-testid="proposal-path">{p.path}</code>
						</p>
						{#if p.query && Object.keys(p.query).length > 0}
							<div>
								<p class="text-xs font-medium text-muted">Query</p>
								<pre class="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-2 p-2 font-mono text-xs text-fg" data-testid="proposal-query">{json(p.query)}</pre>
							</div>
						{/if}
						{#if p.body !== undefined}
							<div>
								<p class="text-xs font-medium text-muted">Body</p>
								<pre class="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-2 p-2 font-mono text-xs text-fg" data-testid="proposal-body">{json(p.body)}</pre>
							</div>
						{/if}
						{#if p.effect === 'delete' && turn.state === 'waiting'}
							<p class="text-xs text-danger">This deletes data and cannot be undone.</p>
						{:else if p.effect === 'outbound' && turn.state === 'waiting'}
							<p class="text-xs text-warn">This sends data outside the engine.</p>
						{/if}
					</div>
					<div class="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
						{#if turn.state === 'waiting' || turn.state === 'running'}
							<Button
								size="sm"
								variant={p.effect === 'delete' ? 'danger' : 'primary'}
								loading={turn.state === 'running'}
								onclick={() => session.run(turn.id)}
							>
								Run
							</Button>
							<Button size="sm" variant="ghost" disabled={turn.state === 'running'} onclick={() => session.reject(turn.id)}>Reject</Button>
						{:else if turn.state === 'rejected'}
							<p class="text-xs text-muted">Rejected. Nothing was sent.</p>
						{:else}
							<p class="text-xs {turn.state === 'failed' ? 'text-danger' : 'text-muted'}">{turn.outcome}</p>
						{/if}
					</div>
				</section>
			{/if}
		{/each}

		{#if session.plan.length > 0}
			<section class="rounded-lg border border-line" data-testid="assistant-plan">
				<h3 class="border-b border-line px-3 py-2 text-sm font-semibold text-fg">To do</h3>
				<ul class="flex flex-col gap-2 px-3 py-2 text-sm">
					{#each session.plan as entry, i (i)}
						<li class="flex items-start gap-2">
							<span class="mt-0.5 shrink-0 {entry.status === 'done' ? 'text-success' : entry.status === 'now' ? 'text-brand' : 'text-faint'}" aria-hidden="true">
								{#if entry.status === 'done'}
									<Check size={ICON.sm} />
								{:else if entry.status === 'now'}
									<CircleDot size={ICON.sm} />
								{:else}
									<Circle size={ICON.sm} />
								{/if}
							</span>
							<span class="min-w-0 flex-1">
								<span class="block whitespace-pre-wrap break-words text-fg {entry.status === 'done' ? 'line-through decoration-faint' : ''}">{entry.title}</span>
								{#if entry.detail}
									<span class="block whitespace-pre-wrap break-words text-xs text-muted">{entry.detail}</span>
								{/if}
							</span>
							<Badge tone={entry.status === 'done' ? 'success' : entry.status === 'now' ? 'brand' : 'neutral'} size="sm">
								{entry.status === 'done' ? 'Done' : entry.status === 'now' ? 'Now' : 'Next'}
							</Badge>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if session.working}
			<p class="text-xs text-muted" data-testid="assistant-working">
				Working{session.steps.length > 0 ? `, ${stepsDone} of ${session.steps.length} steps done: ${session.steps[session.steps.length - 1].title}` : ''}
			</p>
		{:else if session.status === 'stopped'}
			<p class="text-xs text-muted">Stopped. Anything the assistant had not finished was not done.</p>
		{:else if session.status === 'failed'}
			<div>
				<Button size="sm" variant="secondary" onclick={() => send(session.lastPrompt)}>Try again</Button>
			</div>
		{/if}

		{#if session.status === 'refused'}
			<Alert tone={offerRetry ? 'danger' : 'warn'}>
				<span data-testid="assistant-refusal">{refusalText}</span>
			</Alert>
			{#if offerSettings}
				<div><Button size="sm" variant="secondary" href="/admin/ai/settings">Open AI settings</Button></div>
			{:else if offerRetry}
				<div><Button size="sm" variant="secondary" onclick={() => send(session.lastPrompt)}>Try again</Button></div>
			{/if}
		{/if}

		{#if session.usage && !session.working}
			<p class="text-xs text-faint">{session.usage.model}, {session.usage.tokens_in + session.usage.tokens_out} tokens{session.usage.cost ? `, $${session.usage.cost}` : ''}</p>
		{/if}
	</div>

	<form
		class="flex shrink-0 flex-col gap-2 border-t border-line p-3"
		onsubmit={(e) => {
			e.preventDefault();
			send();
		}}
		use:enterSends
	>
		<Textarea label="Message" rows={3} bind:value={prompt} hint="Enter sends. Shift+Enter starts a new line." />
		<div class="flex items-center justify-end gap-2">
			{#if session.working}
				<Button size="sm" variant="secondary" onclick={() => session.stop()}>
					<Square size={ICON.sm} aria-hidden="true" />
					Stop
				</Button>
			{:else}
				<Button size="sm" type="submit" disabled={prompt.trim() === ''}>
					<ArrowUp size={ICON.sm} aria-hidden="true" />
					Send
				</Button>
			{/if}
		</div>
	</form>
</div>
