<script lang="ts">
	import PageTitle from '#lib/components/PageTitle.svelte';
	import { enhance } from '#lib/enhance.ts';
	import { Alert, Button, Input } from '@lyeve-labs/ui-kit';
	import { ArrowLeft } from '@lucide/svelte';
	import AuthShell from '#lib/components/AuthShell.svelte';
	import { submitter } from '#lib/forms.svelte.ts';
	import OrganizationField from '#lib/components/OrganizationField.svelte';
	import { ICON } from '#lib/icon.ts';
	import { withOrganization } from '#lib/organization.ts';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	const typed = $derived(form && 'tenant' in form && typeof form.tenant === 'string' ? form.tenant : null);

	const send = submitter();
</script>

<PageTitle title="Sign in with an email link" />

<AuthShell title="Sign in with an email link" description="Get a link by email that signs you in.">
	{#if form && 'sent' in form && form.sent}
		<div class="space-y-5">
			<Alert tone="success" announce>
				If an account exists for {form.email}, a sign-in link is on its way. It works once and expires
				in a few minutes.
			</Alert>
			<Button href={withOrganization('/login', data.carried)} variant="ghost" size="sm" full>
				<ArrowLeft size={ICON.sm} aria-hidden="true" />
				Back to sign in
			</Button>
		</div>
	{:else}
		<form method="POST" use:enhance={send.enhance} class="space-y-5">
			{#if form?.error}
				<Alert tone="danger">{form.error}</Alert>
			{/if}

			<Input
				id="email"
				name="email"
				type="email"
				label="Email"
				placeholder="you@example.com"
				autocomplete="email"
				value={form?.email ?? ''}
				required
				autofocus
			/>

			{#if data.organization}
				<OrganizationField carried={data.carried} {typed} />
			{/if}

			<Button type="submit" variant="primary" full loading={send.pending}>Email me a link</Button>

			<Button href={withOrganization('/login', data.carried)} variant="ghost" size="sm" full>
				<ArrowLeft size={ICON.sm} aria-hidden="true" />
				Back to sign in
			</Button>
		</form>
	{/if}
</AuthShell>
