<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Card,
		EmptyState,
		Field,
		Input,
		PageShell,
		SectionHeading,
		Table,
		toast,
		Pagination,
		SearchInput,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { MonitorSmartphone, Trash2 } from '@lucide/svelte';
	import { confirmed } from '$lib/forms.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { narrows } from '$lib/narrow';
	import { deviceLabel, deviceName, looksLikeThisDevice, type Device } from '$lib/api/devices';
	import { formatDateTime } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	let label = $state('');
	const suggestedName = $derived(deviceName(data.userAgent ?? ''));

	const thisOne = $derived(
		data.devices.find((d) => looksLikeThisDevice(d, data.userAgent)) ?? null,
	);

	// The endpoint takes no search, so the box narrows the page on screen and
	// the pager below still walks every device.
	let query = $state('');
	const visible = $derived(
		data.devices.filter((d) => narrows(query, deviceLabel(d), d.user_agent ? deviceName(d.user_agent) : '')),
	);

	const trustThis: SubmitFunction = () => {
		const subject = label;
		return async ({ result, update }) => {
			if (result.type !== 'failure') label = '';
			await update();
			if (result.type === 'success') toast.success(`Trusted ${subject}`);
		};
	};

	/**
	 * Forgetting a device is the security control on this page, so it asks, and
	 * it says what actually happens: the device is not blocked, it stops being
	 * remembered, and the next sign-in from it is treated as a new one.
	 */
	function forget(d: Device): SubmitFunction {
		return confirmed(
			`Forget ${deviceLabel(d)}?`,
			'It stops being a trusted device. Signing in from it again is treated as a new device.',
			{ confirmLabel: 'Forget', success: `Forgot ${deviceLabel(d)}` },
		);
	}
</script>

<PageShell
	title="Trusted devices"
	description="See the devices you trust, and forget any you no longer use."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Trusted devices"
			absent="Trusted devices are not included in this build."
		/>
	{:else}
		{#if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>This device</SectionHeading>
			{#if thisOne}
				<Alert tone="success">
					This device is already trusted, as {deviceLabel(thisOne)}.
				</Alert>
			{:else}
				<Card pad="md">
					<form method="POST" action="?/trust" use:enhance={trustThis} class="flex flex-col gap-4">
						<p class="max-w-prose text-sm text-muted">
							You can trust only the device you're using now. Each browser counts as its own device, so open this page in each browser you want to trust.
						</p>
						<!-- The label sits above the row and the hint under the input alone,
						     so the button stays level with the input box. -->
						<Field id="device-label" label="Name this device" required>
							{#snippet children(field)}
								<div class="flex flex-col items-start gap-3 sm:flex-row">
									<Input
										id={field.id}
										name="label"
										class="w-full sm:w-80"
										placeholder={suggestedName}
										hint="Something you will recognize in the list."
										bind:value={label}
										required
									/>
									<Button variant="primary" type="submit">Trust this device</Button>
								</div>
							{/snippet}
						</Field>
					</form>
				</Card>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Your trusted devices</SectionHeading>

			{#if data.devices.length === 0}
				<EmptyState
					title="No trusted devices yet"
					description="Every sign-in to your account is treated as coming from a new device."
				>
					{#snippet iconSnippet()}
						<MonitorSmartphone size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<ListToolbar label="Filter devices">
					{#snippet search()}
						<label for="device-search" class="sr-only">Search this page</label>
						<SearchInput id="device-search" bind:value={query} placeholder="Name or browser on this page" />
					{/snippet}
				</ListToolbar>
				{#if visible.length === 0}
					<EmptyState
						title="No devices match this search"
						description="The search covers this page only. Clear it, or go to the next page."
					/>
				{:else}
					<Table label="Your trusted devices">
						<thead>
							<tr>
								<th scope="col">Device</th>
								<th scope="col">Last seen</th>
								<th scope="col">Added</th>
								<th scope="col"><span class="sr-only">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{#each visible as d (d.id)}
								<tr>
									<td data-cell="nowrap">
										<div class="flex items-center gap-2">
											<span class="font-medium text-fg">{deviceLabel(d)}</span>
											{#if looksLikeThisDevice(d, data.userAgent)}
												<!-- Matched on the user agent, which two identical
												     browsers share, so it claims a resemblance and
												     not an identity. -->
												<Badge tone="brand">Looks like this one</Badge>
											{/if}
										</div>
										{#if d.user_agent}
											<div class="text-xs text-faint" title={d.user_agent}>
												{deviceName(d.user_agent)}
											</div>
										{/if}
									</td>
									<td data-cell="nowrap" class="text-xs text-faint">
										{formatDateTime(d.last_seen_at)}
									</td>
									<td data-cell="nowrap" class="text-xs text-faint">
										{formatDateTime(d.created_at)}
									</td>
									<td data-cell="nowrap">
										<div class="flex justify-end">
											<form method="POST" action="?/untrust" use:enhance={forget(d)}>
												<input type="hidden" name="id" value={d.id} />
												<Button
													variant="ghost"
													size="sm"
													type="submit"
													aria-label="Forget {deviceLabel(d)}"
												>
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
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.devices.length}
					total={data.total ?? undefined}
					hasNext={data.hasMore}
					noun="devices"
					href={pageHref('/admin/settings/devices', data.limit)}
				/>
			{/if}
		</section>
	{/if}
</PageShell>
