<script lang="ts">
	import { Badge, Button, SectionHeading } from '@lyeve-labs/ui-kit';
	import { enhance } from '#lib/enhance.ts';
	import type { FlowVersion } from '#lib/api/flows.ts';
	import type { Section } from '#lib/api/gate.ts';
	import { formatDateTime, relativeTime } from '#lib/format.ts';

	interface Props {
		/** The flow's versions, or the gate when they could not be read. */
		versions: Section<FlowVersion[]>;
		/** The version the flow serves now. */
		version: number;
		/** Whether the reader may roll back, which is the activate grant. */
		canRollback: boolean;
	}

	let { versions, version, canRollback }: Props = $props();
</script>

<!-- Each roll back posts the page's own rollback action, so the draft it
     answers with lands on the canvas the way every other action's does. -->
{#if !versions.ok}
	<SectionHeading level={2} variant="eyebrow">Versions</SectionHeading>
	<p class="text-xs text-muted" data-testid="versions-unread">
		Could not load versions. Reload the page to try again.
	</p>
{:else if versions.value.length > 0}
	<SectionHeading level={2} variant="eyebrow">Versions</SectionHeading>
	<ul class="flex flex-col gap-1 text-sm">
		{#each versions.value as v (v.version)}
			<li class="flex items-center justify-between gap-2">
				<span class="text-fg">v{v.version}</span>
				<span class="text-xs text-faint" title={formatDateTime(v.created_at)}>{relativeTime(v.created_at)}</span>
				{#if v.version !== version && canRollback}
					<form method="POST" action="?/rollback" use:enhance>
						<input type="hidden" name="version" value={v.version} />
						<Button variant="ghost" size="sm" type="submit">Roll back</Button>
					</form>
				{:else if v.version === version}
					<Badge tone="success" size="sm">live</Badge>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
