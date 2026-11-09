<script lang="ts">
	/**
	 * Whether the database matches the schemas, and the control that makes it
	 * match.
	 *
	 * The foot of the sidebar is the furthest point on screen from anything that
	 * would make a reader look for it: a schema saved on the far right would
	 * leave a pending migration announced in the bottom left corner, below the
	 * fold on a short window, in a band the eye reads as chrome. It is a property of the instance, not of the navigation, so it
	 * belongs in the header beside the other instance-wide controls, and it has
	 * to survive the sidebar being put away.
	 *
	 * It reads nothing and writes nothing. The count and the queued statements
	 * arrive as props from the shell's own load, and applying is a form posted to
	 * the dashboard's action.
	 *
	 * The chip only opens the confirmation. The queue holds every tenant's
	 * pending drops on the tables they share, and a dropped column takes its
	 * data with it, so nothing runs until the reader has seen each statement.
	 * The form carries the descriptions it listed, and the action refuses the
	 * apply when the queue no longer matches them, so a drop queued after the
	 * list was read never runs unseen.
	 */
	import { Badge, Button, Modal } from '@lyeve-labs/ui-kit';
	import { CircleAlert, CircleCheck, CircleHelp } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { enhance } from '$app/forms';
	import { invalidate, invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { MIGRATIONS_DEPENDENCY, type PendingStatement } from '$lib/api/migrate';
	import { overlayClosed } from '$lib/overlay';
	import { plural } from '$lib/format';

	interface Props {
		/** Migrations waiting to be applied, or null when the engine did not answer. */
		pending: number | null;
		/** The statements waiting, as the engine listed them. */
		items?: PendingStatement[];
		/** Where the reader is, so a submission without JavaScript comes back here. */
		redirectTo: string;
	}

	let { pending, items = [], redirectTo }: Props = $props();

	let confirming = $state(false);
	let syncing = $state(false);
	let error = $state('');

	// The engine queues only what removes data: a column, a key or a table
	// dropped, or a column cleared for one tenant. Each is marked by its own
	// description, so a statement the engine queues later for another reason
	// is not called destructive by default.
	const destroys = (item: PendingStatement) => /^(drop|clear) /i.test(item.description);

	const applying: SubmitFunction = () => {
		syncing = true;
		error = '';
		return async ({ result }) => {
			syncing = false;
			confirming = false;
			// The failure is said once the dialog has left, so the focus moving
			// back to the chip does not cut the announcement off.
			if (result.type === 'failure') {
				const message = result.data?.error;
				await overlayClosed();
				error = typeof message === 'string' && message ? message : 'Could not apply the migrations. Try again.';
				// The queue moved since it was listed, so the list is read again.
				if (result.status === 409) await invalidate(MIGRATIONS_DEPENDENCY);
				return;
			}
			if (result.type === 'error') {
				await overlayClosed();
				error = 'Could not apply the migrations. Check your connection and try again.';
				return;
			}
			/*
			 * The action answers success with a redirect. Following it would
			 * reload the document for a number the shell can refresh on its own,
			 * so the shell's data is invalidated instead and the reader keeps
			 * their place.
			 */
			await invalidateAll();
		};
	};

	// Below sm the words leave the screen and stay with a screen reader. Each
	// state keeps an icon of its own shape, so the chip never says which state
	// it is in by color alone.
	const words = 'sr-only sm:not-sr-only';
</script>

{#if pending === null}
	<!-- Not "checking": the shell asked and got no answer. Reading that as zero
	     would paint this green and claim a database nobody heard from is in step
	     with the schemas. -->
	<span data-testid="db-status" title="Could not check for pending migrations">
		<Badge size="md" class="h-8">
			<CircleHelp size={ICON.sm} class="shrink-0" aria-hidden="true" />
			<span class={words}>Database unknown</span>
		</Badge>
	</span>
{:else if pending === 0}
	<span data-testid="db-status" title="No pending migrations">
		<Badge tone="success" size="md" class="h-8">
			<CircleCheck size={ICON.sm} class="shrink-0" aria-hidden="true" />
			<span class={words}>Database synced</span>
		</Badge>
	</span>
{:else}
	<!-- Pending work, so the control that clears it is the thing on screen
	     rather than a label pointing at one somewhere else. It opens the list
	     of what would run, and the apply is posted from there. -->
	<Button
		variant="outline"
		size="sm"
		type="button"
		data-testid="db-status"
		loading={syncing}
		title="{pending} {plural(pending, 'migration')} waiting to be applied"
		onclick={() => (confirming = true)}
	>
		<CircleAlert size={ICON.sm} class="shrink-0 text-warn" aria-hidden="true" />
		<span class="text-warn">{pending} pending</span>
		<span class="text-warn {words}">{plural(pending, 'migration')}</span>
	</Button>
	<Modal
		bind:open={confirming}
		size="lg"
		title="Apply {pending} pending {plural(pending, 'migration')}"
		description="Every statement queued for every tenant runs now. A dropped column cannot be brought back."
	>
		<ul class="flex flex-col gap-2 text-sm" data-testid="db-status-queue">
			{#each items as item, i (i)}
				<li class="flex items-start justify-between gap-3">
					<span class="min-w-0">
						<span class="block font-mono break-all text-fg">{item.description}</span>
						<span class="block text-xs text-faint">{item.schema_name}</span>
					</span>
					{#if destroys(item)}
						<Badge tone="danger" size="sm">Destroys data</Badge>
					{/if}
				</li>
			{:else}
				<li class="text-faint">No statements to run.</li>
			{/each}
		</ul>
		<form id="db-status-apply" method="POST" action="/admin?/applyMigrations" use:enhance={applying}>
			<input type="hidden" name="redirectTo" value={redirectTo} />
			<input type="hidden" name="expected" value={JSON.stringify(items.map((item) => item.description))} />
		</form>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (confirming = false)}>Cancel</Button>
			<Button variant="danger" type="submit" form="db-status-apply" loading={syncing}>
				Apply {pending} {plural(pending, 'migration')}
			</Button>
		{/snippet}
	</Modal>
{/if}
<!-- One element is both the message and the live region, on the page and
     empty until a sync fails, because a screen reader announces a region only
     when text arrives in one already there. Empty, it is visually hidden and
     adds no gap to the header. A div because in Firefox Orca drops a quick
     insertion into a paragraph, and no status role because Orca reads a
     status bar as chrome and says nothing. -->
<div class="text-xs text-danger empty:sr-only" aria-live="polite" aria-atomic="true" data-testid="db-status-live">{#if error}{error}{/if}</div>
