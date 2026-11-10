<script lang="ts">
	import {
		Alert,
		Button,
		Checkbox,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		Pagination,
		SearchInput,
		SegmentedControl,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { csrfHeaders } from '$lib/api/csrf';
	import { SIGN_IN_AGAIN } from '$lib/session';
	import { renewingOnce } from '$lib/renew';
	import type { MediaItem } from '$lib/api/media';
	import { pageHref, pageNumber } from '$lib/api/list';
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import { Image, Link, LayoutGrid, List, Upload } from '@lucide/svelte';
	import MediaGrid from '$lib/components/media/MediaGrid.svelte';
	import MediaTable from '$lib/components/media/MediaTable.svelte';
	import MediaPreviewDrawer from '$lib/components/media/MediaPreviewDrawer.svelte';
	import {
		readMediaView,
		writeMediaView,
		type MediaView,
	} from '$lib/components/media/view-preference';
	import { ICON } from '$lib/icon';
	import { formRefusal } from '$lib/api/refusal';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { plural } from '$lib/format';
	import { tracked } from '$lib/forms.svelte';
	import { liveFilter } from '$lib/live-filter.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The drawer's forms share one `form` result with the page's. Each failure
	// names the file it was asked for, and only that file's drawer shows it.
	// A refused transform carries a refusal as well as its sentence.
	const transformFailure = $derived.by(() => {
		const f = form as Record<string, unknown> | null;
		if (!f || !('transformError' in f) || f.transformId !== selected?.id) return null;
		return { error: String(f.transformError ?? ''), refused: formRefusal({ refused: f.transformRefused }) };
	});

	/*
	 * Derived from the load, not a local copy of it. A copy seeded once never
	 * reads the load again, and paging re-runs the load, so the grid would keep
	 * showing page one. A delete goes back through the action result, which is
	 * also what keeps the count under the pager honest.
	 */
	const items = $derived<MediaItem[]>(data.items.ok ? data.items.value : []);
	const total = $derived(data.total ?? items.length);
	let uploading = $state(false);
	// Import from URL: a file on another site copied into the library through
	// the engine, which refuses private addresses and checks it as an upload.
	let importOpen = $state(false);
	let importUrl = $state('');
	let importPublic = $state(false);
	const importSubmit = tracked(() => async ({ result, update }) => {
		await update({ reset: false });
		if (result.type === 'success') {
			importOpen = false;
			importUrl = '';
			importPublic = false;
			toast.success('File imported.');
		}
	});
	const importError = $derived(form && 'importError' in form ? String(form.importError ?? '') : '');
	let uploadError = $state('');
	let picker = $state<HTMLInputElement | undefined>(undefined);
	// Re-read when a navigation changes the URL, so the back button puts the
	// box where the list is.
	const live = liveFilter(() => data.q ?? '');

	const VIEWS = [
		{ value: 'grid', label: 'Grid', icon: LayoutGrid },
		{ value: 'list', label: 'List', icon: List },
	] satisfies { value: MediaView; label: string; icon: typeof List }[];

	// The server renders the grid, and the viewer's own choice is applied once
	// the page is in a browser that can remember one.
	let view = $state<MediaView>('grid');
	onMount(() => {
		view = readMediaView();
	});

	// The drawer follows an id, and the item is read from the loaded list, so
	// a save or a publish that reloads the list shows what the engine now holds
	// and a delete or reload that drops the row shuts the drawer.
	let selectedId = $state<string | null>(null);
	const selected = $derived(selectedId ? (items.find((it) => it.id === selectedId) ?? null) : null);

	// The drawer's opener was the deleted file's tile, so focus would fall to
	// the page body. It goes to the library's own control.
	async function deleted() {
		selectedId = null;
		await tick();
		document.querySelector<HTMLElement>('[data-media-upload]')?.focus();
	}

	async function handleUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = input.files;
		if (!files || files.length === 0) return;

		uploading = true;
		uploadError = '';
		let uploaded = 0;

		// The upload goes from the browser to the engine's own route rather than
		// through a form action. A file can be larger than the body limit the
		// admin server accepts, and the engine applies the limit that is meant
		// for uploads.
		for (const file of Array.from(files)) {
			const body = new FormData();
			body.append('file', file);
			try {
				const res = await renewingOnce(() => fetch('/api/admin/media', { method: 'POST', headers: csrfHeaders(), body }));
				// A 401 after a renewal is a session that ended. The files stay
				// picked, so the reader can sign in and send them again.
				if (res.status === 401) {
					uploadError = SIGN_IN_AGAIN;
					break;
				}
				if (!res.ok) {
					const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
					// Only the engine's refusals carry a code, and their sentence is
					// written for the operator. A 5xx can come from a proxy after the
					// engine stored the file, so it names the file and claims nothing.
					if (res.status >= 500) {
						uploadError = `Could not confirm that ${file.name} uploaded. Check the library before you try again.`;
					} else {
						uploadError = j.code && j.error ? j.error : `${file.name} was refused and was not uploaded.`;
					}
					break;
				}
				uploaded += 1;
			} catch {
				uploadError = 'Could not upload the file. Check your connection and try again.';
				break;
			}
		}

		uploading = false;
		// Clearing the value is what lets the same file be picked twice in a row.
		input.value = '';

		// The engine lists newest first, so the upload is the first tile of the
		// first unfiltered page. Going there rather than reloading in place is
		// what makes it visible from page three or from inside a search.
		if (uploaded > 0) {
			await goto('/admin/media', { invalidateAll: true });
			toast.success(`Uploaded ${uploaded} ${plural(uploaded, 'file')}`);
		}
	}
