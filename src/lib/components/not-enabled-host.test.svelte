<!-- Provides the instance the way the layout does, so a case can say what the
     engine and the license module sent and read what the locked state makes
     of it. -->
<script lang="ts">
	import NotEnabled from './NotEnabled.svelte';
	import { provideInstance } from '#lib/instance.svelte.ts';
	import type { Licensing } from '#lib/api/license.ts';

	let {
		licensing,
		url = undefined,
		compact = false,
	}: { licensing: Licensing; url?: string; compact?: boolean } = $props();

	provideInstance(() => ({ licensing }));
</script>

<NotEnabled title="Audit log" {url} {compact} />
