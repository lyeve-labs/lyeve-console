<script lang="ts">
	import { Input } from '@lyeve-labs/ui-kit';
	import { ORGANIZATION_FROM_LINK_HINT, ORGANIZATION_HINT } from '#lib/organization.ts';

	interface Props {
		/** The organization the link to this page named, or an empty string. */
		carried: string;
		/** What the reader sent last, so a refused form keeps it. Null before any submit. */
		typed?: string | null;
	}

	let { carried, typed = null }: Props = $props();

	// A link only fills the field in. The reader sees what will be sent and can
	// change or clear it, so a crafted link cannot send a request on their
	// behalf to an organization they never chose.
	const shown = $derived(typed ?? carried);
</script>

<Input
	id="tenant"
	name="tenant"
	label="Organization (optional)"
	hint={carried ? ORGANIZATION_FROM_LINK_HINT : ORGANIZATION_HINT}
	autocomplete="organization"
	autocapitalize="none"
	spellcheck={false}
	value={shown}
/>
