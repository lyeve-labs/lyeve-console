<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { enhance } from '$app/forms';
	import { Alert, Button, Input } from '@lyeve-labs/ui-kit';
	import { ArrowLeft } from '@lucide/svelte';
	import AuthShell from '$lib/components/AuthShell.svelte';
	import { submitter } from '$lib/forms.svelte';
	import { ICON } from '$lib/icon';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	const redeem = submitter();
	const verify = submitter();

	const mfa = $derived(form && 'mfa_required' in form && form.mfa_required === true);
	const challengeToken = $derived(
		form && 'challenge_token' in form && typeof form.challenge_token === 'string' ? form.challenge_token : ''
	);
</script>

<PageTitle title="Sign in with your link" />

<AuthShell title={mfa ? 'Two-factor verification' : 'Sign in with your link'}>
	{#if mfa}
		<form method="POST" action="?/mfa" use:enhance={verify.enhance} class="space-y-5">
			{#if form?.error}
				<Alert tone="danger">{form.error}</Alert>
			{/if}

			<input type="hidden" name="challenge_token" value={challengeToken} />

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
		</form>
	{:else if form && 'password' in form && form.password === true}
		<div class="space-y-5">
			<Alert tone="danger">{form.error}</Alert>
			<Button href="/login" variant="primary" full>Sign in with password</Button>
		</div>
	{:else if data.token}
		<form method="POST" action="?/verify" use:enhance={redeem.enhance} class="space-y-5">
			{#if form?.error}
				<Alert tone="danger">{form.error}</Alert>
			{:else}
				<p class="text-sm text-muted">The link works once. Continue to finish signing in on this device.</p>
			{/if}

			<input type="hidden" name="token" value={data.token} />

			<Button type="submit" variant="primary" full loading={redeem.pending}>Continue</Button>

			<Button href="/login/magic-link" variant="ghost" size="sm" full>Request a new link</Button>
		</form>
	{:else}
		<div class="space-y-5">
			<Alert tone="danger">This sign-in link is incomplete. Open the link from the email again, or request a new one.</Alert>
			<Button href="/login/magic-link" variant="secondary" full>Request a new link</Button>
			<Button href="/login" variant="ghost" size="sm" full>
				<ArrowLeft size={ICON.sm} aria-hidden="true" />
				Back to sign in
			</Button>
		</div>
	{/if}
</AuthShell>
