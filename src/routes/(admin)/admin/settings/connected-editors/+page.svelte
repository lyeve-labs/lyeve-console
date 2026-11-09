<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { navigating } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		Alert,
		Badge,
		Banner,
		Button,
		DescriptionList,
		Drawer,
		EmptyState,
		Field,
		Input,
		PageShell,
		Pagination,
		SectionHeading,
		SegmentedControl,
		Skeleton,
		Table,
	} from '@lyeve-labs/ui-kit';
	import { Link2, RefreshCw } from '@lucide/svelte';
	import BuilderConnectionTabs from '$lib/components/BuilderConnectionTabs.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import StepUpField from '$lib/components/admin-tokens/StepUpField.svelte';
	import { confirmed, tracked } from '$lib/forms.svelte';
	import { expiresIn, normalizeUserCode, rolesLabel } from '$lib/device-login';
	import { formatDate, formatDateTime, plural, relativeTime } from '$lib/format';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';
	import {
		SAID,
		lifetimesUpTo,
		personOf,
		shortLabel,
		statusOf,
		type Connection,
		type ConnectionRequest,
	} from '$lib/api/connected-editors';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const PATH = '/admin/settings/connected-editors';

	/** Whatever the drawer's last submit answered. */
	interface DrawerAnswer {
		code?: string;
		request?: ConnectionRequest | null;
		codeError?: string;
		expired?: boolean;
		decided?: boolean;
		keyChanged?: boolean;
		lifetimeChanged?: boolean;
		stepUp?: { field: string; needsMfa: boolean };
		approvalUnavailable?: boolean;
		checkUnavailable?: boolean;
		withheld?: boolean;
		error?: string;
	}

	/** Every key an action answers with, each optional. */
	interface Answer {
		drawer?: DrawerAnswer;
		approved?: { expires_at: string };
		declined?: boolean;
		revoked?: string;
		revokeError?: string;
		revokedAll?: number;
		revokeAllError?: string;
	}

	const answer = $derived((form ?? {}) as Answer);
	const drawer = $derived(answer.drawer ?? null);

	/** The request a lookup found, for as long as it is still the one the code names. */
	type Held = { code: string; request: ConnectionRequest } | null;

	function nextHeld(prev: Held, d: DrawerAnswer | null): Held {
		if (!d) return prev;
		if (d.request && d.code) return { code: d.code, request: d.request };
		if (d.codeError || d.expired || d.decided || d.request === null) return null;
		return prev;
	}

	function initialDrawer(): DrawerAnswer | null {
		return (form as Answer | null)?.drawer ?? null;
	}

	function initiallyOpen(): boolean {
		return data.openApprove || initialDrawer() !== null;
	}

	let open = $state(initiallyOpen());
	let held = $state<Held>(nextHeld(null, initialDrawer()));
	let codeInput = $state(initialDrawer()?.code ?? '');
	let secret = $state('');
	let lifetimePick = $state('');
	let pending = $state<'lookup' | 'approve' | 'decline' | null>(null);
	let lookupForm = $state<HTMLFormElement | null>(null);
	let lastLooked = '';

	// A later answer moves what the drawer holds. The first one was read above,
	// so a page rendered without scripts shows it too.
	$effect(() => {
		const d = drawer;
		untrack(() => {
			held = nextHeld(held, d);
		});
	});

	const request = $derived(held && normalizeUserCode(codeInput) === held.code ? held.request : null);
	// The last answer, only while the field still shows the code it answered. Cancel
	// clears the field but not the answer, which would otherwise greet the next open.
	const answered = $derived(
		drawer && (drawer.code === codeInput || normalizeUserCode(codeInput) === drawer.code) ? drawer : null,
	);
	const lifetimes = $derived(request ? lifetimesUpTo(request.lifetime_days) : []);
	const lifetime = $derived(
		lifetimes.includes(Number(lifetimePick)) ? lifetimePick : String(request?.lifetime_days ?? ''),
	);
	const mfa = $derived(answered?.stepUp ? answered.stepUp.needsMfa : data.mfaEnrolled);

	/** The browser's own word on whether it is online. Approve, Decline and Revoke wait while it is not. */
	let online = $state(true);
	$effect(() => {
		online = navigator.onLine;
		const up = () => (online = true);
		const down = () => (online = false);
		window.addEventListener('online', up);
		window.addEventListener('offline', down);
		return () => {
			window.removeEventListener('online', up);
			window.removeEventListener('offline', down);
		};
	});

	// Focus lands in the code field whenever the drawer opens, the builder's
	// "Open your admin" link included.
	$effect(() => {
		if (!open) return;
		tick().then(() => document.getElementById('connected-editors-code')?.focus());
	});

	const approveReady = $derived(!!request && online && !answered?.approvalUnavailable);

	/** When a connection approved now with the chosen lifetime would end, never past what the engine said. */
	function expiryOf(r: ConnectionRequest, days: number): string {
		if (days >= r.lifetime_days) return r.would_expire_at;
		const chosen = Date.now() + days * 86_400_000;
		const cap = Date.parse(r.would_expire_at);
		return new Date(Number.isNaN(cap) ? chosen : Math.min(chosen, cap)).toISOString();
	}

	/** The code as typed, read the way the engine reads it, and looked up once the eighth character lands. */
	async function typed() {
		const code = normalizeUserCode(codeInput);
		if (!code) return;
		codeInput = code;
		if (code === held?.code || code === lastLooked || !online) return;
		lastLooked = code;
		await tick();
		lookupForm?.requestSubmit();
	}

	function close() {
		open = false;
		held = null;
		codeInput = '';
		secret = '';
		lastLooked = '';
	}

	const drawerSubmit: SubmitFunction = ({ action }) => {
		const kind = action.search.includes('decline') ? 'decline' : action.search.includes('approve') ? 'approve' : 'lookup';
		pending = kind;
		return async ({ result, update }) => {
			try {
				// The password goes after every decision, refused or not, so it never
				// outlives the submit that used it.
				if (kind !== 'lookup') secret = '';
				await update({ reset: false });
				if (kind !== 'lookup' && result.type === 'success') close();
				// A request someone else decided changed the list behind the drawer.
				if (result.type === 'failure' && (result.data as Answer | undefined)?.drawer?.decided) await invalidateAll();
			} finally {
				pending = null;
			}
		};
	};

	const revokeAll = tracked(
		confirmed('Revoke all builder connections?', 'Every connected browser stops editing immediately, and every waiting request is declined.', {
			confirmLabel: 'Revoke all',
			cancelLabel: 'Cancel',
		}),
	);

	function revokeOne(c: Connection): SubmitFunction {
		return confirmed(
			`Revoke ${personOf(c)}'s builder connection?`,
			'That browser stops editing immediately.',
			{ confirmLabel: 'Revoke' },
		);
	}

	const anyActive = $derived(
		data.connections.some((c) => c.status === 'approved') || (data.total ?? 0) > data.connections.length,
	);

	const loading = $derived(navigating.to?.url.pathname === PATH);
