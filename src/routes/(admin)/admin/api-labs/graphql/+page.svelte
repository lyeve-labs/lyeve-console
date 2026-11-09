<script lang="ts">
	import { Alert, Badge, Button, PageShell, SectionHeading, Textarea, confirm as confirmDialog } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { CONFIRM_FIELD, CONFIRMED } from '$lib/confirmation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Play } from '@lucide/svelte';
	import { GRAPHQL_URL, graphqlMutates, type LabResult } from '$lib/api/labs';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';
	import ApiLabsTabs from '$lib/components/ApiLabsTabs.svelte';
	import LabAnswer from '../LabAnswer.svelte';
	import NoSandbox from '../NoSandbox.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const superAdmin = $derived(data.user.roles.includes('super_admin'));
	const gqlResult = $derived((form as { graphql?: LabResult } | null)?.graphql ?? null);
	const gqlMutated = $derived((form as { mutated?: boolean } | null)?.mutated ?? false);

	let sending = $state(false);
	let document = $state('query {\n  \n}');
	let variables = $state('');

	const sendGraphql: SubmitFunction = async ({ cancel, formData }) => {
		if (graphqlMutates(document)) {
			const ok = await confirmDialog(
				'Send this mutation?',
				'It changes data on the engine you are signed in to, as you.',
				{ confirmLabel: 'Send it' },
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
	documentTitle="GraphQL - API labs"
	description="Send a real request to this engine and see the response."
	width="wide"
>
	<NoSandbox />

	{#if formError}
		<Alert tone="danger">{formError}</Alert>
	{/if}

	<ApiLabsTabs active="graphql" {superAdmin} />

	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>GraphQL</SectionHeading>
		<p class="text-xs text-muted">
			Sent to <span class="font-mono">{GRAPHQL_URL}</span>. The schema is generated from your
			content types, so its fields match what you built in the schema builder.
		</p>

		<form method="POST" action="?/graphql" use:enhance={sendGraphql}>
			<div class="flex flex-col gap-4">
				<Textarea
					id="lab-document"
					name="document"
					label="Query or mutation"
					rows={10}
					bind:value={document}
					required
				/>
				<Textarea
					id="lab-variables"
					name="variables"
					label="Variables"
					hint="Enter a JSON object, or leave it empty. Anything else is not sent."
					rows={4}
					bind:value={variables}
				/>
			</div>
			<div class="mt-4 flex items-center gap-3">
				<Button variant="primary" type="submit" loading={sending}>
					<Play size={ICON.sm} /> Send
				</Button>
				{#if graphqlMutates(document)}
					<Badge tone="warn" dot>This document mutates</Badge>
				{/if}
			</div>
		</form>

		{#if gqlResult}
			{#if gqlResult.status === 200 && gqlResult.body.includes('"errors"')}
				<!-- GraphQL answers 200 and puts the failure in the body, so a
				     status badge alone reads as success. -->
				<Alert tone="warn">
					The status is 200, but the body has an `errors` array. GraphQL reports failures
					inside a successful response, so check the body, not the status.
				</Alert>
			{/if}
			{#if gqlMutated}
				<Alert tone="brand">That was a mutation, so its changes are already applied.</Alert>
			{/if}
			<LabAnswer result={gqlResult} />
		{/if}
	</section>
</PageShell>
