<script lang="ts">
	import { Badge, Button, Collapsible, EmptyState } from '@lyeve-labs/ui-kit';
	import {
		AlertTriangle,
		ArrowLeft,
		FileQuestion,
		Home,
		Hourglass,
		Lock,
		RefreshCw,
		ServerOff,
		ShieldOff,
	} from '@lucide/svelte';
	import { page } from '$app/state';
	import { ICON } from '$lib/icon';
	import { BUSY, OUTAGE } from '$lib/outage';
	import { SESSION_ENDED } from '$lib/session';

	/**
	 * What the reader is told when a page cannot be served.
	 *
	 * Both `+error.svelte` files render this one component, so the same 404
	 * leads with the same action wherever it is served. It is built from the
	 * kit's own empty state and badge rather than from a hand-rolled copy of
	 * each, so the worst page a reader
	 * meets is the one that looks most like the rest of the product.
	 */
	interface Props {
		status: number;
		/** The engine's own words, when it sent any. */
		message?: string;
		/** Where "home" is: the console for a signed-in reader, the site otherwise. */
		homeHref: string;
		homeLabel: string;
		/**
		 * The heading level of the title. 3 by default, for a block inside a
		 * section. A caller placed straight under the page title passes 2.
		 */
		level?: 2 | 3;
	}

	let { status, message = '', homeHref, homeLabel, level = 3 }: Props = $props();

	/*
	 * A 401 is a session the engine no longer honors, and signing in again is
	 * the way back. A 402 or a 403 is a reader the engine knows and refuses, a
	 * full instance or a rule, so the session is fine and signing in again
	 * would change nothing. A 429 is the engine refusing for the request rate.
	 * A 503 is an engine or a database that did not answer. Both are temporary
	 * and the session survives them, so each gets a retry rather than the face
	 * for a request that failed.
	 */
	type Variant = 'signed-out' | 'denied' | 'missing' | 'busy' | 'outage' | 'server';
	const VARIANTS: Partial<Record<number, Variant>> = {
		401: 'signed-out',
		402: 'denied',
		403: 'denied',
		404: 'missing',
		429: 'busy',
		503: 'outage',
	};
	const variant = $derived<Variant>(VARIANTS[status] ?? 'server');

	// Derived, not a literal: a plain object is built once and would keep the
	// status the page first rendered with.
	const Icon = $derived(
		{
			'signed-out': Lock,
			denied: ShieldOff,
			missing: FileQuestion,
			busy: Hourglass,
			outage: ServerOff,
			server: AlertTriangle,
		}[variant],
	);
	const tones = {
		'signed-out': 'warn',
		denied: 'warn',
		missing: 'neutral',
		busy: 'warn',
		outage: 'warn',
		server: 'danger',
	} as const;

	const title = $derived(
		{
			'signed-out': 'Not signed in',
			denied: 'Access denied',
			missing: 'Not found',
			busy: BUSY.title,
			outage: OUTAGE.title,
			server: 'Could not complete the request',
		}[variant],
	);

	/**
	 * No offer of support, because there is nothing here to reach it by. A
	 * sentence that tells a reader to contact somebody, and then does not say
	 * who, spends their patience and gives nothing back.
	 *
	 * A refusal keeps the words the load gave it, such as the role a page
	 * needs, because that is the one thing the reader can act on.
	 */
	const hint = $derived(
		{
			'signed-out': SESSION_ENDED,
			denied: message || 'You do not have access to this page.',
			missing: message || 'That page or record does not exist.',
			busy: message || BUSY.body,
			outage: OUTAGE.body,
			server: 'Try again. If it fails again, the details below show what the engine returned.',
		}[variant],
	);

	// The address that failed, query included. A link rather than a click
	// handler, so the retry works before the page hydrates. After it hydrates,
	// the link asks for a fresh document: the router would run only the load
	// that failed again, and keep whatever the shell read during the outage.
	const retryHref = $derived(page.url.pathname + page.url.search);
</script>

<EmptyState {title} {level} description={hint}>
	{#snippet iconSnippet()}
		<Icon size={ICON.lg} />
	{/snippet}

	{#snippet children()}
		<div class="flex flex-col items-center gap-3">
			<Badge tone={tones[variant]}>{status}</Badge>
			{#if variant === 'server'}
				<!-- Shut by default: a stack trace is the first thing on screen only
				     for the reader who went looking for it. -->
				<Collapsible label="What the engine returned" class="w-full text-left">
					<pre
						class="border-line bg-surface-2 text-muted max-h-32 overflow-auto rounded-lg border p-3 text-xs">{message ||
							'No details.'}</pre>
				</Collapsible>
			{/if}
		</div>
	{/snippet}

	{#snippet action()}
		<div class="flex items-center gap-3">
			{#if variant === 'signed-out'}
				<!-- There is a right answer here, so one control carries it. Three
				     equal-weight secondaries offer a choice the reader does not have. -->
				<Button href="/login">
					<Lock size={ICON.sm} aria-hidden="true" /> Sign in
				</Button>
				<Button variant="secondary" href={homeHref}>
					<Home size={ICON.sm} aria-hidden="true" /> {homeLabel}
				</Button>
			{:else if variant === 'outage' || variant === 'busy'}
				<!-- The one control is the retry. Every other page needs the same
				     engine, and signing in again cannot help until it answers. -->
				<Button href={retryHref} data-sveltekit-reload>
					<RefreshCw size={ICON.sm} aria-hidden="true" /> {OUTAGE.action}
				</Button>
			{:else}
				<Button href={homeHref}>
					<Home size={ICON.sm} aria-hidden="true" /> {homeLabel}
				</Button>
				<Button variant="secondary" onclick={() => history.back()}>
					<ArrowLeft size={ICON.sm} aria-hidden="true" /> Go back
				</Button>
			{/if}
		</div>
	{/snippet}
</EmptyState>
