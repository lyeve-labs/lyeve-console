<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		CheckboxGroup,
		DescriptionList,
		Drawer,
		EmptyState,
		Input,
		MultiSelect,
		PageShell,
		Pagination,
		SectionHeading,
		Table,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { roleTone } from '$lib/roles';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { formatDate } from '$lib/format';
	import type { TenantMember } from '$lib/api/tenant-access';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { confirmed, drawerFailure, fieldErrors } from '$lib/forms.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const tenant = $derived(data.tenant);

	// A membership names roles inside one tenant. super_admin is an instance
	// role held on the account itself, so it is not offered here. A super
	// admin's home row is not edited here at all: the engine signs a home
	// tenant in with the roles its membership sets, so a save would either end
	// the account's super admin or keep it past a removal on the Users page.
	const MEMBER_ROLES = ['viewer', 'editor', 'admin'].map((r) => ({ value: r, label: r }));

	/** A super admin's own home row, which this page leaves alone. */
	function superHome(m: TenantMember): boolean {
		return m.home && (m.roles.includes('super_admin') || (data.homeSuperAdmins ?? []).includes(m.id));
	}

	// A super admin whose home membership already leaves the role out signs in
	// here without it.
	const lostSuperAdmin = $derived(
		data.members.ok ? data.members.value.filter((m) => m.home && !m.roles.includes('super_admin') && (data.homeSuperAdmins ?? []).includes(m.id)) : [],
	);

	const facts = $derived([
		{ term: 'Slug', value: tenant.slug },
		{ term: 'Plan', value: tenant.plan },
		{ term: 'Status', value: tenant.archived ? 'Archived' : tenant.enabled ? 'Enabled' : 'Disabled' },
		{ term: 'Created', value: formatDate(tenant.created_at) },
	]);

	/*
	 * The picks are seeded from what the engine stores and reseeded only when
	 * that changes. Turning a members page reruns the load and hands back an
	 * equal list as a new object, which must not undo a pick not yet saved.
	 */
	function storedPicks(): string[] {
		return (data.choices.ok ? data.choices.value : []).filter((c) => c.available).map((c) => c.name);
	}
	function choicesKey(): string {
		return JSON.stringify(data.choices.ok ? data.choices.value : null);
	}
	// svelte-ignore state_referenced_locally
	let available = $state<string[]>(storedPicks());
	// svelte-ignore state_referenced_locally
	let seededFrom = choicesKey();
	$effect.pre(() => {
		const key = choicesKey();
		if (key === seededFrom) return;
		seededFrom = key;
		available = storedPicks();
	});
	const featureOptions = $derived((data.choices.ok ? data.choices.value : []).map((c) => ({ value: c.name, label: c.name })));
	let savingFeatures = $state(false);

	let memberOpen = $state(false);
	let editingMember = $state<TenantMember | null>(null);
	let memberEmail = $state('');
	let memberRoles = $state<string[]>(['viewer']);
	let savingMember = $state(false);

	/*
	 * A grant and a removal both answer in memberError, and each names its
	 * action. The drawer shows only a failed grant that came back after it was
	 * opened, so a failed removal never reads as a failure of the form opened
	 * next. A failed removal shows above the members.
	 */
	type MemberFailure = { action?: string; memberError?: string; fields?: Record<string, string> } | null;
	const memberFailure = drawerFailure(() => form as MemberFailure, ['grant']);
	const grantError = $derived(memberFailure.drawer?.memberError);
	const revokeError = $derived(memberFailure.page?.action === 'revoke' ? memberFailure.page.memberError : undefined);
	// A grant refused at the admin seat ceiling renders with the numbers and
	// the link the engine sent.
	const grantRefusal = $derived(grantError ? formRefusal(form) : null);

	function openNewMember() {
		memberFailure.opened();
		editingMember = null;
		memberEmail = '';
		memberRoles = ['viewer'];
		memberOpen = true;
	}

	function openEditMember(m: TenantMember) {
		memberFailure.opened();
		editingMember = m;
		memberEmail = m.email;
		memberRoles = m.roles.filter((r) => r !== 'super_admin');
		memberOpen = true;
	}

	const saveMember: SubmitFunction = () => {
		savingMember = true;
		return async ({ result, update }) => {
			savingMember = false;
			if (result.type === 'success') memberOpen = false;
			await update({ reset: false });
		};
	};

	// Each question is built at submit time, so it names the tenant as it
	// reads after a rename rather than as it read when the row first drew.
	function revokeMember(email: string): SubmitFunction {
		return (input) =>
			confirmed(
				`Remove ${email} from ${tenant.name}?`,
				'The account keeps its home tenant and every other membership. Its open sessions here end at their next refresh.',
				{ confirmLabel: 'Delete' },
			)(input);
	}

	function confirmArchive(): SubmitFunction {
		return (input) =>
			confirmed(
				`Archive ${tenant.name}?`,
				'The tenant stays readable, but every change is refused until you restore it.',
				{ confirmLabel: 'Archive' },
			)(input);
	}
