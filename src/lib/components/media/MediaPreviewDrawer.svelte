<script lang="ts">
	import {
		Badge,
		Button,
		DescriptionList,
		Drawer,
		Input,
		SectionHeading,
		Textarea,
		CopyField,
	} from '@lyeve-labs/ui-kit';
	import { Download, File, FileText, Music, Sparkles, Trash2 } from '@lucide/svelte';
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { confirmed } from '$lib/forms.svelte';
	import {
		formatDimensions,
		mediaFileUrl,
		mediaKind,
		mediaKindLabel,
		mediaSnippets,
		type MediaItem,
		type SignedTransform,
	} from '$lib/api/media';
	import type { Refusal } from '$lib/api/refusal';
	import FocalPointPicker from './FocalPointPicker.svelte';
	import TransformUrlBuilder from './TransformUrlBuilder.svelte';
	import { formatBytes, formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';
	import ImageZoom from './ImageZoom.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';

	interface Props {
		/** The item on show, or null while the drawer is shut. */
		item: MediaItem | null;
		onclose: () => void;
		/** Called once a delete went through and the list reloaded without the item. */
		ondeleted?: () => void | Promise<void>;
		/** Whether the AI plugin can suggest alt text. */
		aiEnabled?: boolean;
		/** A suggestion that came back for this item, to review before saving. */
		suggestion?: string;
		/** Why the last save or suggestion failed. */
		detailsError?: string;
		/** Why the last delete of this item failed. The drawer stays open on a refusal. */
		deleteError?: string;
		/** Why the last focal point save failed, and whether one just landed. */
		focalError?: string;
		focalSaved?: boolean;
		/** The transform URL the engine signed for this item, or why it did not. */
		transform?: SignedTransform | null;
		transformError?: string;
		transformRefused?: Refusal | null;
	}

	let {
		item,
		onclose,
		ondeleted,
		aiEnabled = false,
		suggestion = '',
		detailsError = '',
		deleteError = '',
		focalError = '',
		focalSaved = false,
		transform = null,
		transformError = '',
		transformRefused = null,
	}: Props = $props();

	// The editable details start from the item and follow it when another is
	// opened. A suggestion lands in the alt text for the operator to review.
	let altText = $state('');
	let tags = $state('');
	let folder = $state('');
	let shownId = '';
	$effect(() => {
		if (item && item.id !== shownId) {
			shownId = item.id;
			altText = item.alt_text ?? '';
			tags = (item.tags ?? []).join(', ');
			folder = item.folder ?? '/';
		}
	});
	$effect(() => {
		if (suggestion) altText = suggestion;
	});
	let saving = $state(false);
	let describing = $state(false);

	const kind = $derived(item ? mediaKind(item.content_type) : 'other');
	const fileUrl = $derived(item ? mediaFileUrl(item.id) : '');
	// The URL the operator copies has to resolve from wherever it is pasted,
	// and the download route is the one that answers on every instance. The
	// storage backend's own URL is empty on a local-disk one.
	const absoluteUrl = $derived(browser && fileUrl ? window.location.origin + fileUrl : fileUrl);
	// A published file has an address anyone can load, and that is the one a
	// page or a content entry should carry. A private file's only address is
	// the admin's own route, which works for a signed-in operator and nobody
	// else, so the snippets say which of the two they hold.
	const shareUrl = $derived(item?.public && item.public_url ? item.public_url : absoluteUrl);
	const snippets = $derived(mediaSnippets(shareUrl, altText || item?.filename || ''));
	let publishing = $state(false);

	const facts = $derived.by(() => {
		if (!item) return [];
		const rows = [
			{ term: 'Name', value: item.filename },
			{ term: 'Type', value: `${mediaKindLabel(kind)} (${item.content_type})` },
			{ term: 'Size', value: formatBytes(item.size, 'MB') },
		];
		const dimensions = formatDimensions(item);
		if (dimensions) rows.push({ term: 'Dimensions', value: dimensions });
		rows.push({ term: 'Uploaded', value: formatDateTime(item.created_at) });
		return rows;
	});

	// The question and the toast name the file asked about, read at submit
	// time. The flag starts once the question is answered, so a declined
	// question never spins the button.
	let deleting = $state(false);
	const remove: SubmitFunction = async (input) => {
		const name = item?.filename ?? 'file';
		const after = await confirmed(`Delete ${name}?`, 'The file is removed from the library, and any page that links to it can no longer load it. This cannot be undone.', {
			confirmLabel: 'Delete',
			success: `${name} deleted.`,
		})(input);
		if (!after) return;
		deleting = true;
		return async (opts) => {
			try {
				await after(opts);
			} finally {
				deleting = false;
			}
			if (opts.result.type === 'success') await ondeleted?.();
		};
	};
</script>

{#if item}
	<Drawer open title="Preview" description={item.filename} size="xl" {onclose}>
		<div class="flex flex-col gap-5">
			<!-- Every preview is bounded by the viewport's height rather than the
			     file's own size, so a tall image or a long PDF never pushes the
			     facts list out of reach. -->
			<div
				data-testid="media-preview"
				data-kind={kind}
				class="flex items-center justify-center overflow-hidden rounded-lg bg-surface-2/50"
			>
				{#if kind === 'image'}
					<ImageZoom src={fileUrl} alt={item.alt_text || item.filename} naturalWidth={item.width ?? 0} naturalHeight={item.height ?? 0} />
				{:else if kind === 'video'}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video src={fileUrl} controls preload="metadata" class="max-h-[60vh] w-full"></video>
				{:else if kind === 'audio'}
					<div class="flex w-full flex-col items-center gap-4 p-6">
						<Music size={ICON.placeholder} class="text-faint" aria-hidden="true" />
						<audio src={fileUrl} controls preload="metadata" class="w-full"></audio>
					</div>
				{:else if kind === 'pdf'}
					<!-- Not a frame. The file route answers every request as an
					     attachment, on purpose: it is the header that stops a stored
					     upload from running inline as a page. A frame pointed at it
					     saves the file to disk instead of showing it. -->
					<div class="flex flex-col items-center gap-2 p-10 text-faint">
						<FileText size={ICON.placeholder} aria-hidden="true" />
						<span class="text-xs">Download to view this PDF</span>
					</div>
				{:else}
					<div class="flex flex-col items-center gap-2 p-10 text-faint">
						{#if item.content_type.startsWith('text/')}
							<FileText size={ICON.placeholder} aria-hidden="true" />
						{:else}
							<File size={ICON.placeholder} aria-hidden="true" />
						{/if}
						<span class="text-xs">No preview for this type</span>
					</div>
				{/if}
			</div>

			<DescriptionList layout="stacked" items={facts} />

			<FormErrors message={deleteError || undefined} />
			<form method="POST" action="?/delete" class="flex flex-wrap gap-2" use:enhance={remove}>
				<input type="hidden" name="id" value={item.id} />
				<Button variant="secondary" size="sm" href={fileUrl} download={item.filename}>
					<Download size={ICON.sm} /> Download
				</Button>
				<Button variant="danger" size="sm" type="submit" loading={deleting}>
					<Trash2 size={ICON.sm} /> Delete
				</Button>
			</form>

			<form
				method="POST"
				action="?/publish"
				class="flex flex-col gap-2"
				use:enhance={() => {
					publishing = true;
					return async ({ update }) => {
						publishing = false;
						await update({ reset: false });
					};
				}}
			>
				<input type="hidden" name="id" value={item.id} />
				<input type="hidden" name="public" value={item.public ? 'false' : 'true'} />
				<div class="flex flex-wrap items-center gap-2">
					<Badge tone={item.public ? 'success' : 'neutral'} dot>{item.public ? 'Published' : 'Private'}</Badge>
					<Button variant="secondary" size="sm" type="submit" loading={publishing}>
						{item.public ? 'Unpublish' : 'Publish'}
					</Button>
				</div>
				<p class="text-xs text-faint">
					{item.public
						? 'Anyone can load this file at the path below on your site. Content fields can point at it.'
						: 'Only someone signed in to the console can open this file. Publish it to give it an address a site or a content field can use.'}
				</p>
			</form>

			<div class="flex flex-col gap-3" data-testid="media-copy">
				<CopyField id="media-url" label={item.public ? 'Public path' : 'Console URL'} value={snippets.url} copyLabel="Copy URL" />
				{#if kind === 'image'}
					<CopyField id="media-markdown" label="Markdown" value={snippets.markdown} copyLabel="Copy as Markdown" />
					<CopyField id="media-html" label="HTML" value={snippets.html} copyLabel="Copy as HTML" />
				{/if}
			</div>

			{#if kind === 'image'}
				<FocalPointPicker
					id={item.id}
					src={fileUrl}
					alt={item.alt_text || item.filename}
					stored={item.focal_point ?? null}
					error={focalError}
					saved={focalSaved}
				/>
				<TransformUrlBuilder
					id={item.id}
					published={!!item.public}
					focal={item.focal_point ?? null}
					signed={transform}
					error={transformError}
					refused={transformRefused}
				/>
			{/if}

			<form
				method="POST"
				action="?/update"
				id="media-details"
				class="flex flex-col gap-3"
				use:enhance={() => {
					saving = true;
					return async ({ update }) => {
						saving = false;
						await update({ reset: false });
					};
				}}
			>
				<SectionHeading level={3}>Details</SectionHeading>
				<FormErrors message={detailsError || undefined} />
				<input type="hidden" name="id" value={item.id} />
				<Textarea
					id="media-alt"
					name="alt_text"
					label="Alt text"
					rows={3}
					hint="What the image shows, for readers who cannot see it. Screen readers read it, and search engines index it."
					bind:value={altText}
				/>
				<Input id="media-tags" name="tags" label="Tags" hint="Separated by commas. You can search files by tag." bind:value={tags} />
				<Input id="media-folder" name="folder" label="Folder" mono hint="Lower-case letters, digits, _, - and /." bind:value={folder} />
			</form>
			{#if aiEnabled && kind === 'image'}
				<form
					method="POST"
					action="?/describe"
					use:enhance={() => {
						describing = true;
						return async ({ update }) => {
							describing = false;
							await update({ reset: false });
						};
					}}
					class="flex flex-wrap items-center gap-2"
				>
					<input type="hidden" name="id" value={item.id} />
					<Button variant="secondary" size="sm" type="submit" loading={describing}>
						<Sparkles size={ICON.sm} /> Suggest alt text
					</Button>
					<Badge tone="violet" size="sm">Beta</Badge>
					<span class="text-xs text-faint">An AI model describes the image. Review the text before you save it.</span>
				</form>
			{/if}
		</div>

		{#snippet footer()}
			<Button variant="secondary" onclick={onclose}>Cancel</Button>
			<Button variant="primary" type="submit" form="media-details" loading={saving}>Save</Button>
		{/snippet}
	</Drawer>
{/if}
