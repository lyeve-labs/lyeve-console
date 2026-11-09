<!--
  The question for a write that asks first, when its post arrived without the
  reader's answer: a click before the page hydrated, or with scripts off. The
  action ran nothing, and this form posts the same fields again with the
  confirmation, so the reader still finishes in two steps.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { Banner, Button } from '@lyeve-labs/ui-kit';
	import { CONFIRM_FIELD, CONFIRMED, unconfirmedOf } from '$lib/confirmation';

	const ask = $derived(unconfirmedOf(page.form));
</script>

{#if ask}
	<Banner tone="warn">
		<span class="font-medium">{ask.question}</span>
		{#if ask.detail}{ask.detail}{/if}
		{#snippet action()}
			<form method="POST" action={ask.action} use:enhance class="flex gap-2">
				{#each ask.fields as [name, value], i (i)}
					<input type="hidden" {name} {value} />
				{/each}
				<input type="hidden" name={CONFIRM_FIELD} value={CONFIRMED} />
				<Button variant="danger" size="sm" type="submit">{ask.label}</Button>
				<Button variant="ghost" size="sm" href={page.url.pathname}>Cancel</Button>
			</form>
		{/snippet}
	</Banner>
{/if}
