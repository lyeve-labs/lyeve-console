<script lang="ts">
	/**
	 * What a page shows in place of what a refused read would have filled,
	 * the same way for every page. The page names the feature and says in its
	 * own words what a missing route means for it.
	 *
	 * The kit draws the notice. This supplies the console's words for each
	 * state and its own not-enabled card, so a refusal reads the same here as
	 * on every surface built on the kit.
	 */
	import { GateNotice, type Gate as KitGate, type GateWords } from '@lyeve-labs/ui-kit';
	import { page } from '$app/state';
	import NotEnabled from '#lib/components/NotEnabled.svelte';
	import { BUSY, OUTAGE, outageFor } from '#lib/outage.ts';
	import { forbiddenText, fullText, inSentence, type Gate } from '#lib/api/gate.ts';

	let {
		gate,
		title,
		absent,
		level = 3,
	}: {
		gate: Gate;
		/** The feature's name. */
		title: string;
		/** What the page says when the route is not there. */
		absent: string;
		/**
		 * The heading level of the not-enabled state's title. 3 by default, for
		 * a notice inside a section. A caller placed straight under the page
		 * title passes 2.
		 */
		level?: 2 | 3;
	} = $props();

	// The title opens a heading, but these sentences name the feature mid-way.
	const subject = $derived(inSentence(title));

	// A plain link to this address works before the page hydrates.
	const here = $derived(`${page.url.pathname}${page.url.search}`);

	const words = $derived<GateWords>({
		absent,
		full: { title: `Limit reached for ${subject}`, body: gate.state === 'full' ? fullText(gate) : '' },
		forbidden: forbiddenText(subject),
		busy: { title: BUSY.title, body: BUSY.body },
		// The page around this notice rendered, so unlike the full-page outage
		// it names only the part that could not be read.
		unavailable: { title: OUTAGE.title, body: outageFor(`${subject} did not load`) },
		retry: OUTAGE.action,
	});

	const shown = $derived<KitGate>(gate.state === 'locked' ? { state: 'locked', forwardHref: gate.upgradeUrl } : gate);
</script>

{#snippet locked(forwardHref: string)}
	<NotEnabled {title} {level} url={forwardHref} />
{/snippet}

<GateNotice gate={shown} {words} {locked} retryHref={here} />
