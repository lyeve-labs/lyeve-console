<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		EmptyState,
		Input,
		PageShell,
		SearchInput,
		SectionHeading,
		Table,
		Textarea,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { CONFIRM_FIELD, CONFIRMED } from '$lib/confirmation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Play, Terminal } from '@lucide/svelte';
	import { RISK_LABELS, pathParams, riskOf, riskTone, type LabEndpoint, type LabResult } from '$lib/api/labs';
	import { httpStatusTone } from '$lib/tones';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';
	import ApiLabsTabs from '$lib/components/ApiLabsTabs.svelte';
	import LabAnswer from './LabAnswer.svelte';
	import NoSandbox from './NoSandbox.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const restResult = $derived((form as { rest?: LabResult } | null)?.rest ?? null);
	const superAdmin = $derived(data.user.roles.includes('super_admin'));

	let narrow = $state('');
	let sending = $state(false);

	const visible = $derived(
		narrow.trim()
			? data.endpoints.filter((e) =>
					`${e.method} ${e.path} ${e.summary}`.toLowerCase().includes(narrow.trim().toLowerCase()),
				)
			: data.endpoints,
	);

	let selectedId = $state('');
	const selected = $derived<LabEndpoint | null>(
		data.endpoints.find((e) => e.id === selectedId) ?? null,
	);
	const selectedRisk = $derived(selected ? riskOf(selected.method) : 'read');
	// The answer is compared with the route it was sent to, which is the one
	// named in the result, not whichever row is selected now.
	const expectedFor = $derived(
		restResult ? (data.endpoints.find((e) => e.method === restResult.method && samePath(e.path, restResult.path)) ?? null) : null,
	);
	function samePath(template: string, sent: string): boolean {
		const want = template.split('/');
		const got = sent.split('?')[0].split('/');
		return want.length === got.length && want.every((seg, k) => (seg.startsWith('{') && seg.endsWith('}') ? got[k] !== '' : seg === got[k]));
	}

	let body = $state('');

	function choose(e: LabEndpoint) {
		selectedId = e.id;
		body = e.requestBody?.example ?? '';
	}

	/**
	 * A send that changes something asks first and names what it will hit.
	 * A tester pointed at a real instance is one click from deleting a row
	 * they meant to read.
	 */
	const sendRest: SubmitFunction = async ({ cancel, formData }) => {
		if (!selected) {
			cancel();
			return;
		}
		if (selectedRisk !== 'read') {
			const verb = selectedRisk === 'destructive' ? 'delete from' : 'write to';
			const ok = await confirmDialog(
				`Send ${selected.method} ${selected.path}?`,
				`This will ${verb} the engine you are signed in to, as you. This is not a test run.`,
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
	description="Send a real request to this engine and see the response."
	width="wide"
>
	<NoSandbox />

	{#if data.source === 'catalog'}
		<Alert tone="danger">
			Could not load the engine's API document, so this is the catalog built into the console and may
			miss an endpoint this build serves. Reload the page to try again.
		</Alert>
	{/if}

	{#if formError}
		<Alert tone="danger">{formError}</Alert>
	{/if}

	<ApiLabsTabs active="rest" {superAdmin} />

	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>Choose an endpoint</SectionHeading>
		<label for="endpoint-narrow" class="sr-only">Search endpoints</label>
		<SearchInput id="endpoint-narrow" bind:value={narrow} placeholder="Search {data.endpoints.length} endpoints" />

		{#if visible.length === 0}
			<EmptyState title="No endpoints match this search" description="Try another name or path.">
				{#snippet iconSnippet()}
					<Terminal size={ICON.lg} />
				{/snippet}
			</EmptyState>
		{:else}
			<div class="max-h-72 overflow-auto rounded border border-line">
				<Table label="Choose an endpoint">
					<tbody>
						{#each visible.slice(0, 200) as e (e.id)}
							<tr>
								<td data-cell="nowrap">
									<Badge tone={riskTone(riskOf(e.method))}>{e.method}</Badge>
								</td>
								<!-- The path keeps its width and the box scrolls sideways. Squeezed
								     by the summary, it stacked one character per line. -->
								<td class="min-w-56 font-mono text-xs [overflow-wrap:anywhere]">{e.path}</td>
								<td class="hidden max-w-sm truncate text-xs text-faint sm:table-cell">{e.summary}</td>
								<!-- On a narrow screen the row is wider than its scroll box, and the
								     Select button sat past the edge. The cell sticks to the box's end
								     so the button is always in view. It is painted with the table's
								     opaque surface, and on hover the row's surface-2, so text
								     scrolling under the cell never shows through. -->
								<td
									data-cell="nowrap"
									class="sticky end-0 z-1 bg-surface transition-colors [tr:hover>&]:bg-surface-2"
								>
									<Button
										variant={selectedId === e.id ? 'primary' : 'ghost'}
										size="sm"
										onclick={() => choose(e)}
									>
										{selectedId === e.id ? 'Selected' : 'Select'}
									</Button>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			</div>
			{#if visible.length > 200}
				<p class="text-xs text-faint">
					Showing the first 200 of {visible.length}. Narrow the search to reach the rest.
				</p>
			{/if}
		{/if}
	</section>

	{#if selected}
		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>{selected.method} {selected.path}</SectionHeading>
			<div class="flex items-center gap-2">
				<Badge tone={riskTone(selectedRisk)} dot>{RISK_LABELS[selectedRisk]}</Badge>
				<span class="text-xs text-faint">{selected.groupLabel}</span>
			</div>

			{#if selected.statuses?.length || selected.response}
				<div class="flex flex-col gap-2">
					<SectionHeading level={3}>Responses</SectionHeading>
					{#if selected.statuses?.length}
						<div class="flex flex-wrap gap-2">
							{#each selected.statuses as st (st.code)}
								<Badge tone={httpStatusTone(Number(st.code) || 0)}>{st.code} {st.description}</Badge>
							{/each}
						</div>
					{/if}
					{#if selected.response}
						<p class="text-xs text-muted">{selected.response.description}</p>
						<pre class="max-h-64 overflow-auto rounded border border-line bg-surface-2 p-3 font-mono text-xs">{selected.response.example}</pre>
					{/if}
				</div>
			{/if}

			<form method="POST" action="?/rest" use:enhance={sendRest}>
				<input type="hidden" name="endpoint" value={selected.id} />
				<div class="flex flex-col gap-4">
					{#each pathParams(selected) as name (name)}
						<Input
							id="lab-path-{name}"
							name="p_{name}"
							label="{name} (in the path)"
							hint="Required. This value replaces the placeholder in the path."
							required
						/>
					{/each}
					{#each (selected.params ?? []).filter((p) => p.in === 'query') as p (p.name)}
						<Input
							id="lab-query-{p.name}"
							name="p_{p.name}"
							label="{p.name} (query)"
							hint={p.description || (p.values ? `One of: ${p.values.join(', ')}` : '')}
						/>
					{/each}
					{#if selected.method !== 'GET'}
						<Textarea
							id="lab-body"
							name="body"
							label="Request body"
							hint="JSON. Leave it empty to send no body."
							rows={8}
							bind:value={body}
						/>
					{/if}
				</div>
				<div class="mt-4">
					<Button variant="primary" type="submit" loading={sending}>
						<Play size={ICON.sm} /> Send
					</Button>
				</div>
			</form>
		</section>

	{/if}

	{#if restResult}
		<LabAnswer result={restResult} expected={expectedFor} />
	{/if}
</PageShell>
