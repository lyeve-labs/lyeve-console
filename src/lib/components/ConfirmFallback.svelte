<!--
  The question for a write that asks first, when its post arrived without the
  reader's answer: a click before the page hydrated, or with scripts off. The
  action ran nothing, and this form posts the same fields again with the
  confirmation, so the reader still finishes in two steps.
-->
<script lang="ts">
	import { enhance } from '#lib/enhance.ts';
	import { page } from '$app/state';
	import { Banner, Button } from '@lyeve-labs/ui-kit';
	import { CONFIRM_FIELD, CONFIRMED, unconfirmedOf } from '#lib/confirmation.ts';

	const ask = $derived(unconfirmedOf(page.form));

	// The post went to the list's own address with the action added as a key
	// that starts with a slash. Cancel returns to the list as it was, so it
	// keeps the filters and the page and leaves the action out.
	const back = $derived.by(() => {
		const query = new URLSearchParams(page.url.search);
		for (const key of [...query.keys()]) if (key.startsWith('/')) query.delete(key);
		const rest = query.toString();
		return rest ? `${page.url.pathname}?${rest}` : page.url.pathname;
	});
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
				<Button variant="ghost" size="sm" href={back}>Cancel</Button>
			</form>
		{/snippet}
	</Banner>
{/if}
