<script lang="ts">
	/** The warning every lab opens with, because none of them is a sandbox. */
	import { Alert } from '@lyeve-labs/ui-kit';
</script>

<!-- The one thing a tester has to understand before the first send. -->
<Alert tone="warn">
	Every request goes to the engine you are signed in to, as you. There is no sandbox, so a
	write changes data and a delete removes it.
</Alert>
