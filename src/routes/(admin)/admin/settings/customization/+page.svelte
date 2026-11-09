<script lang="ts">
	import { Alert, Badge, Button, Card, Input, PageShell, SectionHeading, Textarea } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import CustomizationTabs from '$lib/components/CustomizationTabs.svelte';
	import BrandImageCard, { type ImageNotice } from './BrandImageCard.svelte';
	import { accentShades, parseAccent, type Brand } from '$lib/api/customization';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const fields = $derived((form as { fields?: Record<string, string> } | null)?.fields ?? {});

	/*
	 * The brand form is seeded from what the engine stores and reseeded only
	 * when the stored brand changes. A logo or tab icon save reruns the load,
	 * so reseeding on it wiped the brand name being typed.
	 */
	const brandOf = (b: Brand) => ({ name: b.name, accent: b.accent, welcome: b.welcome });
	const brandKey = () => JSON.stringify(brandOf(data.settings.brand));
	// svelte-ignore state_referenced_locally
	let brand = $state(brandOf(data.settings.brand));
	let seeded = brandKey();
	$effect.pre(() => {
		const key = brandKey();
		if (key === seeded) return;
		seeded = key;
		brand = brandOf(data.settings.brand);
	});
	const accentOk = $derived(parseAccent(brand.accent));
	const preview = $derived(
		accentOk ? { light: accentShades(accentOk, 'light'), dark: accentShades(accentOk, 'dark') } : null,
	);
	const accentNote = $derived.by(() => {
		if (!preview) return '';
		const notes: string[] = [];
		if (preview.light.adjusted) notes.push(`darkened to ${preview.light.base} on the light theme`);
		if (preview.dark.adjusted) notes.push(`lightened to ${preview.dark.base} on the dark theme`);
		return notes.length ? `This color is hard to read as chosen, so it is ${notes.join(' and ')}.` : '';
	});

	/** What the last image submit said, for the card it was about. */
	function imageState(kind: 'logo' | 'favicon') {
		const f = (form ?? {}) as Record<string, unknown>;
		const notice: ImageNotice = f[`${kind}Imported`]
			? 'imported'
			: f[`${kind}Uploaded`]
				? 'uploaded'
				: f[`${kind}Saved`]
					? 'saved'
					: f[`${kind}Removed`]
						? 'removed'
						: '';
		return {
			error: typeof f[`${kind}Error`] === 'string' ? (f[`${kind}Error`] as string) : '',
			fieldError: fields[`${kind}_url`],
			notice,
		};
	}
	const logoState = $derived(imageState('logo'));
	const faviconState = $derived(imageState('favicon'));

	const keep: SubmitFunction = () => async ({ update }) => update({ reset: false });
</script>

<PageShell
	title="Customization"
	description="Set this tenant's name, accent color, welcome line, logo and tab icon."
	width="wide"
>
	{#snippet actions()}
		<Badge tone="violet" size="sm">Beta</Badge>
	{/snippet}

	<CustomizationTabs active="brand" />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Customization"
			absent="Customization is not included in this build."
		/>
	{:else if !data.entitled}
		<NotEnabled
			level={2}
			title="Customization"
			description="Set this tenant's name, logo, colors and menu."
		/>
	{:else}
		<!-- Every form on this page stacks the same way: label, control, hint,
		     then its buttons on a row of their own. A button beside a field
		     lines up with the control only while neither has a hint, and most
		     here do. -->
		<div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
			<Card pad="md">
				{#snippet header()}
					<SectionHeading level={2}>Brand</SectionHeading>
				{/snippet}
				<form method="POST" action="?/brand" class="flex flex-col gap-4" use:enhance={keep}>
					{#if form?.brandError}
						<Alert tone="danger">{form.brandError}</Alert>
					{:else if form && 'brandSaved' in form}
						<Alert tone="success" autoDismiss>Brand saved. Every page of this tenant's console now uses it.</Alert>
					{/if}
					<Input id="brand-name" name="name" label="Name" hint="Replaces the product name in the sidebar, on the sign-in pages and in every tab title." bind:value={brand.name} />
					<div class="flex flex-col gap-2">
						<Input
							id="brand-accent"
							name="accent"
							label="Accent color"
							mono
							placeholder="#0a7cff"
							hint={accentNote || 'Use the format #RRGGBB. Buttons, links and highlights use this color, adjusted per theme when needed to stay readable.'}
							error={brand.accent && accentOk === null ? 'Use the format #RRGGBB' : undefined}
							bind:value={brand.accent}
						/>
						{#if preview}
							<div class="flex flex-wrap gap-6" data-testid="accent-preview">
								{#each [['Dark theme', preview.dark], ['Light theme', preview.light]] as const as [label, ramp] (label)}
									<div class="flex items-center gap-2">
										<div class="flex gap-1" aria-hidden="true">
											<span class="size-6 rounded" style="background: {ramp.light}"></span>
											<span class="size-6 rounded" style="background: {ramp.base}"></span>
											<span class="size-6 rounded" style="background: {ramp.deep}"></span>
										</div>
										<span class="text-xs text-faint">{label}, {ramp.contrast.toFixed(1)}:1</span>
									</div>
								{/each}
							</div>
						{/if}
					</div>
					<Textarea id="brand-welcome" name="welcome" label="Welcome line" rows={2} hint="Shown at the top of the dashboard. At most 280 characters." bind:value={brand.welcome} />
					<div><Button variant="primary" type="submit">Save</Button></div>
				</form>
			</Card>

			<BrandImageCard kind="logo" current={data.settings.brand.logo_url} mediaChoices={data.mediaChoices} {...logoState} />

			<BrandImageCard kind="favicon" current={data.settings.brand.favicon_url ?? ''} mediaChoices={data.mediaChoices} {...faviconState} />
		</div>
	{/if}
</PageShell>
