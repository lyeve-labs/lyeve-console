<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { submitter } from '$lib/forms.svelte';
	import { enhance } from '$app/forms';
	import { Alert, Button, Divider, Input, PasswordInput } from '@lyeve-labs/ui-kit';
	import { ArrowLeft } from '@lucide/svelte';
	import AuthShell from '$lib/components/AuthShell.svelte';
	import CaptchaWidget from '$lib/components/CaptchaWidget.svelte';
	import type { CaptchaChallenge } from '$lib/captcha';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';
	import OrganizationField from '$lib/components/OrganizationField.svelte';
	import { withOrganization } from '$lib/organization';
	import { SESSION_ENDED } from '$lib/session';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	const signIn = submitter();
	const verify = submitter();

	// Set by the widget once the visitor passes the check. Sign in waits for it,
	// because the engine refuses a challenged attempt that carries no token.
	let captchaToken = $state('');
	const challenge = $derived<CaptchaChallenge | null>(
		form && 'captcha' in form && form.captcha ? (form.captcha as CaptchaChallenge) : null
	);
	const email = $derived(form && 'email' in form && typeof form.email === 'string' ? form.email : '');
	const typedOrganization = $derived(form && 'tenant' in form && typeof form.tenant === 'string' ? form.tenant : null);
</script>

<PageTitle title="Sign in" />

<AuthShell title={form?.mfa_required ? 'Two-factor verification' : 'Sign in to your account'}>
	{#if form?.mfa_required}
		<form method="POST" use:enhance={verify.enhance} class="space-y-5">
			{#if form?.error}
				<Alert tone="danger">{form.error}</Alert>
			{/if}

			<input type="hidden" name="challenge_token" value={form.challenge_token} />

			<Input
				id="code"
				name="code"
				label="Authenticator code"
				hint="Enter the 6-digit code from your authenticator app or a backup code."
				placeholder="000000"
				maxlength={16}
				autocomplete="one-time-code"
				required
				autofocus
			/>

			<Button type="submit" variant="primary" full loading={verify.pending}>Verify</Button>

			<Button href="/login" variant="ghost" size="sm" full>
				<ArrowLeft size={ICON.sm} aria-hidden="true" />
				Back to sign in
			</Button>
		</form>
	{:else}
		<form method="POST" use:enhance={signIn.enhance} class="space-y-5">
			{#if form?.error}
				<Alert tone="danger">{form.error}</Alert>
			{:else if data.ended}
				<Alert tone="warn">{SESSION_ENDED}</Alert>
			{/if}

			<Input
				id="email"
				name="email"
				type="email"
				label="Email"
				placeholder="you@example.com"
				autocomplete="email"
				value={email}
				required
			/>

			<PasswordInput
				id="password"
				name="password"
				label="Password"
				autocomplete="current-password"
				required
			/>

			{#if data.organization}
				<OrganizationField carried={data.carried} typed={typedOrganization} />
			{/if}

			{#if data.passwordReset}
				<div class="flex justify-end">
					<a href={withOrganization('/forgot-password', data.carried)} class="relative hit-area text-sm text-brand transition-colors hover:underline">Forgot password?</a>
				</div>
			{/if}

			{#if challenge}
				<!-- A provider token is single use, so every answer from the engine
				     mounts a fresh widget rather than keeping a spent one. -->
				{#key form}
					<CaptchaWidget {challenge} bind:token={captchaToken} />
				{/key}
			{/if}

			<Button
				type="submit"
				variant="primary"
				full
				loading={signIn.pending}
				disabled={!!challenge && !captchaToken}
			>
				Sign in
			</Button>
		</form>

		{#if data.magicLink}
			<Button href={withOrganization('/login/magic-link', data.carried)} variant="ghost" size="sm" full class="mt-3">Email me a sign-in link</Button>
		{/if}

		{#if data.oauthProviders.length > 0 || data.samlProviders.length > 0}
			<Divider class="my-5">or continue with</Divider>

			<div class="space-y-2">
				{#each data.oauthProviders as provider}
					<Button
						href="/api/admin/auth/oauth/{encodeURIComponent(provider)}"
						variant="secondary"
						full
						class="capitalize"
					>
						Sign in with {provider.replace(/_/g, ' ')}
					</Button>
				{/each}
				<!-- A SAML provider is named by whoever configured it, so the label
				     is printed as given rather than title-cased, and the name is
				     encoded: these hold spaces where an OAuth key does not. -->
				{#each data.samlProviders as provider}
					<Button
						href="/api/admin/auth/saml/{encodeURIComponent(provider)}"
						variant="secondary"
						full
					>
						Sign in with {provider}
					</Button>
				{/each}
			</div>
		{/if}
	{/if}
</AuthShell>
