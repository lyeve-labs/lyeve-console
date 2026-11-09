<script lang="ts">
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import RateLimitTabs from '$lib/components/RateLimitTabs.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		Alert,
		Badge,
		Button,
		Card,
		Drawer,
		Input,
		PageShell,
		SectionHeading,
		SegmentedControl,
		Table,
		Toggle,
		toast,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { confirmed, drawerFailure, tracked } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Gauge, Plus, Trash2 } from '@lucide/svelte';
	import {
		addressLimit,
		rateLabel,
		type AddressEntry,
		type AddressList,
	} from '$lib/api/rate-limit';
	import { atLimit } from '$lib/api/limits';
	import { formatCount, plural } from '$lib/format';
	import { ICON } from '$lib/icon';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/*
	 * Every form here reports through the one `form`, so each failure names the
	 * action that caused it. A drawer shows only its own action's failure, and
	 * only one that came back after it opened, so a failed delete never reads
	 * as a failure of the next form opened. The page shows the row actions'.
	 */
	const failure = drawerFailure(() => form as { action?: string; error?: string; lockout?: string } | null, ['limit', 'address']);
	const refusal = $derived(formRefusal(failure.page));
	const formError = $derived(failure.page?.error ?? '');
	const limitFailure = $derived(failure.drawer?.action === 'limit' ? failure.drawer : null);
	const addressFailure = $derived(failure.drawer?.action === 'address' ? failure.drawer : null);
	const lockout = $derived(addressFailure?.lockout ?? '');

	const limitRead = $derived(data.limit.ok ? data.limit.value : null);
	const own = $derived(limitRead?.tenant_global ?? null);
	const install = $derived(limitRead?.install_global ?? null);
	const addresses = $derived(data.addresses.ok ? data.addresses.value : null);
	const entries = $derived(addresses?.rules ?? []);
	// The plugin refuses a new limit or a new address without the license, so
	// both stay disabled beside the sentence that says why. Clearing a limit
	// and removing an entry are always allowed and stay live.
	const limitLicensed = $derived(limitRead?.licensed !== false);
	const addressesLicensed = $derived(addresses?.licensed !== false);
	const entryLimit = $derived(addresses ? addressLimit(addresses) : null);
	const allow = $derived(entries.filter((e) => e.list === 'allow'));
	const deny = $derived(entries.filter((e) => e.list === 'deny'));

	let limitOpen = $state(false);
	let rate = $state('10');
	let burst = $state('20');
	let limitEnabled = $state(true);

	function openLimit() {
		failure.opened();
		rate = String(own?.rate ?? install?.rate ?? 10);
		burst = String(own?.burst ?? install?.burst ?? 20);
		limitEnabled = own?.enabled ?? true;
		limitOpen = true;
	}

	const saveLimit = tracked(() => async ({ result, update }) => {
		if (result.type !== 'failure') limitOpen = false;
		await update();
		if (result.type === 'success') toast.success('Tenant limit saved.');
	});

	let addressOpen = $state(false);
	let cidr = $state('');
	let list = $state<AddressList>('allow');
	let note = $state('');

	function openAddress(which: AddressList) {
		failure.opened();
		cidr = '';
		list = which;
		note = '';
		addressOpen = true;
	}

	const saveAddress = tracked(() => {
		const subject = cidr;
		const where = list;
		return async ({ result, update }) => {
			if (result.type !== 'failure') addressOpen = false;
			await update();
			if (result.type === 'success') toast.success(`Added ${subject} to the ${where} list`);
		};
	});

	function removeAddress(e: AddressEntry): SubmitFunction {
		return confirmed(
			`Remove ${e.cidr} from the ${e.list} list?`,
			e.list === 'allow'
				? 'Requests from it are counted against the tenant rules again.'
				: 'Requests from it are served again from the next request.',
			{ confirmLabel: 'Delete', success: `Removed ${e.cidr}` },
		);
	}

	const clearLimit = confirmed(
		'Clear the tenant limit?',
		'This tenant goes back to the global limit alone.',
		{ confirmLabel: 'Clear', success: 'Tenant limit cleared.' },
	);
