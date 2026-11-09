<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Checkbox,
		CheckboxGroup,
		Drawer,
		Select,
		EmptyState,
		FilterChips,
		Input,
		PageShell,
		PasswordInput,
		Pagination,
		SearchInput,
		Table,
		toast,
	} from '@lyeve-labs/ui-kit';
	import type { PageData, ActionData } from './$types';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { KeyRound, Pencil, Plus, Trash2, Users } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { confirmed, fieldErrors, tracked } from '$lib/forms.svelte';
	import { narrows } from '$lib/narrow';
	import { ROLE_OPTIONS, roleTone } from '$lib/roles';
	import { passkeysRemovedText } from '$lib/api/users';
	import { formatDate } from '$lib/format';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	type User = Extract<PageData['users'], { ok: true }>['value'][number];

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/*
	 * Every action answers into the one `form`, so each failure names its
	 * action and each surface shows only its own. A drawer shows a failure only
	 * when it came back after the drawer opened, so a failed delete never
	 * appears inside the next New user form as if that form had failed.
	 */
	type Failure = { action?: string; error?: string; fields?: Record<string, string> };
	const failure = $derived(form && typeof form === 'object' && 'error' in form ? (form as Failure) : null);
	let accountOpenedOver = $state.raw<unknown>(null);
	let passwordOpenedOver = $state.raw<unknown>(null);
	const accountFailure = $derived(
		form !== accountOpenedOver && (failure?.action === 'create' || failure?.action === 'updateRoles') ? failure : null
	);
	const passwordFailure = $derived(
		form !== passwordOpenedOver && failure?.action === 'setPassword' ? failure : null
	);
	const pageFailure = $derived(
		failure && failure.action !== 'create' && failure.action !== 'updateRoles' && failure.action !== 'setPassword'
			? failure
			: null
	);
	const errors = $derived(fieldErrors(accountFailure));
	const passwordErrors = $derived(fieldErrors(passwordFailure));
	// A seat refusal renders with the numbers and the link the engine sent.
	const refused = $derived(formRefusal(accountFailure));

	// One drawer for both writes. A null target is a new account. A user is the
	// account whose roles are being changed.
	let open = $state(false);
	let editing = $state<User | null>(null);
	let email = $state('');
	let password = $state('');
	let roles = $state<string[]>(['viewer']);
	let tenant = $state('');
	// A tenant is chosen only on an install with several. With one, the engine
	// resolves it on its own.
	const tenants = $derived(data.tenants.ok ? data.tenants.value : []);
	const tenantOptions = $derived([
		{ value: '', label: 'Choose a tenant' },
		...tenants.map((t) => ({ value: t.slug, label: t.name && t.name !== t.slug ? `${t.name} (${t.slug})` : t.slug })),
	]);

	function openCreate() {
		accountOpenedOver = form;
		editing = null;
		email = '';
		password = '';
		roles = ['viewer'];
		tenant = '';
		open = true;
	}

	function openEdit(user: User) {
		accountOpenedOver = form;
		editing = user;
		email = user.email;
		password = '';
		roles = [...user.roles];
		open = true;
	}

	/**
	 * Deleting an account cannot be undone, so the row asks first and names the
	 * account it is about to destroy. enhance awaits this before it sends
	 * anything, so canceling here means the request is never made.
	 */
	function deleteAccount(email: string): SubmitFunction {
		return confirmed(
			`Delete user ${email}?`,
			'Their sessions end immediately and their audit trail is kept. This cannot be undone.',
			{ confirmLabel: 'Delete', success: `${email} deleted.` },
		);
	}

	// The password drawer is its own, not a third mode of the one above: it
	// holds no email or roles, and a refusal from the engine has to land on
	// its control and never on the create form's password.
	let passwordOpen = $state(false);
	let passwordFor = $state<User | null>(null);
	let newPassword = $state('');
	// Each opening starts from the recommended choice, not the last account's.
	let removePasskeys = $state(true);

	function openSetPassword(user: User) {
		passwordOpenedOver = form;
		passwordFor = user;
		newPassword = '';
		removePasskeys = true;
		passwordOpen = true;
	}

	/**
	 * A set password ends every session the account held, so the toast says
	 * so: the operator is about to tell the user, and "done" alone leaves them
	 * to find out they were signed out everywhere.
	 */
	const savePassword: SubmitFunction = () => {
		const subject = passwordFor?.email ?? '';
		return async ({ result, update }) => {
			if (result.type === 'success') {
				passwordOpen = false;
				newPassword = '';
				await invalidateAll();
				const removed = passkeysRemovedText((result.data as { passkeysRemoved?: number } | undefined)?.passkeysRemoved);
				toast.success(`Password set for ${subject}. Their sessions have ended.${removed ? ` ${removed}` : ''}`);
			} else {
				await update({ reset: false });
			}
		};
	};

	/** Closes the drawer and reloads the list once the write lands. A failure keeps it open beside the message. */
	const saveAccount: SubmitFunction = () => {
		const subject = email;
		const verb = editing ? 'Updated roles for' : 'Created';
		return async ({ result, update }) => {
			if (result.type === 'success') {
				open = false;
				await invalidateAll();
				toast.success(`${verb} ${subject}`);
			} else {
				await update();
			}
		};
	};

	// The endpoint takes no search, so the box narrows the page on screen and
	// the pager below still walks the whole collection.
	let query = $state('');
	let role = $state('');
	const ROLE_FILTERS = [{ value: '', label: 'All' }, ...ROLE_OPTIONS];
	const rows = $derived(data.users.ok ? data.users.value : []);
	const visible = $derived(
		rows.filter(
			(u) => narrows(query, u.email, u.roles.join(' ')) && (role === '' || u.roles.includes(role))
		)
	);

	/*
	 * Links, not goto(). A click that lands before the page hydrates reaches no
	 * handler at all, and an href works from the server-rendered document.
	 *
	 * There is no page count beside them because the endpoint sends no row
	 * count. hasMore is a single row read past the end of the page, so the page
	 * can say whether there is another one and will not claim a total nobody
	 * measured.
	 */

	const saveAccountSubmit = tracked(saveAccount);
	const savePasswordSubmit = tracked(savePassword);
