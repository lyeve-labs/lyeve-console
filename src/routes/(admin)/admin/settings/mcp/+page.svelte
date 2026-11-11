<script lang="ts">
	import { Alert, Button, Card, CopyField, EmptyState, PageShell, SectionHeading, Table, Toggle } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Cable, Unplug } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { confirmed } from '$lib/forms.svelte';
	import { AGENTS_CAP, agentKindLabel, type McpAgent } from '$lib/api/mcp';
	import { LIFTS, type Refusal } from '$lib/api/refusal';
	import { formatDateTime, plural } from '$lib/format';
	import { ICON } from '$lib/icon';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The switch as the action last left it, or as the load read it.
	const settings = $derived(
		form?.action === 'toggle' && 'settings' in form && form.settings
			? form.settings
			: data.settings.ok
				? data.settings.value
				: null,
	);
	const toggleError = $derived(form?.action === 'toggle' && 'error' in form ? form.error : '');
	const disconnectError = $derived(form?.action === 'disconnect' && 'error' in form ? form.error : '');

	let toggleForm = $state<HTMLFormElement | null>(null);

	const agents = $derived(data.agents.ok ? data.agents.value.agents : []);
	const limit = $derived(data.agents.ok ? data.agents.value.limit : 0);
	const upgradeUrl = $derived(data.agents.ok ? data.agents.value.upgradeUrl : '');
	// The limit is the plugin's, 0 meaning none, so a lifted limit never
	// reads as a stale one here. A plugin older than the link sends none, and
	// the notice then points at the license page.
	const ceiling = $derived<Refusal | null>(
		limit > 0 && agents.length >= limit
			? { kind: 'cap', cap: AGENTS_CAP, limit, current: agents.length, upgradeUrl }
			: null,
	);

	function person(id: string): string {
		return data.people[id] ?? id;
	}

	function agentName(a: McpAgent): string {
		return a.kind === 'session' ? person(a.person_id) : `${agentKindLabel(a.kind)} ${a.credential_id.slice(0, 8)}`;
	}

	function disconnect(a: McpAgent): SubmitFunction {
		return confirmed(
			`Disconnect ${agentName(a)}?`,
			'Its key or account still works, and its next call connects it again if there is room.',
			{ confirmLabel: 'Disconnect', success: 'Agent disconnected.' },
		);
	}
</script>

<PageShell
	title="MCP server"
	documentTitle="MCP server - Settings"
	description="Let AI agents work with this tenant through the Model Context Protocol."
	width="wide"
>
	{#if !data.settings.ok && data.settings.gate.state === 'absent'}
		<GateNotice level={2} gate={data.settings.gate} title="MCP server" absent="The MCP server is not included in this build." />
	{:else}
		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>This tenant</SectionHeading>
			{#if settings}
				<Card>
					<form bind:this={toggleForm} method="POST" action="?/toggle" use:enhance class="flex flex-col gap-3" data-testid="mcp-enabled-form">
						<input type="hidden" name="enabled" value={settings.enabled ? 'false' : 'true'} />
						<Toggle
							id="mcp-enabled"
							label="MCP server"
							hint="When on, an agent can connect with an API key or an account, and it can do only what the key or account can do."
							checked={settings.enabled}
							onchange={() => toggleForm?.requestSubmit()}
						/>
						{#if toggleError}
							<Alert tone="danger">{toggleError}</Alert>
						{/if}
					</form>
				</Card>
			{:else if !data.settings.ok}
				<GateNotice gate={data.settings.gate} title="MCP server setting" absent="" />
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Endpoints</SectionHeading>
			<Card>
				<div class="flex flex-col gap-4">
					<CopyField
						id="mcp-content-endpoint"
						label="Content API"
						value={data.endpoints.content}
						hint="An agent connected here can work with content only."
					/>
					<CopyField
						id="mcp-admin-endpoint"
						label="Admin API"
						value={data.endpoints.admin}
						hint="An agent connected here can use admin operations too, so give this address only to agents that need them."
					/>
				</div>
			</Card>
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Connected agents</SectionHeading>
			{#if !data.agents.ok}
				<GateNotice gate={data.agents.gate} title="Connected agents" absent="" />
			{:else}
				{#if ceiling}
					<RefusalNotice refusal={ceiling} />
				{:else if limit > 0}
					<p class="text-sm text-muted" data-testid="mcp-agent-limit">
						You can connect {limit} {plural(limit, 'agent')}. {LIFTS}
					</p>
				{/if}
				{#if disconnectError}
					<Alert tone="danger">{disconnectError}</Alert>
				{/if}
				{#if agents.length === 0}
					<EmptyState
						title="No connected agents yet"
						description="An agent appears here after its first call to one of the endpoints above."
					>
						{#snippet iconSnippet()}
							<Cable size={ICON.lg} />
						{/snippet}
					</EmptyState>
				{:else}
					<Table label="Connected agents">
						<thead>
							<tr>
								<th scope="col">Agent</th>
								<th scope="col">First used</th>
								<th scope="col">Last used</th>
								<th scope="col"><span class="sr-only">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{#each agents as a (`${a.kind}/${a.credential_id}`)}
								<tr>
									<td data-cell="nowrap">
										<span class="font-medium text-fg">{agentName(a)}</span>
										{#if a.kind !== 'session' && a.person_id}
											<span class="block text-xs text-faint">{person(a.person_id)}</span>
										{/if}
									</td>
									<td data-cell="nowrap" class="text-xs text-faint">{formatDateTime(a.first_used_at)}</td>
									<td data-cell="nowrap" class="text-xs text-faint">{formatDateTime(a.last_used_at)}</td>
									<td data-cell="nowrap">
										<div class="flex justify-end">
											<form method="POST" action="?/disconnect" use:enhance={disconnect(a)}>
												<input type="hidden" name="kind" value={a.kind} />
												<input type="hidden" name="credential" value={a.credential_id} />
												<Button variant="ghost" size="sm" type="submit" aria-label="Disconnect {agentName(a)}">
													<Unplug size={ICON.sm} aria-hidden="true" /> Disconnect
												</Button>
											</form>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				{/if}
			{/if}
		</section>
	{/if}
</PageShell>