</script>

<PageShell
	title={tenant.name}
	description="Choose what this tenant can use and who can work in it."
	width="wide"
	back={{ href: '/admin/tenants', label: 'Tenants' }}
>
	{#snippet actions()}
		{#if tenant.archived}
			<form method="post" action="?/restore" use:enhance>
				<Button variant="secondary" size="sm" type="submit"><ArchiveRestore size={ICON.sm} /> Restore</Button>
			</form>
		{:else}
			<form method="post" action="?/archive" use:enhance={confirmArchive()}>
				<Button variant="secondary" size="sm" type="submit"><Archive size={ICON.sm} /> Archive</Button>
			</form>
		{/if}
	{/snippet}

	{#if form?.stateError}
		<Alert tone="danger">{form.stateError}</Alert>
	{/if}

	<DescriptionList items={facts} />

	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>Features</SectionHeading>
		{#if !data.choices.ok}
			<GateNotice
				gate={data.choices.gate}
				title="this tenant's features"
				absent="Per-tenant features are not included in this build."
			/>
		{:else if data.choices.value.length === 0}
			<EmptyState title="No plugins to choose from" description="This build has no plugins that can be turned off for one tenant." />
		{:else}
			{#if form?.featuresError}
				<Alert tone="danger">{form.featuresError}</Alert>
			{:else if form && 'featuresSaved' in form}
				<Alert tone="success" autoDismiss>Features saved. They apply from the tenant's next request.</Alert>
			{/if}
			<form
				method="post"
				action="?/features"
				class="flex flex-col gap-4"
				use:enhance={() => {
					savingFeatures = true;
					return async ({ update }) => {
						savingFeatures = false;
						await update({ reset: false });
					};
				}}
			>
				{#each data.choices.value as c (c.name)}
					<input type="hidden" name="offered" value={c.name} />
				{/each}
				<MultiSelect
					id="tenant-features"
					label="Available to this tenant"
					placeholder="Nothing"
					hint="Only plugins this engine runs can be turned on. Turning one off affects only this tenant: its requests to the plugin are refused, its screens leave the console and its capabilities are turned off."
					searchable
					options={featureOptions}
					bind:value={available}
				/>
				{#each available as name (name)}
					<input type="hidden" name="available" value={name} />
				{/each}
				<div>
					<Button variant="primary" type="submit" loading={savingFeatures}>Save</Button>
				</div>
			</form>
		{/if}
	</section>

	<section class="flex flex-col gap-4">
		<div class="flex items-center justify-between gap-4">
			<SectionHeading level={2}>Members</SectionHeading>
			{#if data.members.ok}
				<Button variant="secondary" onclick={openNewMember}><Plus size={ICON.sm} /> New member</Button>
			{/if}
		</div>
		{#if revokeError}
			<Alert tone="danger">{revokeError}</Alert>
		{/if}
		{#if data.homeSuperAdmins === null}
			<Alert tone="warn">
				Could not load the accounts. Reload the page to see whether a home member signs in here without super admin.
			</Alert>
		{/if}
		{#each lostSuperAdmin as m (m.id)}
			<Alert tone="warn" title="{m.email} signs in here without super admin">
				This is the account's home tenant, and its roles here do not include super admin, so it signs in here with those roles. A home membership cannot be changed on this page or on the Users page.
			</Alert>
		{/each}
		{#if !data.members.ok}
			<GateNotice
				gate={data.members.gate}
				title="this tenant's members"
				absent="Tenant members are not included in this build."
			/>
		{:else if data.members.value.length === 0}
			<EmptyState title="No members yet" description="Add an account to give it access to this tenant.">
				{#snippet action()}
					<Button variant="secondary" onclick={openNewMember}><Plus size={ICON.sm} /> New member</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Members">
				<thead>
					<tr>
						<th scope="col">Account</th>
						<th scope="col">Roles here</th>
						<th scope="col">Access</th>
						<th scope="col" class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.members.value as m (m.id)}
						<tr>
							<td data-cell="nowrap">
								{m.email}
								{#if m.disabled}
									<Badge tone="neutral" size="sm">Disabled</Badge>
								{/if}
							</td>
							<td>
								<div class="flex flex-wrap gap-1">
									{#each m.roles as role (role)}
										<Badge tone={roleTone(role)} size="sm">{role}</Badge>
									{/each}
								</div>
							</td>
							<td class="text-xs text-muted">{m.home ? 'Home tenant' : 'Membership'}</td>
							<td>
								<div class="flex items-center justify-end gap-2">
									{#if lostSuperAdmin.includes(m)}
										<span class="text-xs text-muted">This home membership cannot be changed here or on the Users page.</span>
									{:else if superHome(m)}
										<span class="text-xs text-muted">A super admin's home roles are managed on the Users page.</span>
									{/if}
									<Button
										variant="ghost"
										size="sm"
										aria-label="Edit roles for {m.email}"
										disabled={superHome(m)}
										onclick={() => openEditMember(m)}
									>
										<Pencil size={ICON.sm} />
									</Button>
									{#if !m.home}
										<form method="post" action="?/revoke" use:enhance={revokeMember(m.email)}>
											<input type="hidden" name="user_id" value={m.id} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Remove {m.email}">
												<Trash2 size={ICON.sm} class="text-danger" />
											</Button>
										</form>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
			<Pagination
				page={pageNumber(data.offset, data.limit)}
				perPage={data.limit}
				count={data.members.value.length}
				total={data.memberTotal}
				noun="members"
				href={pageHref(`/admin/tenants/${tenant.id}`, data.limit)}
			/>
		{/if}
	</section>
</PageShell>

<Drawer bind:open={memberOpen} title={editingMember ? `Roles for ${editingMember.email}` : 'New member'}>
	<form method="post" action="?/grant" id="member-form" use:enhance={saveMember} class="flex flex-col gap-4">
		<FormErrors message={grantError} fields={fieldErrors(memberFailure.drawer)} refused={grantRefusal} />
		{#if editingMember}
			<input type="hidden" name="user_id" value={editingMember.id} />
			<Input id="member-email" label="Account" value={memberEmail} disabled />
		{:else}
			<Input
				id="member-email"
				name="email"
				type="email"
				label="Account email"
				required
				hint="Enter an existing account. It keeps its home tenant and gains access to this one."
				bind:value={memberEmail}
			/>
		{/if}
		<CheckboxGroup
			name="roles"
			label="Roles in this tenant"
			hint={editingMember?.home
				? "These roles replace the account's own roles in its home tenant."
				: 'What the account can do in this tenant.'}
			options={MEMBER_ROLES}
			bind:value={memberRoles}
		/>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (memberOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="member-form" loading={savingMember}>{editingMember ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>