</script>

{#snippet addressCard(which: AddressList, rows: AddressEntry[], title: string)}
	<Card pad="md">
		<div class="flex flex-col gap-3">
			<div class="flex items-center justify-between gap-2">
				<SectionHeading level={3}>{title}</SectionHeading>
				<Button
					variant="secondary"
					size="sm"
					onclick={() => openAddress(which)}
					disabled={!addressesLicensed}
					aria-describedby={addressesLicensed ? undefined : 'address-license'}
				>
					<Plus size={ICON.sm} /> New address
				</Button>
			</div>
			{#if rows.length === 0}
				<p class="text-sm text-muted">
					{which === 'allow' ? 'No address skips the rules.' : 'No address is refused.'}
				</p>
			{:else}
				<Table label={title}>
					<thead>
						<tr>
							<th scope="col">Address</th>
							<th scope="col">Note</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each rows as e (e.id)}
							<tr>
								<td data-cell="nowrap" class="font-mono text-xs">{e.cidr}</td>
								<td class="text-xs text-muted">{e.note || '-'}</td>
								<td data-cell="nowrap">
									<div class="flex justify-end">
										<form method="POST" action="?/deleteAddress" use:enhance={removeAddress(e)}>
											<input type="hidden" name="id" value={e.id} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Delete {e.cidr}">
												<Trash2 size={ICON.sm} class="text-danger" />
											</Button>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</div>
	</Card>
{/snippet}

<PageShell
	title="Tenant rate limits"
	description="Set this tenant's own limit and address lists."
	width="wide"
	back={{ href: '/admin/settings/rate-limits', label: 'Rate limits' }}
>
	<RateLimitTabs active="tenant" />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Rate limits"
			absent="Rate limiting is not included in this build."
		/>
	{:else}
		<FormErrors message={formError} refused={refusal} />

		<section class="flex flex-col gap-4" aria-label="Tenant limit">
			<SectionHeading level={2}>Tenant limit</SectionHeading>
			{#if !data.limit.ok}
				<GateNotice gate={data.limit.gate} title="Tenant limit" absent="The tenant limit needs a newer version of the rate limit plugin." />
			{:else}
				<Card pad="md">
					<div class="flex flex-wrap items-start justify-between gap-4">
						<div class="flex flex-col gap-1 text-sm">
							{#if own}
								<p class="text-fg">
									<span class="font-mono">{rateLabel(own.rate)}</span>, bursts of {formatCount(own.burst)}
									<Badge tone={own.enabled ? 'success' : 'neutral'} dot>{own.enabled ? 'Enforced' : 'Off'}</Badge>
								</p>
							{:else}
								<p class="text-fg">This tenant has no limit of its own.</p>
							{/if}
							<p class="text-muted">
								{#if install && install.enabled}
									The global limit of {rateLabel(install.rate)} with bursts of {formatCount(install.burst)} also applies, so a tenant limit can only make it stricter.
								{:else}
									No global limit is set.
								{/if}
							</p>
						</div>
						<div class="flex items-center gap-2">
							{#if own}
								<form method="POST" action="?/clearLimit" use:enhance={clearLimit}>
									<Button variant="secondary" size="sm" type="submit">Clear</Button>
								</form>
							{/if}
							<Button
								variant="secondary"
								size="sm"
								onclick={openLimit}
								disabled={!limitLicensed}
								aria-describedby={limitLicensed ? undefined : 'limit-license'}
							>
								<Gauge size={ICON.sm} />
								{own ? 'Edit' : 'Set a limit'}
							</Button>
						</div>
					</div>
					{#if !limitLicensed}
						<p id="limit-license" class="mt-3 text-xs text-faint">
							Setting a tenant limit is not enabled on this engine. You can always clear it.
						</p>
					{/if}
				</Card>
			{/if}
		</section>

		<section class="flex flex-col gap-4" aria-label="Address lists">
			<div class="flex flex-wrap items-center gap-2">
				<SectionHeading level={2}>Address lists</SectionHeading>
				{#if entryLimit}
					<Badge tone={atLimit(entryLimit) ? 'warn' : 'neutral'}>
						{#if entryLimit.limit !== null}
							{formatCount(entryLimit.current)} of {formatCount(entryLimit.limit)} entries
						{:else}
							{formatCount(entryLimit.current)} {plural(entryLimit.current, 'entry', 'entries')}
						{/if}
					</Badge>
				{/if}
			</div>
			<p class="text-sm text-muted">
				An allowed address skips this tenant's rules. A denied one is refused with 403 before any rule is counted.
				An address on both lists is allowed.
			</p>
			{#if !data.addresses.ok}
				<GateNotice
					gate={data.addresses.gate}
					title="Address lists"
					absent="Address lists need a newer version of the rate limit plugin."
				/>
			{:else}
				{#if !addressesLicensed}
					<div id="address-license">
						<Alert tone="brand">
							Adding an address is not enabled on this engine. Saved entries still apply, and you can always remove one.
						</Alert>
					</div>
				{/if}
				<div class="grid gap-4 lg:grid-cols-2">
					{@render addressCard('allow', allow, 'Allow list')}
					{@render addressCard('deny', deny, 'Deny list')}
				</div>
			{/if}
		</section>
	{/if}
</PageShell>

<Drawer bind:open={limitOpen} title="Tenant limit">
	<form id="tenant-limit-form" method="POST" action="?/setLimit" use:enhance={saveLimit.enhance}>
		<div class="flex flex-col gap-4">
			<FormErrors message={limitFailure?.error} refused={limitFailure ? formRefusal(limitFailure) : null} />
			<Input
				id="tenant-rate"
				name="rate"
				label="Rate, requests per second"
				hint={install?.enabled ? `At most ${install.rate}, the global rate.` : 'Sustained requests per second.'}
				bind:value={rate}
				required
			/>
			<Input
				id="tenant-burst"
				name="burst"
				label="Burst"
				hint={install?.enabled ? `At most ${install.burst}, the global burst.` : 'How many requests can arrive at once.'}
				bind:value={burst}
				required
			/>
			<input type="hidden" name="enabled" value={limitEnabled ? 'true' : 'false'} />
			<Toggle id="tenant-limit-enabled" label="Enforce this limit" bind:checked={limitEnabled} />
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (limitOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="tenant-limit-form" loading={saveLimit.pending}>Save</Button>
	{/snippet}
</Drawer>

<Drawer bind:open={addressOpen} title="New address">
	<form id="address-form" method="POST" action="?/addAddress" use:enhance={saveAddress.enhance}>
		<div class="flex flex-col gap-4">
			{#if lockout}
				<!-- The plugin's sentence says only that it was refused. This says why,
				     and how to proceed, beside the entry that caused it. -->
				<Alert tone="danger" title="That entry would lock you out">
					<p>
						{lockout} covers the address you are signed in from, and nothing on the allow list covers it. Saving it would lock you out of the console, and only someone signing in from another address could undo that.
					</p>
					<p class="mt-2">
						Add your own address to the allow list first, then deny the range. An allowed address is served
						whatever the deny list says.
					</p>
				</Alert>
			{:else}
				<FormErrors message={addressFailure?.error} refused={addressFailure ? formRefusal(addressFailure) : null} />
			{/if}
			<SegmentedControl
				label="List"
				name="list"
				bind:value={list}
				options={[
					{ value: 'allow', label: 'Allow' },
					{ value: 'deny', label: 'Deny' },
				]}
			/>
			<Input
				id="address-cidr"
				name="cidr"
				label="Address or range"
				placeholder="203.0.113.0/24"
				hint="One IPv4 or IPv6 address, or a CIDR range."
				bind:value={cidr}
				required
			/>
			<Input id="address-note" name="note" label="Note" hint="Why it is here, for whoever reads the list next." bind:value={note} />
			{#if list === 'deny'}
				<p class="text-xs text-muted">
					A deny entry that covers the address you are signed in from is refused unless that address is on the
					allow list.
				</p>
			{/if}
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (addressOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="address-form" loading={saveAddress.pending}>Create</Button>
	{/snippet}
</Drawer>