</script>

{#snippet keyDetail()}
	{#if request}
		<span class="font-mono text-fg">{request.fingerprint}</span>
		<span class="block text-xs text-muted">Check that the builder shows the same key.</span>
	{/if}
{/snippet}

{#snippet fromDetail()}
	{#if request}
		<span class="break-all text-fg">{request.origin || 'No address reported'}</span>
		<span class="block text-xs text-muted">Sent by the browser and not verified.</span>
	{/if}
{/snippet}

{#snippet nameDetail()}
	{#if request}
		<span dir="auto" title={request.label}>{shortLabel(request.label)}</span>
	{/if}
{/snippet}

<PageShell
	title="Builder connections"
	description="Approve and revoke the browsers that edit pages from the builder."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#if !online}
		<Banner tone="warn">You're offline. Changes on this page wait until you reconnect.</Banner>
	{/if}

	<BuilderConnectionTabs active="connections" owner={data.owner} />

	{#if data.gate.state === 'withheld'}
		<NotEnabled
			level={2}
			title="Builder connections"
			description={SAID.withheld}
		/>
	{:else if data.gate.state !== 'ok'}
		<GateNotice level={2} gate={data.gate} title="Builder connections" absent="Builder connections are not included in this build." />
	{:else}
		{#if answer.approved}
			<Alert tone="success" autoDismiss>Connection approved. That browser can edit pages now.</Alert>
		{:else if answer.declined}
			<Alert tone="success" autoDismiss>Request declined.</Alert>
		{:else if answer.revoked !== undefined}
			<Alert tone="success" autoDismiss>{answer.revoked}'s connection revoked.</Alert>
		{:else if answer.revokedAll !== undefined}
			<Alert tone="success" autoDismiss>
				{answer.revokedAll} builder {plural(answer.revokedAll, 'connection')} revoked.
			</Alert>
		{:else if answer.revokeError}
			<Alert tone="danger">{answer.revokeError}</Alert>
		{:else if answer.revokeAllError}
			<Alert tone="danger" dismissible>
				<p>{answer.revokeAllError}</p>
				<div class="mt-3">
					<Button variant="secondary" size="sm" type="submit" form="revoke-all" disabled={!online}>
						<RefreshCw size={ICON.sm} aria-hidden="true" /> Try again
					</Button>
				</div>
			</Alert>
		{/if}

		<section class="flex flex-col gap-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<Button
					variant="primary"
					href="{PATH}?approve"
					onclick={(e) => {
						e.preventDefault();
						open = true;
					}}
				>
					<Link2 size={ICON.sm} aria-hidden="true" /> Approve connection
				</Button>
				{#if data.owner}
					<form id="revoke-all" method="POST" action="?/revokeAll" use:enhance={revokeAll.enhance}>
						<Button variant="danger" type="submit" loading={revokeAll.pending} disabled={!anyActive || !online}>
							Revoke all
						</Button>
					</form>
				{/if}
			</div>

			{#if loading}
				<div class="flex flex-col gap-2" data-testid="connections-loading">
					{#each [1, 2, 3, 4, 5] as row (row)}
						<Skeleton height="2.5rem" />
					{/each}
				</div>
			{:else if data.connections.length === 0}
				<EmptyState
					level={2}
					title="No builder connections yet"
					description="Connect from the builder, then approve the connection here with the code it shows."
				>
					{#snippet iconSnippet()}
						<Link2 size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Builder connections">
					<thead>
						<tr>
							<th scope="col">Approved by</th>
							<th scope="col">Key</th>
							<th scope="col">Approved on</th>
							<th scope="col">Last used</th>
							<th scope="col">Expires</th>
							<th scope="col">Status</th>
							<th scope="col"><span class="sr-only">Revoke</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.connections as c (c.id)}
							{@const status = statusOf(c.status)}
							<tr>
								<td data-cell="nowrap">
									<span class="font-medium text-fg">{personOf(c)}</span>
									{#if c.label}
										<div class="text-xs text-faint" dir="auto" title={c.label}>{shortLabel(c.label)}</div>
									{/if}
								</td>
								<td data-cell="nowrap"><span class="font-mono text-xs">{c.fingerprint}</span></td>
								<td data-cell="nowrap" class="text-xs text-faint" title={formatDateTime(c.approved_at)}>
									{formatDate(c.approved_at)}
								</td>
								<td data-cell="nowrap" class="text-xs text-faint" title={formatDateTime(c.last_used_at)}>
									{c.last_used_at ? relativeTime(c.last_used_at) : 'Never'}
								</td>
								<td data-cell="nowrap" class="text-xs text-faint" title={formatDateTime(c.expires_at)}>
									{formatDate(c.expires_at)}
								</td>
								<td data-cell="nowrap"><Badge tone={status.tone} dot>{status.label}</Badge></td>
								<td data-cell="nowrap">
									{#if c.status === 'approved'}
										<div class="flex justify-end">
											<form method="POST" action="?/revoke" use:enhance={revokeOne(c)}>
												<input type="hidden" name="id" value={c.id} />
												<input type="hidden" name="person" value={personOf(c)} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													disabled={!online}
													aria-label="Revoke {personOf(c)}'s connection"
												>
													Revoke
												</Button>
											</form>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.connections.length}
					total={data.total ?? undefined}
					hasNext={data.hasMore}
					noun="connections"
					href={pageHref(PATH, data.limit)}
				/>
			{/if}
		</section>
	{/if}
</PageShell>

{#if data.gate.state === 'ok'}
<Drawer bind:open title="Approve a connection" onclose={close}>
	<div class="flex flex-col gap-5">
		<p class="text-sm text-muted">
			Approve only a code you started in the builder in the last 10 minutes. If someone sends you a code, they
			are asking for access to your pages.
		</p>

		<form bind:this={lookupForm} method="POST" action="?/lookup" use:enhance={drawerSubmit}>
			<!-- The label sits above the row and the message under the input alone,
			     so Find request stays level with the input box whatever shows under it. -->
			<Field id="connected-editors-code" label="Code">
				{#snippet children(field)}
					<div class="flex items-start gap-3">
						<Input
							id={field.id}
							name="code"
							class="min-w-0 flex-1"
							placeholder="K7F3-A2M9"
							autocomplete="off"
							spellcheck={false}
							bind:value={codeInput}
							oninput={typed}
							error={answered?.codeError}
							hint={request ? undefined : 'Eight characters, with or without the dash.'}
						/>
						<Button variant="secondary" type="submit" loading={pending === 'lookup'}>Find request</Button>
					</div>
				{/snippet}
			</Field>
		</form>

		{#if answered?.withheld}
			<Alert tone="warn">{SAID.withheld}</Alert>
		{/if}
		{#if answered?.expired}
			<Alert tone="warn">{SAID.expired}</Alert>
		{/if}
		{#if answered?.decided}
			<Alert tone="warn">{SAID.decided}</Alert>
		{/if}
		{#if answered?.keyChanged}
			<Alert tone="warn">{SAID.keyChanged}</Alert>
		{/if}
		{#if answered?.lifetimeChanged}
			<Alert tone="warn">{SAID.lifetime}</Alert>
		{/if}
		{#if answered?.error}
			<Alert tone="danger">{answered.error}</Alert>
		{/if}

		{#if request}
			<form
				id="connected-editors-approve"
				method="POST"
				action="?/approve"
				use:enhance={drawerSubmit}
				class="flex flex-col gap-4 border-t border-line pt-5"
			>
				<input type="hidden" name="code" value={held?.code ?? ''} />
				<input type="hidden" name="fingerprint" value={request.fingerprint} />
				<input type="hidden" name="code_expires_at" value={request.code_expires_at} />

				<SectionHeading level={3}>Check this request</SectionHeading>

				{#if !request.same_network}
					<Alert tone="warn">
						This request came from a different network than this browser. Approve it only if you started it yourself.
					</Alert>
				{/if}

				<DescriptionList
					items={[
						{ term: 'Browser name', value: request.label, detail: nameDetail },
						{ term: 'Key', value: request.fingerprint, detail: keyDetail },
						{ term: 'From', value: request.origin, detail: fromDetail },
						{ term: 'Requested from', value: request.requester_network || 'Unknown address' },
						{ term: 'Your address', value: request.approver_address || 'Unknown address' },
						{ term: 'Code expires', value: expiresIn(request.code_expires_at) },
						{
							term: 'Access',
							value: 'Read and write pages, sections and the theme, and read entries of the content types open to the builder.',
						},
						{
							term: 'Approved as',
							value: `${data.email}, with the ${rolesLabel(data.roles)} ${plural(data.roles.length, 'role')}`,
						},
						...(data.tenant ? [{ term: 'Tenant', value: data.tenant }] : []),
						{ term: 'Expires', value: formatDate(expiryOf(request, Number(lifetime))) },
					]}
				/>

				<SegmentedControl
					label="Valid for"
					name="lifetime_days"
					value={lifetime}
					options={lifetimes.map((d) => ({ value: String(d), label: `${d} days` }))}
					onchange={(v) => (lifetimePick = v)}
				/>

				{#if answered?.approvalUnavailable}
					<Alert tone="warn">{SAID.approvalUnavailable}</Alert>
				{:else}
					<StepUpField id="connected-editors-step-up" {mfa} bind:value={secret} error={answered?.stepUp?.field} />
				{/if}

				{#if answered?.checkUnavailable}
					<Alert tone="warn">{SAID.checkUnavailable}</Alert>
				{/if}

				{#if !online}
					<p id="approve-blocked" class="text-sm text-muted">You're offline.</p>
				{/if}
			</form>
			<!-- Decline posts from a form of its own, so Approve is the approve form's
			     only submit button: Enter in the password field approves, and the
			     password never travels with a decline. -->
			<form id="connected-editors-decline" method="POST" action="?/decline" use:enhance={drawerSubmit} hidden>
				<input type="hidden" name="code" value={held?.code ?? ''} />
				<input type="hidden" name="code_expires_at" value={request.code_expires_at} />
			</form>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="secondary" onclick={close}>Cancel</Button>
		<!-- Approve and Decline appear once a lookup found a request, so the
		     footer never offers a decision about nothing. -->
		{#if request}
			<Button
				variant="secondary"
				type="submit"
				form="connected-editors-decline"
				loading={pending === 'decline'}
				disabled={!online}
			>
				Decline
			</Button>
			<Button
				variant="primary"
				type="submit"
				form="connected-editors-approve"
				loading={pending === 'approve'}
				disabled={!approveReady}
				aria-describedby={online ? undefined : 'approve-blocked'}
			>
				Approve
			</Button>
		{/if}
	{/snippet}
</Drawer>
{/if}
