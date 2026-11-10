<script lang="ts">
	import { Alert, Button, Drawer, EmptyState, SearchInput } from '@lyeve-labs/ui-kit';
	import { File, Images } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { mediaFileUrl, mediaKind, type MediaChoice } from '$lib/api/media';
	import { narrows } from '$lib/narrow';

	/**
	 * Chooses a published library file for a media field. Only published files
	 * are offered, because the field stores the file's public path and a
	 * private file has none a site could load. The drawer says where to
	 * publish one.
	 *
	 * `choices` is null when the library could not be read. That is said as a
	 * failure, because an empty picker would tell the reader that nothing is
	 * published.
	 */
	let {
		choices,
		onpick,
		label = 'Choose from library',
	}: {
		choices: MediaChoice[] | null;
		onpick: (choice: MediaChoice) => void;
		label?: string;
	} = $props();

	let open = $state(false);
	let query = $state('');
	const visible = $derived((choices ?? []).filter((c) => narrows(query, c.filename, c.alt_text)));

	function pick(choice: MediaChoice) {
		onpick(choice);
		open = false;
	}
</script>

<Button variant="secondary" size="sm" onclick={() => (open = true)}>
	<Images size={ICON.sm} /> {label}
</Button>

<Drawer bind:open title="Choose a file" size="lg">
	{#if choices === null}
		<Alert tone="warn" title="Could not load the library">
			Reload the page to try again.
		</Alert>
	{:else if choices.length === 0}
		<EmptyState
			title="No published files"
			description="Publish a file from the media library to give it an address, then choose it here."
		/>
	{:else}
		<div class="flex flex-col gap-4">
			<label for="media-picker-search" class="sr-only">Narrow the files</label>
			<SearchInput id="media-picker-search" bind:value={query} placeholder="File name or alt text" />
			{#if visible.length === 0}
				<p class="text-sm text-muted">No published files match this search.</p>
			{:else}
				<ul class="grid grid-cols-2 gap-3 sm:grid-cols-3">
					{#each visible as choice (choice.id)}
						<li>
							<button
								type="button"
								class="flex w-full flex-col gap-1 rounded-md border border-line-strong p-2 text-left transition-colors hover:border-brand focus-visible:ring-2 focus-visible:ring-focus outline-none"
								onclick={() => pick(choice)}
								aria-label="Choose {choice.filename}"
							>
								<span class="flex aspect-square items-center justify-center overflow-hidden rounded bg-surface-2">
									{#if mediaKind(choice.content_type) === 'image'}
										<img src={mediaFileUrl(choice.id)} alt={choice.alt_text} class="h-full w-full object-cover" loading="lazy" />
									{:else}
										<File size={ICON.placeholder} class="text-faint" aria-hidden="true" />
									{/if}
								</span>
								<span class="truncate text-xs text-muted">{choice.filename}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
	{/snippet}
</Drawer>
