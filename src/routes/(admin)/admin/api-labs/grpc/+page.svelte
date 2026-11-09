<script lang="ts">
	import {
		Alert,
		Button,
		CopyButton,
		EmptyState,
		Input,
		PageShell,
		SectionHeading,
		Select,
		Textarea,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { CONFIRM_FIELD, CONFIRMED } from '$lib/confirmation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Network, Play } from '@lucide/svelte';
	import { grpcRouteParams, grpcRouteTakesBody, type LabResult } from '$lib/api/labs';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ApiLabsTabs from '$lib/components/ApiLabsTabs.svelte';
	import LabAnswer from '../LabAnswer.svelte';
	import NoSandbox from '../NoSandbox.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const superAdmin = $derived(data.user.roles.includes('super_admin'));
	const grpcResult = $derived((form as { grpc?: LabResult } | null)?.grpc ?? null);

	let sending = $state(false);

	let grpcRoute = $state('');
	let grpcValues = $state<Record<string, string>>({});
	const grpcParams = $derived(grpcRoute ? grpcRouteParams(grpcRoute) : []);
	const grpcWrites = $derived(grpcRoute ? grpcRouteTakesBody(grpcRoute) : false);
	// Each parameter box binds to its key, and a missing key is undefined,
	// which the kit's Input refuses. Seed the keys a route brings before its
	// boxes render.
	$effect.pre(() => {
		for (const n of grpcParams) if (grpcValues[n] === undefined) grpcValues[n] = '';
	});

	const sendGrpc: SubmitFunction = async ({ cancel, formData }) => {
		if (grpcWrites || grpcRoute.startsWith('DELETE ')) {
			const ok = await confirmDialog(
				'Run this call?',
				'It runs on the transcoding listener as you, and it changes data.',
				{ confirmLabel: 'Run it' },
			);
			if (!ok) {
				cancel();
				return;
			}
			formData.set(CONFIRM_FIELD, CONFIRMED);
		}
		sending = true;
		return async ({ update }) => {
			await update({ reset: false });
			sending = false;
		};
	};
</script>

<PageShell
	title="API labs"
	documentTitle="gRPC - API labs"
	description="Send a real request to this engine and see the response."
	width="wide"
>
	<NoSandbox />

	{#if formError}
		<Alert tone="danger">{formError}</Alert>
	{/if}

	<ApiLabsTabs active="grpc" {superAdmin} />

	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>gRPC</SectionHeading>
		{#if data.grpc.gate.state !== 'ok'}
			<!-- Only a 404 says the plugin is not here. A role refusal says the
			     role, and an outage offers a retry. -->
			<GateNotice
				gate={data.grpc.gate}
				title="the gRPC listener"
				absent="The gRPC listener is not included in this build, or it is turned off on this engine."
			/>
		{:else if !data.grpc.listening}
			<Alert tone="danger">
				The gRPC plugin is installed, but its listener is not running. The gRPC screen shows why.
			</Alert>
		{:else}
			<!-- Sent, not fetched. The engine's invoke route runs the call
			     inside the plugin, against the mux it built, so nothing here
			     addresses a host and the listener's own JWT check still
			     decides the answer. -->
			<Alert tone="brand">
				These paths go to the gRPC listener, which checks your token as it does for any caller.
			</Alert>
			<form method="POST" action="?/grpc" use:enhance={sendGrpc}>
				<div class="grid gap-4">
					<Select
						name="route"
						label="Transcoded route"
						bind:value={grpcRoute}
						options={data.grpc.routes.map((r) => ({ value: r, label: r }))}
						placeholder="Choose a route"
						searchable
					/>
					{#if grpcParams.length > 0}
						<div class="grid gap-4 sm:grid-cols-2">
							{#each grpcParams as name (name)}
								<Input
									name="g_{name}"
									label={name}
									bind:value={grpcValues[name]}
									placeholder="Required"
								/>
							{/each}
						</div>
					{/if}
					{#if grpcWrites}
						<Textarea name="body" label="Body" rows={8} placeholder={'{\n  "title": "Hello"\n}'} />
					{/if}
					<div class="flex items-center gap-3">
						<Button variant="primary" type="submit" loading={sending} disabled={!grpcRoute}>
							<Play size={ICON.sm} /> Run
						</Button>
						{#if grpcRoute}
							<CopyButton value={grpcRoute} label="Copy {grpcRoute}" />
						{/if}
					</div>
				</div>
			</form>
			{#if grpcResult}
				<LabAnswer result={grpcResult} />
			{/if}
			{#if data.grpc.routes.length === 0}
				<EmptyState
					title="No transcoded routes"
					description="The listener is running and serves only the health check."
				>
					{#snippet iconSnippet()}
						<Network size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{/if}
		{/if}
	</section>
</PageShell>
