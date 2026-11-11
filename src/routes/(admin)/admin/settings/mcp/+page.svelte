<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Card,
		CheckboxGroup,
		CopyField,
		EmptyState,
		PageShell,
		SectionHeading,
		Table,
		Toggle,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Cable, PlugZap, Unplug } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { confirmed } from '$lib/forms.svelte';
	import { AGENTS_CAP, agentKindLabel, type McpAgent } from '$lib/api/mcp';
	import { LIFTS, type Refusal } from '$lib/api/refusal';
	import { formatDateTime, plural } from '$lib/format';
	import { ICON } from '$lib/icon';
	import { ROLES } from '$lib/roles';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The settings as the last save left them, or as the load read them.
	const settings = $derived(
		(form?.action === 'toggle' || form?.action === 'keepOut' || form?.action === 'roles') && 'settings' in form && form.settings
			? form.settings
			: data.settings.ok
				? data.settings.value
				: null,
	);
	const toggleError = $derived(form?.action === 'toggle' && 'error' in form ? form.error : '');
	const keepOutError = $derived(form?.action === 'keepOut' && 'error' in form ? form.error : '');
	const rolesError = $derived(form?.action === 'roles' && 'error' in form ? form.error : '');
	const rolesSaved = $derived(form?.action === 'roles' && 'settings' in form && !!form.settings);
	const disconnectError = $derived(form?.action === 'disconnect' && 'error' in form ? form.error : '');
	const allowError = $derived(form?.action === 'allow' && 'error' in form ? form.error : '');
	const allowed = $derived(form?.action === 'allow' && 'allowed' in form && !!form.allowed);

	// A super admin can always connect an agent, so the choice is among the
	// other built-in roles, plus any other role the setting already names.
	const roleOptions = $derived.by(() => {
		const names: string[] = ROLES.filter((r) => r !== 'super_admin');
		for (const r of settings?.agentRoles ?? []) if (!names.includes(r)) names.push(r);
		return names.map((r) => ({ value: r, label: r }));
	});
	let chosenRoles = $derived([...(settings?.agentRoles ?? [])]);
	// The default enhance resets a form after a successful save, which unticks
	// every box, so a second save would post no roles at all.
	const keepRoles: SubmitFunction = () => async ({ update }) => update({ reset: false });

	let toggleForm = $state<HTMLFormElement | null>(null);
	let keepOutForm = $state<HTMLFormElement | null>(null);

	const agents = $derived(data.agents.ok ? data.agents.value.agents : []);
	// A disconnected agent holds no place under the limit.
	const connected = $derived(agents.filter((a) => !a.disconnected_at));
	const limit = $derived(data.agents.ok ? data.agents.value.limit : 0);
	const upgradeUrl = $derived(data.agents.ok ? data.agents.value.upgradeUrl : '');
	// The limit is the plugin's, 0 meaning none, so a lifted limit never
	// reads as a stale one here. A plugin older than the link sends none, and
	// the notice then points at the license page.
	const ceiling = $derived<Refusal | null>(
		limit > 0 && connected.length >= limit
			? { kind: 'cap', cap: AGENTS_CAP, limit, current: connected.length, upgradeUrl }
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
			settings?.keepDisconnectedOut
				? 'Its key or account still works outside the MCP server. It cannot connect again until you allow it.'
				: 'Its key or account still works, and its next call connects it again if there is room.',
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
					{#if settings.keepDisconnectedOut !== undefined}
						<form
							bind:this={keepOutForm}
							method="POST"
							action="?/keepOut"
							use:enhance
							class="mt-4 flex flex-col gap-3 border-t border-line pt-4"
							data-testid="mcp-keep-out-form"
						>
							<input type="hidden" name="keep_disconnected_out" value={settings.keepDisconnectedOut ? 'false' : 'true'} />
							<Toggle
								id="mcp-keep-out"
								label="Keep disconnected agents out"
								hint="When on, an agent you disconnect cannot connect again until you allow it."
								checked={settings.keepDisconnectedOut}
								onchange={() => keepOutForm?.requestSubmit()}
							/>
							{#if keepOutError}
								<Alert tone="danger">{keepOutError}</Alert>
							{/if}
						</form>
					{/if}
					{#if settings.agentRoles !== undefined}
						<form
							method="POST"
							action="?/roles"
							use:enhance={keepRoles}
							class="mt-4 flex flex-col gap-3 border-t border-line pt-4"
							data-testid="mcp-roles-form"
						>
							<CheckboxGroup
								label="Roles that can connect an agent"
								name="agent_roles"
								bind:value={chosenRoles}
								options={roleOptions}
								orientation="horizontal"
								hint="Without the AI license, only these roles can connect a new agent. A super admin always can, and agents already connected keep working."
							/>
							{#if rolesError}
								<Alert tone="danger">{rolesError}</Alert>
							{:else if rolesSaved}
								<Alert tone="success" autoDismiss>Roles saved.</Alert>
							{/if}
							<div>
								<Button type="submit">Save</Button>
							</div>
						</form>
					{/if}
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
				{#if allowError}
					<Alert tone="danger">{allowError}</Alert>
				{:else if allowed}
					<Alert tone="success" autoDismiss>Agent allowed. It connects again on its next call if there is room.</Alert>
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
										{#if a.disconnected_at}
											<span class="mt-1 flex items-center gap-2 text-xs text-faint">
												<Badge tone="warn">Disconnected</Badge>
												{formatDateTime(a.disconnected_at)}
											</span>
										{/if}
									</td>
									<td data-cell="nowrap" class="text-xs text-faint">{formatDateTime(a.first_used_at)}</td>
									<td data-cell="nowrap" class="text-xs text-faint">{formatDateTime(a.last_used_at)}</td>
									<td data-cell="nowrap">
										<div class="flex justify-end">
											{#if a.disconnected_at}
												<form method="POST" action="?/allow" use:enhance>
													<input type="hidden" name="kind" value={a.kind} />
													<input type="hidden" name="credential" value={a.credential_id} />
													<Button variant="ghost" size="sm" type="submit" aria-label="Allow {agentName(a)}">
														<PlugZap size={ICON.sm} aria-hidden="true" /> Allow
													</Button>
												</form>
											{:else}
												<form method="POST" action="?/disconnect" use:enhance={disconnect(a)}>
													<input type="hidden" name="kind" value={a.kind} />
													<input type="hidden" name="credential" value={a.credential_id} />
													<Button variant="ghost" size="sm" type="submit" aria-label="Disconnect {agentName(a)}">
														<Unplug size={ICON.sm} aria-hidden="true" /> Disconnect
													</Button>
												</form>
											{/if}
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