</script>

<PageShell
	title="Media library"
	description={data.items.ok ? `${total} ${plural(total, 'file')}` : undefined}
	width="wide"
>
	{#snippet actions()}
		<!-- A library that could not be read offers nothing to add to it. -->
		{#if data.items.ok}
			<!-- The kit's FileInput is a drop zone, and the library's upload control is
			     a button in the title row, so the picker stays hidden and the Button
			     opens it. A Button inside a <label> does not work: the label's
			     activation behavior is skipped for interactive descendants, so the
			     picker would never open for a mouse user.

			     Hidden from the eye is not hidden from a screen reader: sr-only keeps
			     the picker in the accessibility tree, where an input carrying no label
			     is announced as an unnamed file field. The name says what the picker
			     does rather than repeating the Button, because the two are reached
			     separately. -->
			<input
				bind:this={picker}
				type="file"
				multiple
				accept="image/*,application/pdf,video/*,audio/*,text/*"
				aria-label="Choose files to upload"
				tabindex={-1}
				class="sr-only"
				onchange={handleUpload}
				disabled={uploading}
			/>
			<Button variant="secondary" size="sm" onclick={() => (importOpen = true)}>
				<Link size={ICON.sm} /> Import from URL
			</Button>
			<Button variant="primary" size="sm" loading={uploading} onclick={() => picker?.click()} data-media-upload>
				<Upload size={ICON.sm} /> Upload files
			</Button>
		{/if}
	{/snippet}

	{#if uploadError}
		<Alert tone="danger">{uploadError}</Alert>
	{/if}

	{#if form?.error}
		<Alert tone="danger">{form.error}</Alert>
	{/if}

	<form method="GET" data-testid="media-filters" {@attach live.form}>
		<ListToolbar label="Filter media">
			{#snippet search()}
				<div class="flex items-center gap-2">
					<label for="media-search" class="sr-only">Search files</label>
					<SearchInput
						id="media-search"
						name="q"
						bind:value={live.value}
						oninput={live.input}
						placeholder="File name"
						class="min-w-0 flex-1"
					/>
				</div>
			{/snippet}
			{#snippet filters()}
				<SegmentedControl
					label="View"
					labelHidden
					bind:value={view}
					options={VIEWS}
					onchange={writeMediaView}
				/>
			{/snippet}
		</ListToolbar>
	</form>

	{#if !data.items.ok}
		<GateNotice
			level={2}
			gate={data.items.gate}
			title="Media library"
			absent="The media library is not included in this build."
		/>
	{:else if items.length === 0 && data.q}
		<EmptyState level={2} title="No files match" description="Clear the search to see the whole library." />
	{:else if items.length === 0}
		<EmptyState level={2} title="No files yet" description="Upload images, PDFs, video or audio.">
			{#snippet iconSnippet()}
				<Image size={ICON.lg} />
			{/snippet}
			{#snippet action()}
				<Button variant="secondary" loading={uploading} onclick={() => picker?.click()}>
					<Upload size={ICON.sm} /> Upload files
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		{#if view === 'list'}
			<MediaTable {items} onselect={(item) => (selectedId = item.id)} />
		{:else}
			<MediaGrid {items} onselect={(item) => (selectedId = item.id)} />
		{/if}

		<!-- The total is stated only when the envelope carried one. Absent is not
		     zero here, so it is left out rather than sent as a number nobody
		     measured, and the count carries the range instead. -->
		<Pagination
			page={pageNumber(data.offset, data.limit)}
			perPage={data.limit}
			count={items.length}
			total={data.total ?? undefined}
			hasNext={data.hasMore}
			noun="files"
			href={pageHref('/admin/media', data.limit, data.q ? { q: data.q } : {})}
		/>
	{/if}
</PageShell>

<Drawer bind:open={importOpen} title="Import from URL" description="Copy a file from an http or https address into the library. Private and internal addresses are refused.">
	<form
		method="POST"
		action="?/importUrl"
		id="import-form"
		class="flex flex-col gap-4"
		use:enhance={importSubmit.enhance}
	>
		<FormErrors message={importError || undefined} />
		<Input id="import-url" name="url" label="Address" type="url" mono required placeholder="https://example.com/logo.png" bind:value={importUrl} />
		<Input id="import-alt" name="alt_text" label="Alt text" hint="What the image shows, for readers who cannot see it." />
		<Checkbox name="public" value="true" label="Publish it, so a site or a content field can use its address" bind:checked={importPublic} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (importOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="import-form" disabled={!importUrl.trim()} loading={importSubmit.pending}>Import</Button>
	{/snippet}
</Drawer>

<MediaPreviewDrawer
	item={selected}
	aiEnabled={data.aiEnabled}
	suggestion={form && 'described' in form && form.described && form.described.id === selected?.id ? form.described.text : ''}
	deleteError={form && 'deleteError' in form && 'deleteId' in form && form.deleteId === selected?.id ? String(form.deleteError ?? '') : ''}
	detailsError={form && 'detailsError' in form && 'detailsId' in form && form.detailsId === selected?.id ? String(form.detailsError ?? '') : ''}
	focalError={form && 'focalError' in form && 'focalId' in form && form.focalId === selected?.id ? String(form.focalError ?? '') : ''}
	focalSaved={!!form && 'focalSaved' in form && form.focalSaved === selected?.id}
	transform={form && 'transform' in form && form.transform && form.transform.id === selected?.id ? form.transform : null}
	transformError={transformFailure?.error ?? ''}
	transformRefused={transformFailure?.refused ?? null}
	onclose={() => (selectedId = null)}
	ondeleted={deleted}
/>
