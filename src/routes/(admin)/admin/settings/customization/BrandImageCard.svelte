<script lang="ts" module>
	/** What the last submit of a card did, read from the action's answer. */
	export type ImageNotice = '' | 'imported' | 'uploaded' | 'saved' | 'removed';
</script>

<script lang="ts">
	import { Alert, Button, Card, FileInput, Input, SectionHeading, Spinner } from '@lyeve-labs/ui-kit';
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { ImageOff, Trash2 } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import MediaPicker from '$lib/components/media/MediaPicker.svelte';
	import { logoProblem } from '$lib/logo';
	import type { MediaChoice } from '$lib/api/media';

	interface Props {
		kind: 'logo' | 'favicon';
		/** The address the brand stores now. */
		current: string;
		/** Null when the media library could not be read, which is not a library with nothing in it. */
		mediaChoices: MediaChoice[] | null;
		error?: string;
		fieldError?: string;
		notice?: ImageNotice;
	}

	let { kind, current, mediaChoices, error = '', fieldError = undefined, notice = '' }: Props = $props();

	/*
	 * The two images share a pipeline and differ in what they are called and
	 * where they show, so each kind keeps its own action names.
	 */
	const COPY = {
		logo: {
			heading: 'Logo',
			noun: 'logo',
			upload: 'uploadLogo',
			address: 'logo',
			file: 'logo',
			field: 'logo_url',
			inUse: 'The sidebar and the sign-in pages show this logo.',
			empty: 'No logo yet. The sidebar and the sign-in pages show the product mark.',
			saved: 'Logo saved. The sidebar and the sign-in pages now show it.',
			removed: 'Logo removed. The sidebar and the sign-in pages show the product mark again.',
			hint: 'PNG, JPEG or WebP, up to 500 KB. The file is added to the media library and published.',
			remove: 'Remove the logo',
		},
		favicon: {
			heading: 'Tab icon',
			noun: 'tab icon',
			upload: 'uploadFavicon',
			address: 'favicon',
			file: 'favicon',
			field: 'favicon_url',
			inUse: 'Browser tabs show this icon, on the sign-in pages too.',
			empty: 'No icon yet. Browser tabs show the product icon.',
			saved: 'Tab icon saved. Browser tabs now show it.',
			removed: 'Tab icon removed. Browser tabs show the product icon again.',
			hint: 'PNG, JPEG or WebP, up to 500 KB. A square image of at least 32 by 32 pixels works best. The file is added to the media library and published.',
			remove: 'Remove the icon',
		},
	} as const;
	const copy = $derived(COPY[kind]);

	let address = $state('');
	$effect.pre(() => {
		address = current;
	});

	/*
	 * The file. A drop hands the file to the drop zone's callback and never to
	 * its input, so the file is held here and put into the form on submit. A
	 * file chosen through the dialog takes the same path. It is checked here
	 * first so a wrong file is refused before it is sent, and again on the
	 * server, which is the check that counts.
	 */
	let uploadForm = $state<HTMLFormElement | null>(null);
	let libraryForm = $state<HTMLFormElement | null>(null);
	let pending = $state<File | null>(null);
	let pendingPreview = $state('');
	let fileError = $state('');
	let uploading = $state(false);
	const shown = $derived(pendingPreview || current);

	const NOTICE: Record<Exclude<ImageNotice, ''>, (c: (typeof COPY)[keyof typeof COPY]) => string> = {
		imported: (c) => `Imported into the media library, published, and set as the ${c.noun}.`,
		uploaded: (c) => `Uploaded to the media library, published, and set as the ${c.noun}.`,
		saved: (c) => c.saved,
		removed: (c) => c.removed,
	};

	function pick(files: FileList | null) {
		const file = files?.[0];
		if (!file) return;
		fileError = logoProblem(file, copy.noun) ?? '';
		if (fileError) return;
		pending = file;
		// A data URL, not an object URL: the admin's image policy admits
		// data: and its own origin, and a blob: preview would be blocked.
		const reader = new FileReader();
		reader.onload = () => (pendingPreview = typeof reader.result === 'string' ? reader.result : '');
		reader.readAsDataURL(file);
		uploadForm?.requestSubmit();
	}

	const upload: SubmitFunction = ({ formData, cancel }) => {
		if (!pending) {
			cancel();
			return;
		}
		formData.set(copy.file, pending);
		uploading = true;
		return async ({ update }) => {
			uploading = false;
			pending = null;
			pendingPreview = '';
			await update({ reset: true });
		};
	};

	async function pickFromLibrary(url: string) {
		address = url;
		// The input has to carry the new address before the form is read.
		await tick();
		libraryForm?.requestSubmit();
	}

	const keep: SubmitFunction = () => async ({ update }) => update({ reset: false });
</script>

<Card pad="md">
	{#snippet header()}
		<SectionHeading level={2}>{copy.heading}</SectionHeading>
	{/snippet}
	<div class="flex flex-col gap-4">
		{#if error}
			<Alert tone="danger">{error}</Alert>
		{:else if notice}
			<Alert tone="success" autoDismiss>{NOTICE[notice](copy)}</Alert>
		{/if}

		<div class="flex items-center gap-4">
			<div class="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line-strong bg-surface-2" data-testid="{kind}-preview">
				{#if shown}
					<img src={shown} alt="The {copy.noun}" class="max-h-16 max-w-16 object-contain" />
				{:else}
					<ImageOff size={ICON.lg} class="text-faint" aria-hidden="true" />
				{/if}
			</div>
			<div class="flex min-w-0 flex-col gap-1 text-sm">
				{#if uploading}
					<span class="flex items-center gap-2 text-fg"><Spinner size={ICON.sm} /> Uploading the {copy.noun}</span>
				{:else if current}
					<span class="text-fg">{copy.inUse}</span>
					<span class="truncate font-mono text-xs text-faint">{current}</span>
				{:else}
					<span class="text-muted">{copy.empty}</span>
				{/if}
			</div>
		</div>

		<form bind:this={uploadForm} method="POST" action="?/{copy.upload}" enctype="multipart/form-data" use:enhance={upload}>
			<FileInput
				id="{kind}-file"
				name={copy.file}
				label="Upload a file"
				accept=".png,.jpg,.jpeg,.webp"
				hint={copy.hint}
				error={fileError || undefined}
				disabled={uploading}
				onchange={pick}
			/>
		</form>

		<div>
			<!-- The picker says itself when the library could not be read. -->
			<MediaPicker choices={mediaChoices} onpick={(c) => pickFromLibrary(c.public_url)} label="Choose from the library" />
		</div>

		<form bind:this={libraryForm} method="POST" action="?/{copy.address}" class="flex flex-col gap-4" use:enhance={keep}>
			<Input
				id="brand-{kind}"
				name={copy.field}
				label="Or use an address"
				mono
				placeholder="https://"
				hint="A published media library file, or an https URL. An image on another site is copied into the media library on save and served from this engine."
				error={fieldError}
				bind:value={address}
			/>
			<div><Button variant="secondary" type="submit">Save</Button></div>
		</form>
		{#if current}
			<form method="POST" action="?/{copy.address}" use:enhance={keep}>
				<input type="hidden" name={copy.field} value="" />
				<Button variant="ghost" size="sm" type="submit"><Trash2 size={ICON.sm} class="text-danger" /> {copy.remove}</Button>
			</form>
		{/if}
	</div>
</Card>
