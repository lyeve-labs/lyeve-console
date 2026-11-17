<script lang="ts">
	/**
	 * One editable setting: its control and its Save on a single baseline.
	 *
	 * A small Save beside a taller input, enabled on every row whether or not
	 * anything was typed, shows a page of ten settings with ten live Save
	 * buttons. The button here matches the control's height and stays disabled until the
	 * value differs from what is stored. A secret is write-only, so for it
	 * anything typed is a change.
	 *
	 * Each row is its own form on purpose. A setting saves independently and
	 * fails independently, and a page-wide form would turn one refused value
	 * into a page that could not save the nine others.
	 */
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { Button, Input, PasswordInput } from '@lyeve-labs/ui-kit';
	import { KeyRound } from '@lucide/svelte';
	import { ICON } from '#lib/icon.ts';

	interface Props {
		id: string;
		/** The setting's key, posted as `key`. */
		name: string;
		/** The accessible name of the control. */
		label: string;
		value?: string | null;
		secret?: boolean;
		/** The form action the row posts to. */
		action?: string;
		/** What a successful save says. */
		saved: string;
		/** The last save's outcome, matched to this row by key. */
		result?: { key?: string; error?: string; success?: boolean } | null;
	}

	let {
		id,
		name,
		label,
		value = '',
		secret = false,
		action = '?/save',
		saved,
		result = null,
	}: Props = $props();

	// Seeded from the stored value. A secret starts empty because it is never
	// sent back to the page.
	// svelte-ignore state_referenced_locally
	let draft = $state(secret ? '' : (value ?? ''));

	const dirty = $derived(secret ? draft.length > 0 : draft !== (value ?? ''));
	const mine = $derived(result?.key === name);

	// Cleared for the round trip so a second save of the same row changes the
	// live region's text, and a screen reader hears it again.
	let sending = $state(false);
	const submit: SubmitFunction = () => {
		sending = true;
		return async ({ update }) => {
			try {
				await update();
			} finally {
				sending = false;
			}
		};
	};
</script>

<form method="POST" {action} use:enhance={submit} class="flex flex-wrap items-start gap-2">
	<input type="hidden" name="key" value={name} />
	<input type="hidden" name="secret" value={secret ? 'true' : 'false'} />
	{#if secret}
		<PasswordInput
			{id}
			name="value"
			{label}
			labelHidden
			hint="Write-only. Enter a new value to replace the stored one."
			controlClass="font-mono"
			class="min-w-64 flex-1"
			bind:value={draft}
		/>
	{:else}
		<Input {id} name="value" aria-label={label} class="min-w-64 flex-1" bind:value={draft} />
	{/if}
	<Button type="submit" variant="secondary" disabled={!dirty}>Save</Button>
	{#if secret}
		<span class="basis-full text-xs text-faint">
			<KeyRound size={ICON.xs} class="inline" aria-hidden="true" /> write-only
		</span>
	{/if}
</form>
{#if mine && result?.error}
	<p class="mt-2 text-xs text-danger" role="alert">{result.error}</p>
{/if}
<!-- One element is both the message and the live region, on the page and
     empty until the row saves, because a screen reader announces a region
     only when text arrives in one already there. Empty, it is visually hidden
     and adds no gap to a parent's flex column. A div because in Firefox Orca
     drops a quick insertion into a paragraph, and no status role because Orca
     reads a status bar as chrome and says nothing. -->
<div class="mt-2 text-xs text-success empty:sr-only" aria-live="polite" aria-atomic="true" data-testid="setting-saved-{name}">{#if mine && result?.success && !sending}{saved}{/if}</div>
