<script lang="ts">
	import { enhance } from '#lib/enhance.ts';
	import { Alert, Button, Card, DescriptionList, EmptyState, Input, PageShell } from '@lyeve-labs/ui-kit';
	import { CircleCheck, CircleX, Clock, SearchX, ShieldAlert, TriangleAlert } from '@lucide/svelte';
	import { ICON } from '#lib/icon.ts';
	import { relativeTime } from '#lib/format.ts';
	import StepUpField from '#lib/components/admin-tokens/StepUpField.svelte';
	import { expiresIn, rolesLabel, sessionLength, tenantLabel, type DeviceOutcome } from '#lib/device-login.ts';
	import { BUSY, OUTAGE } from '#lib/outage.ts';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/** A decision just made wins over what the reload read back. */
	const view = $derived(
		((form && 'outcome' in form ? form.outcome : undefined) as DeviceOutcome | 'busy' | 'refused' | undefined) ??
			data.view
	);
	const refusal = $derived(
		form && 'refusal' in form && typeof form.refusal === 'string' && form.refusal ? form.refusal : data.refusal
	);

	/** Whether the view reports a decision just posted, rather than the page's own read. */
	const decided = $derived(!!form && 'outcome' in form);
	const DECISION_UNKNOWN = 'Could not confirm the decision. Check whether the device was signed in, then try again.';

	/** A refused confirmation: the request is still open and the field says why. */
	const stepUp = $derived(form && 'stepUp' in form ? form.stepUp : null);
	const mfa = $derived(data.mfaEnrolled || !!stepUp?.needsMfa);
	let secret = $state('');

	/** Which button is waiting on the engine, so only that one spins. */
	let pending = $state<'approve' | 'deny' | null>(null);

	const items = $derived(
		data.request
			? [
					{ term: 'Code', value: data.request.user_code },
					{ term: 'Client (unverified)', value: data.request.client_name },
					{ term: 'Requested from', value: data.request.requester_ip || 'Unknown address' },
					{
						term: 'Your address',
						value: data.request.same_address
							? `${data.request.approver_ip} (the same address)`
							: data.request.approver_ip || 'Unknown address',
					},
					{ term: 'Requested', value: relativeTime(data.request.created_at) },
					{ term: 'Signs in to', value: tenantLabel(data.request.tenant_id) },
					{ term: 'Session roles', value: rolesLabel(data.request.roles) },
					{ term: 'Session lasts', value: sessionLength(data.request.session_expires_in) },
					{ term: 'Code expires', value: expiresIn(data.request.expires_at) },
				]
			: []
	);

	/** The outcomes that end the flow, and the words for each. */
	const outcomes: Record<string, { title: string; description: string }> = {
		approved: {
			title: 'Device signed in',
			description: 'The device is now signed in as you. Go back to it. You can close this page.',
		},
		denied: {
			title: 'Sign-in denied',
			description: 'The device was not signed in.',
		},
		expired: {
			title: 'This code has expired',
			description: 'A code lasts ten minutes. Start the sign-in again on the device and enter the new code.',
		},
		decided: {
			title: 'Already decided',
			description: 'Someone already approved or denied this sign-in. Start a new one on the device if you need to.',
		},
		unknown: {
			title: 'No sign-in is waiting for this code',
			description: 'Check the code shown on the device. It is eight letters and digits, like WDJB-MJHT.',
		},
		forbidden: {
			title: 'You cannot approve this sign-in',
			description: 'Only an admin or a super admin can approve a device sign-in.',
		},
	};

	/**
	 * What a decision just posted is read out as. The form the reader pressed
	 * in unmounts with the request card, so focus falls to the page, and only
	 * a region already on the page announces what replaced it. A failure, a
	 * rate refusal and a 402 draw the kit's alert, which is read out already.
	 */
	const spoken = $derived.by(() => {
		if (!decided) return '';
		const outcome = outcomes[view];
		return outcome ? `${outcome.title}. ${outcome.description}` : '';
	});

	const showCodeField = $derived(view === 'enter' || view === 'unknown' || view === 'expired' || view === 'decided');
</script>

<PageShell
	width="narrow"
	title="Approve a device sign-in"
	documentTitle="Approve a device"
	description="Signed in as {data.email}. A device you approve gets a short session as you."
	back={{ href: '/admin', label: 'Dashboard' }}