</script>

<PageShell
	title="Users"
	description="Manage the accounts that sign in to this engine."
	width="wide"
>
	{#snippet actions()}
		{#if data.users.ok}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New user
			</Button>
		{/if}
	{/snippet}

	<FormErrors message={pageFailure?.error} />

	<!-- The kit's empty state titles itself as an h3. This names the list
	     under the page title so a heading list never skips a level. -->
	<h2 class="sr-only">Accounts</h2>

	{#if !data.users.ok}
		<GateNotice gate={data.users.gate} title="Users" absent="The accounts list needs a newer version of the engine." />
	{:else if rows.length === 0}
		<EmptyState
			title="No users yet"
			description="Create an account to give someone access to this engine."
		>
			{#snippet iconSnippet()}
				<Users size={ICON.lg} />
			{/snippet}
			{#snippet action()}
				<Button variant="secondary" onclick={openCreate}>
					<Plus size={ICON.sm} /> New user
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<ListToolbar label="Filter users">
			{#snippet search()}
				<label for="user-search" class="sr-only">Search this page</label>
				<SearchInput id="user-search" bind:value={query} placeholder="Email or role on this page" />
			{/snippet}
			{#snippet filters()}
				<FilterChips label="Role" bind:value={role} options={ROLE_FILTERS} />
			{/snippet}
		</ListToolbar>

		{#if visible.length === 0}
			<EmptyState
				title="No users match this search"
				description="The search covers this page only. Clear it or go to another page."
			/>
		{:else}
			<Table label="Users">
				<thead>
					<tr>
						<th scope="col">Email</th>
						<th scope="col">Roles</th>
						<th scope="col">Created</th>
						<th scope="col" class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each visible as user (user.id)}
						<tr>
							<td data-cell="nowrap">
								<div class="flex flex-wrap items-center gap-2">
									<span>{user.email}</span>
									<!-- Such an account belongs to one tenant, and its address can
									     repeat in another, so two rows may show the same address. -->
									{#if user.tenant_local}
										<Badge tone="neutral">Signs in through your identity provider</Badge>
									{/if}
								</div>
							</td>
							<td data-cell="nowrap">
								<div class="flex flex-wrap gap-1">
									{#each user.roles as held (held)}
										<Badge tone={roleTone(held)}>{held}</Badge>
									{/each}
									{#if user.roles.length === 0}
										<span class="text-xs text-faint">none</span>
									{/if}
								</div>
							</td>
							<td data-cell="nowrap" class="text-xs text-faint">{formatDate(user.created_at, 'Unknown')}</td>
							<td>
								<div class="flex items-center justify-end gap-2">
									<Button
										variant="ghost"
										size="sm"
										aria-label="Edit roles for {user.email}"
										onclick={() => openEdit(user)}
									>
										<Pencil size={ICON.sm} />
									</Button>
									<Button
										variant="ghost"
										size="sm"
										aria-label="Set password for {user.email}"
										onclick={() => openSetPassword(user)}
									>
										<KeyRound size={ICON.sm} />
									</Button>
									<form
										method="POST"
										action="?/delete"
										class="inline-flex"
										use:enhance={deleteAccount(user.email)}
									>
										<input type="hidden" name="id" value={user.id} />
										<Button
											variant="ghost"
											size="sm"
											type="submit"
											aria-label="Delete {user.email}"
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
			count={rows.length}
			hasNext={data.hasMore}
			noun="accounts"
			href={pageHref('/admin/users', data.limit)}
		/>
	{/if}
</PageShell>

<!-- Create and edit share the drawer, as every list in the admin does. The
     roles are the only field an existing account exposes for editing. The
     email and the password stay as the engine holds them. -->
<Drawer bind:open title={editing ? `Edit ${editing.email}` : 'New user'}>
	<form
		method="POST"
		action={editing ? '?/updateRoles' : '?/create'}
		id="user-form"
		use:enhance={saveAccountSubmit.enhance}
		class="flex flex-col gap-4"
	>
		<FormErrors message={accountFailure?.error} fields={errors} {refused} />

		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
			<Input id="new-email" label="Email" value={email} disabled />
		{:else}
			<Input
				id="new-email"
				label="Email"
				name="email"
				type="email"
				bind:value={email}
				required
				autocomplete="off"
				error={errors.email}
			/>
			<PasswordInput
				id="new-pw"
				label="Password"
				name="password"
				bind:value={password}
				required
				autocomplete="new-password"
				hint="The password policy applies. By default it needs at least 12 characters, with upper case, lower case and a digit, and no common passwords."
				error={errors.password}
			/>
			{#if !data.tenants.ok}
				<!-- Without the roster the form cannot offer the choice. Saying so
				     here keeps a refusal for a missing tenant from reading as a
				     fault in the fields the operator filled in. -->
				<Alert tone="warn" title="Could not load the tenants">
					You cannot choose a tenant for this account. On an engine with several tenants, each account needs one. Reload the page to try again.
				</Alert>
			{:else if tenants.length > 1}
				<input type="hidden" name="tenant_required" value="1" />
				<Select
					id="new-tenant"
					name="tenant_id"
					label="Tenant"
					searchable
					required
					bind:value={tenant}
					options={tenantOptions}
					hint="The account signs in to this tenant only."
					error={errors.tenant_id}
				/>
			{/if}
		{/if}

		<CheckboxGroup
			name="roles"
			label="Roles"
			options={ROLE_OPTIONS}
			bind:value={roles}
			orientation="horizontal"
		/>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="user-form" loading={saveAccountSubmit.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>

<!-- The engine judges the password, so the form states no rule of its own
     and shows the refusal it gets back on the control. A super admin sets a
     password here. -->
<Drawer
	bind:open={passwordOpen}
	title={passwordFor ? `Set password for ${passwordFor.email}` : 'Set password'}
	description="Saving signs the user out of every session."
>
	<form
		method="POST"
		action="?/setPassword"
		id="password-form"
		use:enhance={savePasswordSubmit.enhance}
		class="flex flex-col gap-4"
	>
		<FormErrors message={passwordFailure?.error} fields={passwordErrors} />

		{#if passwordFor}
			<input type="hidden" name="id" value={passwordFor.id} />
		{/if}
		<PasswordInput
			id="set-pw"
			label="New password"
			name="new_password"
			bind:value={newPassword}
			required
			autocomplete="new-password"
			error={passwordErrors.new_password}
		/>
		<Checkbox
			id="set-pw-remove-passkeys"
			name="remove_passkeys"
			label="Remove this account's passkeys"
			description="Recommended. They can add their passkeys again after signing in."
			bind:checked={removePasskeys}
		/>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (passwordOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="password-form" loading={savePasswordSubmit.pending}>Set password</Button>
	{/snippet}
</Drawer>
