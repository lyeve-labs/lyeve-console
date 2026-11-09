<script lang="ts">
	/**
	 * When an admin token expires: a preset, or a day picked up to 89 days out.
	 *
	 * The form submits the choice as `expiry` and a picked day as `expires_at`,
	 * the end of that day in the operator's own zone. It is computed here, in
	 * the browser, because the server does not know where the operator is, and
	 * a day that ends at UTC midnight ends at four in the afternoon for someone
	 * eight hours west of UTC.
	 */
	import { DatePicker, SegmentedControl } from '@lyeve-labs/ui-kit';
	import {
		CUSTOM_EXPIRY,
		EXPIRY_PRESETS,
		MAX_TOKEN_DAYS,
		customExpiryBounds,
		customExpiryProblem,
		endOfDayRFC3339,
	} from '$lib/api/admin-tokens';

	interface Props {
		id: string;
		/** The server's message for this field, if it refused one. */
		error?: string;
		/** Reports whether the choice is complete, for the submit button. */
		valid?: boolean;
	}

	let { id, error = undefined, valid = $bindable(true) }: Props = $props();

	const OPTIONS = [
		...EXPIRY_PRESETS.map((d) => ({ value: String(d), label: `${d} days` })),
		{ value: CUSTOM_EXPIRY, label: 'Choose a day' },
	];

	let choice = $state('30');
	let day = $state('');
	const bounds = customExpiryBounds();
	const custom = $derived(choice === CUSTOM_EXPIRY);
	const problem = $derived(custom ? customExpiryProblem(day) : '');
	$effect(() => {
		valid = !problem;
	});
</script>

<div class="flex flex-col gap-3">
	<SegmentedControl label="Expires" name="expiry" bind:value={choice} options={OPTIONS} />
	{#if custom}
		<DatePicker
			id="{id}-day"
			label="Expiry day"
			bind:value={day}
			min={bounds.min}
			max={bounds.max}
			placeholder="Choose a day"
			required
			hint="The token stops working at the end of this day, in your time zone. Tokens last at most {MAX_TOKEN_DAYS} days, so the latest day is {bounds.max}."
			error={error ?? (day ? problem || undefined : undefined)}
		/>
		<input type="hidden" name="expires_at" value={endOfDayRFC3339(day)} />
	{:else}
		<p class="text-xs text-muted">
			The token stops working {choice} days after it is issued.
			{#if error}<span class="text-danger">{error}</span>{/if}
		</p>
	{/if}
</div>