>
	<div class="space-y-6">
		<div class="sr-only" aria-live="polite" aria-atomic="true" data-testid="device-live">{spoken}</div>
		{#if view === 'pending' && data.request}
			<Card heading="Sign-in request" headingLevel={2} pad="lg">
				<div class="space-y-5">
					<DescriptionList {items} layout="inline" />
					<Alert tone="warn" title="Approve only if you started this sign-in yourself just now.">
						Check that the code matches the one your terminal shows. Approving hands the device a session with
						your roles. If you did not just run a sign-in, deny it.
					</Alert>
					{#if stepUp?.error}
						<Alert tone="danger">{stepUp.error}</Alert>
					{/if}
					<form
						id="approve-form"
						method="POST"
						action="?/approve"
						class="space-y-5"
						use:enhance={() => {
							pending = 'approve';
							return async ({ update }) => {
								await update();
								pending = null;
								secret = '';
							};
						}}
					>
						<input type="hidden" name="code" value={data.request.user_code} />
						<StepUpField id="device-step" {mfa} bind:value={secret} error={stepUp?.field || undefined} />
					</form>
					<div class="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
						<form
							method="POST"
							action="?/deny"
							use:enhance={() => {
								pending = 'deny';
								return async ({ update }) => {
									await update();
									pending = null;
								};
							}}
						>
							<input type="hidden" name="code" value={data.request.user_code} />
							<Button type="submit" variant="secondary" full loading={pending === 'deny'} disabled={pending !== null}>
								Deny
							</Button>
						</form>
						<div>
							<Button
								type="submit"
								form="approve-form"
								variant="primary"
								full
								loading={pending === 'approve'}
								disabled={pending !== null}
							>
								Approve
							</Button>
						</div>
					</div>
				</div>
			</Card>
		{:else if view === 'busy'}
			<Alert tone="warn" title={BUSY.title}>{BUSY.body}</Alert>
			<Button href="/admin/device?code={encodeURIComponent(data.code)}" variant="secondary">Try again</Button>
		{:else if view === 'refused'}
			<Alert tone="warn" title="Device sign-in is not available">{refusal}</Alert>
		{:else if view === 'error'}
			<!-- An approval or denial can land before the connection drops, and an
			     engine refusal with no sentence lands here too, so a failed
			     decision claims nothing about the device or the engine. -->
			{#if decided}
				<Alert tone="danger">{DECISION_UNKNOWN}</Alert>
			{:else}
				<Alert tone="danger" title={OUTAGE.title}>{OUTAGE.body}</Alert>
			{/if}
			<Button href="/admin/device?code={encodeURIComponent(data.code)}" variant="secondary">Try again</Button>
		{:else if view !== 'enter'}
			{@const outcome = outcomes[view]}
			<EmptyState level={2} title={outcome.title} description={outcome.description}>
				{#snippet iconSnippet()}
					{#if view === 'approved'}
						<CircleCheck size={ICON.lg} aria-hidden="true" />
					{:else if view === 'denied'}
						<CircleX size={ICON.lg} aria-hidden="true" />
					{:else if view === 'expired'}
						<Clock size={ICON.lg} aria-hidden="true" />
					{:else if view === 'forbidden'}
						<ShieldAlert size={ICON.lg} aria-hidden="true" />
					{:else if view === 'decided'}
						<TriangleAlert size={ICON.lg} aria-hidden="true" />
					{:else}
						<SearchX size={ICON.lg} aria-hidden="true" />
					{/if}
				{/snippet}
			</EmptyState>
		{/if}

		{#if showCodeField}
			<Card heading={view === 'enter' ? 'Enter the code' : 'Try another code'} headingLevel={2} pad="lg">
				<form method="GET" class="space-y-5">
					<Input
						id="code"
						name="code"
						label="Code from the device"
						hint="Shown by the command that started the sign-in, for example WDJB-MJHT."
						placeholder="XXXX-XXXX"
						autocomplete="off"
						autocapitalize="characters"
						spellcheck="false"
						maxlength={16}
						mono
						required
						value={view === 'unknown' ? data.code : ''}
					/>
					<Button type="submit" variant="primary">Continue</Button>
				</form>
			</Card>
		{/if}
	</div>
</PageShell>
