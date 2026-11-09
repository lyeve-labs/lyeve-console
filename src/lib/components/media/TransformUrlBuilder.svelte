<script lang="ts">
	/**
	 * Builds a signed URL for a resized or converted copy of this image. A
	 * refusal the engine sends renders as a notice.
	 */
	import { Alert, CopyField, Button, NumberInput, RadioGroup, SectionHeading, SegmentedControl, Select, Toggle } from '@lyeve-labs/ui-kit';
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { submitter } from '$lib/forms.svelte';
	import type { FocalPoint, SignedTransform } from '$lib/api/media';
	import type { Refusal } from '$lib/api/refusal';
	import { formatDateTime } from '$lib/format';

	interface Props {
		id: string;
		/** A published file's URL can last forever. A private file's always expires. */
		published: boolean;
		focal: FocalPoint | null;
		signed?: SignedTransform | null;
		error?: string;
		refused?: Refusal | null;
	}

	let { id, published, focal, signed = null, error = '', refused = null }: Props = $props();

	let w = $state(0);
	let h = $state(0);
	let q = $state(0);
	let fit = $state('');
	let fmt = $state('');
	let useFocal = $state(true);
	// svelte-ignore state_referenced_locally
	let expires = $state(published ? '' : '3600');

	// Each fit changes the picture in a way its name does not say, so each
	// carries its sentence beside it rather than inside a closed list.
	const FITS = [
		{ value: '', label: 'Engine default', description: 'Fills the box and crops what falls outside it, the same as Cover.' },
		{ value: 'cover', label: 'Cover', description: 'Fills the box and crops what falls outside it.' },
		{ value: 'contain', label: 'Contain', description: 'Fits the whole image inside the box.' },
		{ value: 'fill', label: 'Fill', description: 'Stretches the image to the box.' },
	];
	const FORMATS = [
		{ value: '', label: 'Engine default' },
		{ value: 'webp', label: 'WebP' },
		{ value: 'avif', label: 'AVIF' },
		{ value: 'jpeg', label: 'JPEG' },
		{ value: 'png', label: 'PNG' },
	];
	const EXPIRY = $derived([
		...(published ? [{ value: '', label: 'Never' }] : []),
		{ value: '3600', label: 'In an hour' },
		{ value: '86400', label: 'In a day' },
		{ value: '604800', label: 'In a week' },
	]);

	// The fields stay as they were sent, so the URL below reads against them.
	const build = submitter(undefined, { reset: false });
	// The engine answers a path on the tenant's host, which the browser
	// resolves against the address the admin is served from.
	const absolute = $derived(signed ? (browser ? window.location.origin + signed.url : signed.url) : '');
</script>

<div class="flex flex-col gap-3" data-testid="transform-url">
	<SectionHeading level={3}>Transform URL</SectionHeading>
	<p class="text-xs text-muted">Build a signed URL for a resized or converted copy. The copy is made on the first request and then cached.</p>
	{#if refused}
		<RefusalNotice refusal={refused} />
	{:else if error}
		<Alert tone="danger">{error}</Alert>
	{/if}
	<form method="POST" action="?/transformUrl" use:enhance={build.enhance} class="flex flex-col gap-3">
		<input type="hidden" name="id" value={id} />
		<input type="hidden" name="use_focal" value={useFocal && focal ? 'true' : 'false'} />
		{#if focal}
			<input type="hidden" name="focal_x" value={focal.x} />
			<input type="hidden" name="focal_y" value={focal.y} />
		{/if}
		<RadioGroup name="fit" label="Fit" options={FITS} bind:value={fit} />
		<div class="grid gap-3 sm:grid-cols-2">
			<NumberInput id="transform-w" name="w" label="Width" min={0} bind:value={w} hint="0 keeps the original." />
			<NumberInput id="transform-h" name="h" label="Height" min={0} bind:value={h} hint="0 keeps the original." />
			<Select id="transform-fmt" name="fmt" label="Format" options={FORMATS} value={fmt} onvaluechange={(v) => (fmt = v)} />
			<NumberInput id="transform-q" name="q" label="Quality" min={0} max={100} bind:value={q} hint="0 is the engine default." />
		</div>
		<SegmentedControl name="expires_in" label="Expires" options={EXPIRY} bind:value={expires} />
		{#if focal}
			<Toggle id="transform-focal" label="Center a crop on the focal point" bind:checked={useFocal} />
		{/if}
		<div class="flex justify-end">
			<Button variant="secondary" size="sm" type="submit" loading={build.pending}>Build URL</Button>
		</div>
	</form>
	{#if signed}
		<CopyField id="transform-result" label="Signed URL" value={absolute} mono copyLabel="Copy URL" />
		<p class="text-xs text-faint">{signed.expires_at ? `Expires ${formatDateTime(signed.expires_at)}.` : 'Never expires.'}</p>
	{/if}
</div>
