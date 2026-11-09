<script lang="ts">
	import { Alert, Button, Card, CopyField, Input, PageShell, PasswordInput, SectionHeading, Table } from '@lyeve-labs/ui-kit';
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import { tracked } from '$lib/forms.svelte';
	import { BookOpen, Check, Key, KeySquare, X } from '@lucide/svelte';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// svelte-ignore state_referenced_locally
	let tokenEmail = $state(data.user?.email ?? '');
	let tokenPassword = $state('');
	const issue = tracked(() => async ({ update }) => {
		await update({ reset: false });
	});
	const tokenResult = $derived(form && 'token' in form ? (form.token ?? '') : '');
	const tokenError = $derived(form && 'tokenError' in form ? form.tokenError : '');
	const superAdmin = $derived(data.user.roles.includes('super_admin'));
	const operator = $derived(superAdmin || data.user.roles.includes('admin'));

	const roleCapabilities = [
		{ role: 'viewer', read: true, write: false, schemas: false },
		{ role: 'editor', read: true, write: true, schemas: false },
		{ role: 'admin', read: true, write: true, schemas: true },
	];
</script>

<!-- The icon carries no name of its own, so the cell states the answer in text.
     A screen reader reads the cell, not the glyph inside it. -->
{#snippet capability(allowed: boolean)}
	{#if allowed}
		<Check size={ICON.sm} class="text-success" aria-hidden="true" />
		<span class="sr-only">Allowed</span>
	{:else}
		<X size={ICON.sm} class="text-danger" aria-hidden="true" />
		<span class="sr-only">Not allowed</span>
	{/if}
{/snippet}

<PageShell title="API access" description="See how external apps authenticate to the content API and what each role can do, and get a token to try it." width="wide">
	{#snippet actions()}
		<Button variant="secondary" size="sm" href="/admin/api-reference">
			<BookOpen size={ICON.sm} /> API reference
		</Button>
		{#if superAdmin}
			<Button variant="secondary" size="sm" href="/admin/api-keys">
				<Key size={ICON.sm} /> API keys
			</Button>
		{/if}
		{#if operator}
			<Button variant="secondary" size="sm" href="/admin/admin-tokens">
				<KeySquare size={ICON.sm} /> Admin tokens
			</Button>
		{/if}
	{/snippet}

	<section class="flex flex-col gap-4">
		<SectionHeading>How an app authenticates</SectionHeading>
		<Card>
			<div class="flex flex-col gap-4 text-sm">
				<p class="text-fg">
					External apps call the content API under <span class="font-mono">/api/v1</span> with a
					<strong>Bearer JWT</strong>, which you can get for an account's email and password below, or with an API key in the
					<span class="font-mono">X-API-Key</span> header. A super admin creates API keys on the API keys page.
				</p>
				<p class="text-muted">
					Scripts that call the admin API under <span class="font-mono">/api/admin</span> use an
					{#if operator}<a href="/admin/admin-tokens" class="text-brand hover:underline">admin token</a>{:else}admin token{/if}:
					a Bearer credential that an administrator creates with named grants. It expires within 90 days, and every request made with it is logged.
				</p>
				<div class="flex flex-col gap-2">
					<p class="font-medium text-muted">Role capabilities</p>
					<Table label="Role capabilities">
						<thead>
							<tr>
								<th scope="col">Role</th>
								<th scope="col">Read content</th>
								<th scope="col">Write content</th>
								<th scope="col">Manage content types</th>
							</tr>
						</thead>
						<tbody>
							{#each roleCapabilities as row (row.role)}
								<tr>
									<td data-cell="nowrap" class="font-medium">{row.role}</td>
									<td data-cell="nowrap">{@render capability(row.read)}</td>
									<td data-cell="nowrap">{@render capability(row.write)}</td>
									<td data-cell="nowrap">{@render capability(row.schemas)}</td>
								</tr>
							{/each}
						</tbody>
					</Table>
					<p class="text-xs text-faint">
						Narrow these per content type and per flow with row-level rules on the
						<a href="/admin/settings/permissions" class="text-brand hover:underline">Permissions</a> page.
					</p>
				</div>
				<div class="flex flex-col gap-1">
					<p class="font-medium text-muted">Example</p>
					<pre class="overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs text-fg">curl -H "Authorization: Bearer $TOKEN" \
  "$API_HOST/api/v1/content/articles"</pre>
				</div>
			</div>
		</Card>
	</section>

	<section class="flex flex-col gap-4">
		<SectionHeading>Get an API token</SectionHeading>
		<Card>
			<div class="flex flex-col gap-4">
				<p class="text-sm text-muted">
					Exchange an account's email and password for a Bearer token, the same way an external app gets one. Give service accounts the
					<span class="font-mono text-xs">viewer</span> or
					<span class="font-mono text-xs">editor</span> role on the
					{#if superAdmin}<a href="/admin/users" class="text-brand hover:underline">Users</a>{:else}Users{/if} page. Only a super admin can open it.
				</p>
				<form method="POST" action="?/token" use:enhance={issue.enhance} class="flex flex-col gap-4">
					<div class="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
						<Input id="tok-email" name="email" label="Email" type="email" bind:value={tokenEmail} autocomplete="off" />
						<PasswordInput id="tok-pw" name="password" label="Password" bind:value={tokenPassword} autocomplete="current-password" />
					</div>
					<div class="flex justify-end">
						<Button type="submit" variant="primary" disabled={!tokenEmail || !tokenPassword} loading={issue.pending}>Generate token</Button>
					</div>
				</form>

				{#if tokenError}
					<div data-testid="token-error">
						<Alert tone="danger">{tokenError}</Alert>
					</div>
				{/if}

				{#if tokenResult}
					<!-- Keyed on the token, so a new one arrives masked again. -->
					{#key tokenResult}
						<CopyField id="bearer-token" label="Bearer token" value={tokenResult} secret copyLabel="Copy the token" />
					{/key}
				{/if}
			</div>
		</Card>
	</section>
</PageShell>
