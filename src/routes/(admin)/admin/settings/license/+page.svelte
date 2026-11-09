<script lang="ts">
	/**
	 * The license this instance runs on, as the license module reports it.
	 *
	 * Every word about the license comes from the engine: the plan in the
	 * module's words, the state, the expiry, and the reason a license is not
	 * what was configured. The links and whether a new license can be applied
	 * here come from the module's own route, so the page holds no address and
	 * no account of how a license is issued or checked.
	 */
	import { Alert, Button, Card, DescriptionList, PageShell, SectionHeading, Textarea } from '@lyeve-labs/ui-kit';
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import { Check, Clock, ExternalLink, Shield, TriangleAlert } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { formatDate, NO_VALUE } from '$lib/format';
	import { isExternalHref } from '$lib/links';
	import { linkOf, NO_LICENSING, REL, type LicenseLink } from '$lib/api/license';
	import { licenseStateLabel, licenseTone, unlicensed } from '$lib/license-state';
	import { couldNotLoad } from '$lib/outage';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let licenseKey = $state('');

	const ent = $derived(data.entitlements);
	const licensing = $derived(data.licensing ?? NO_LICENSING);

	const status = $derived(ent?.state ?? '');
	// Only a license that was read can be absent. An unread one says nothing
	// about whether this instance holds a license, so its copy stays neutral.
	const none = $derived(ent !== null && ent !== undefined && unlicensed(status));
	const unread = $derived(ent === null || ent === undefined);
	// The plan in the module's words, or as the license names it.
	const plan = $derived(ent?.plan_label || ent?.plan || '');

	const heading = $derived.by(() => {
		if (none) return 'No license';
		const state = licenseStateLabel(status);
		return plan ? `${plan}, ${state.toLowerCase()}` : state;
	});
	const summary = $derived.by(() => {
		if (none) return 'Everything that needs no license is running.';
		if (status === 'grace') {
			return ent?.grace_ends_at ? `Renew before ${formatDate(ent.grace_ends_at)}.` : 'Renew the license to keep what it grants.';
		}
		if (status === 'expired') return 'Features from the license are off until you renew it.';
		return '';
	});

	const MEDALLION: Record<ReturnType<typeof licenseTone>, string> = {
		success: 'bg-success/15 text-success',
		warn: 'bg-warn/15 text-warn',
		danger: 'bg-danger/15 text-danger',
		neutral: 'bg-surface-2 text-muted',
	};
	const tone = $derived(licenseTone(status));

	// The source is the module's word for what renews the license, shown as it
	// arrived. An instance with no license has no expiry worth a row.
	const facts = $derived([
		{ term: 'Plan', value: plan || NO_VALUE },
		...(ent?.expires_at
			? [{ term: 'Expires', value: formatDate(ent.expires_at) }]
			: none
				? []
				: [{ term: 'Expires', value: 'No expiry on record' }]),
		...(ent?.license_source ? [{ term: 'Source', value: ent.license_source }] : []),
	]);

	// Where the module sends an operator from this page, in the order they are
	// needed: getting a license, managing it, and reading how it works.
	const links = $derived(
		[REL.purchase, REL.portal, REL.documentation]
			.map((rel) => linkOf(licensing, rel))
			.filter((link): link is LicenseLink => link !== null),
	);

	// The outcome of the last submit is data the action already returned, so it
	// is derived rather than copied into state by an effect.
	const renewError = $derived(form?.error ?? '');
	const renewed = $derived(form?.success === true);

	// Only a super admin can relicense the install. The engine refuses anyone
	// else, so the form is not offered to them.
	const canRenew = $derived(data.user?.roles?.includes('super_admin') ?? false);
</script>

<PageShell
	title="License"
	description={licensing.renew
		? "See this engine's license and activate a new key."
		: "See this engine's license."}
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	<section class="flex flex-col gap-4">
		<SectionHeading>Status</SectionHeading>
		<Card>
			<div class="flex flex-col gap-4">
				{#if ent}
					<div class="flex items-center gap-3">
						<span
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full {MEDALLION[tone]}"
							aria-hidden="true"
						>
							{#if tone === 'success'}
								<Check size={ICON.md} />
							{:else if tone === 'warn'}
								<Clock size={ICON.md} />
							{:else if tone === 'danger'}
								<TriangleAlert size={ICON.md} />
							{:else}
								<Shield size={ICON.md} />
							{/if}
						</span>
						<div>
							<p class="font-semibold text-fg">{heading}</p>
							{#if summary}
								<p class="text-sm text-muted">{summary}</p>
							{/if}
						</div>
					</div>

					<!-- The license module words the problem for the operator. -->
					{#if ent.license_error}
						<Alert tone="warn" title="License problem">{ent.license_error}</Alert>
					{/if}

					<div class="border-t border-line pt-4">
						<DescriptionList items={facts} />
					</div>
				{:else}
					<Alert tone="danger">{couldNotLoad('the license', { reload: true })}</Alert>
				{/if}

				{#if links.length > 0}
					<ul class="flex flex-col gap-2 coarse:gap-5 border-t border-line pt-4">
						{#each links as link (link.rel)}
							{@const away = isExternalHref(link.href)}
							<li>
								<!-- Another origin opens in a tab of its own, so it cannot
								     reach back into the admin session through window.opener. -->
								<a
									href={link.href}
									target={away ? '_blank' : undefined}
									rel={away ? 'noopener noreferrer' : undefined}
									class="relative -my-1 py-1 hit-area inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
								>
									{#if away}
										<ExternalLink size={ICON.sm} aria-hidden="true" />
									{/if}
									{link.label}
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</Card>
	</section>

	{#if licensing.renew}
		<section class="flex flex-col gap-4">
			<SectionHeading>{none ? 'Add a license key' : unread ? 'License key' : 'Renew license'}</SectionHeading>
			<Card>
				{#if canRenew}
					<form
						method="POST"
						action="?/renew"
						use:enhance={() =>
							async ({ result, update }) => {
								if (result.type === 'success') licenseKey = '';
								await update({ reset: false });
							}}
						class="flex flex-col gap-3"
					>
						<!-- A key is one long opaque string, and it wraps wrongly in a
						     proportional face. -->
						<Textarea
							id="license-key"
							name="license_key"
							label="License token or key"
							hint={none
								? 'Only needed for what a license grants. Paste the token or key you were issued.'
								: unread
									? 'Paste the license token or key you were issued. It replaces the current license, if there is one.'
									: 'Paste the license token or key you were issued.'}
							bind:value={licenseKey}
							rows={3}
							mono
						/>

						<div class="flex justify-end">
							<Button type="submit" variant="primary" disabled={!licenseKey.trim()}>
								<Shield size={ICON.sm} aria-hidden="true" />
								{none ? 'Activate license' : unread ? 'Apply license' : 'Renew license'}
							</Button>
						</div>

						<!-- The engine's refusal is shown as it was sent, because the
						     license module words it for the operator. -->
						{#if renewError}
							<Alert tone="danger">{renewError}</Alert>
						{/if}
						{#if renewed}
							<Alert tone="success" autoDismiss>License applied. Plugins are reloading.</Alert>
						{/if}
					</form>
				{:else}
					<p class="text-sm text-muted">Only a super admin can change the license of this engine.</p>
				{/if}
			</Card>
		</section>
	{/if}
</PageShell>
