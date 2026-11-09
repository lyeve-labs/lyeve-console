<script lang="ts">
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		Alert,
		Badge,
		Button,
		Card,
		Input,
		PageShell,
		PasswordInput,
		SectionHeading,
		SegmentedControl,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { confirmed, tracked } from '$lib/forms.svelte';
	import { CAPTCHA_PROVIDERS, providerLabel, type CaptchaProvider } from '$lib/api/captcha-settings';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const refusal = $derived(formRefusal(form));
	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const settings = $derived(data.settings);
	const tenant = $derived(settings?.tenant ?? null);

	let provider = $state<CaptchaProvider>('turnstile');
	let siteKey = $state('');
	let secret = $state('');
	let scoreFloor = $state('');

	// The form starts from what is stored, and follows a save or a clear.
	$effect(() => {
		provider = tenant?.provider ?? 'turnstile';
		siteKey = tenant?.site_key ?? '';
		scoreFloor = tenant?.score_floor == null ? '' : String(tenant.score_floor);
		secret = '';
	});

	const save = tracked(() => async ({ result, update }) => {
		await update({ reset: false });
		if (result.type === 'success') toast.success('Captcha settings saved.');
	});

	const clear = confirmed(
		'Clear the tenant captcha settings?',
		"This tenant's pages and flows go back to this engine's captcha, and the stored secret is deleted.",
		{ confirmLabel: 'Clear', success: 'Captcha settings cleared.' },
	);
</script>

<PageShell
	title="Captcha"
	description="Set the captcha this tenant's own pages and flows use, with keys of its own."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#if data.gate.state !== 'ok' || !settings}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Captcha"
			absent="Captcha is not included in this build."
		/>
	{:else}
		<Alert tone="brand" title="Signing in to the console always uses this engine's captcha">
			These settings apply to this tenant's own pages and flows. Signing in to the console always uses this engine's captcha, so a wrong key here cannot lock you out.
		</Alert>

		<FormErrors message={formError} refused={refusal} />

		<section class="flex flex-col gap-4" aria-label="What is checked now">
			<SectionHeading level={2}>What is checked now</SectionHeading>
			<Card pad="md">
				<div class="flex flex-col gap-2 text-sm">
					<p class="text-fg" data-testid="captcha-source">
						{#if settings.source === 'tenant' && tenant}
							This tenant's flows use {providerLabel(tenant.provider)} with its own keys.
						{:else if settings.instance.enabled}
							This tenant's flows use this engine's {providerLabel(settings.instance.provider)}.
						{:else}
							No captcha is in use. Neither this tenant nor this engine has one set.
						{/if}
					</p>
					<p class="text-muted">
						This engine's captcha:
						{settings.instance.enabled ? providerLabel(settings.instance.provider) : 'not set'}.
						<Badge tone={settings.source === 'tenant' ? 'brand' : 'neutral'}>
							{settings.source === 'tenant' ? 'Tenant settings' : 'Engine settings'}
						</Badge>
					</p>
				</div>
			</Card>
		</section>

		<section class="flex flex-col gap-4" aria-label="Tenant settings">
			<SectionHeading level={2}>Tenant settings</SectionHeading>
			{#if !settings.licensed}
				<p class="text-sm text-muted" id="captcha-license-note">
					Tenant captcha settings are not enabled on this engine. Settings already saved still apply, and you can always clear them.
				</p>
			{/if}
			<Card pad="md">
				<form id="captcha-form" method="POST" action="?/save" use:enhance={save.enhance} class="flex flex-col gap-4">
					<input type="hidden" name="failure_threshold" value={data.settings?.tenant?.failure_threshold ?? ''} />
					<SegmentedControl
						label="Provider"
						name="provider"
						bind:value={provider}
						options={CAPTCHA_PROVIDERS.map((p) => ({ value: p.value, label: p.label }))}
					/>
					<Input
						id="captcha-site-key"
						name="site_key"
						label="Site key"
						hint="The public key the widget loads with."
						bind:value={siteKey}
						required
					/>
					<PasswordInput
						id="captcha-secret"
						name="secret_key"
						label="Secret key"
						autocomplete="off"
						hint={tenant?.has_secret
							? 'A secret is stored and is never shown. Leave this empty to keep it, or enter a new one to replace it.'
							: 'Used to verify each answer with the provider. It is stored encrypted and never shown again.'}
						bind:value={secret}
						required={!tenant?.has_secret}
					/>
					{#if provider === 'recaptcha'}
						<Input
							id="captcha-score-floor"
							name="score_floor"
							label="Score floor"
							hint="reCAPTCHA v3 scores each check from 0 to 1. A check below this fails. Leave empty to use the provider's default."
							placeholder="0.5"
							bind:value={scoreFloor}
						/>
					{/if}
					<div class="flex flex-wrap items-center gap-2">
						<!-- The plugin refuses an unlicensed save, so the button is off and
						     points at the note above that says why. -->
						<Button
							variant="primary"
							type="submit"
							loading={save.pending}
							disabled={!settings.licensed}
							aria-describedby={settings.licensed ? undefined : 'captcha-license-note'}
						>
							Save
						</Button>
					</div>
				</form>
				{#if tenant}
					<form method="POST" action="?/clear" class="mt-4 border-t border-line pt-4" use:enhance={clear}>
						<Button variant="secondary" size="sm" type="submit">Clear tenant settings</Button>
					</form>
				{/if}
			</Card>
		</section>
	{/if}
</PageShell>
