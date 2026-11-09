<script lang="ts">
	import { Alert, Badge, Button, Card, CheckboxGroup, Drawer, Input, MultiSelect, PageShell, SectionHeading } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { ExternalLink, Plus, Trash2 } from '@lucide/svelte';
	import { confirmed, drawerFailure } from '$lib/forms.svelte';
	import { ICON } from '$lib/icon';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import CustomizationTabs from '$lib/components/CustomizationTabs.svelte';
	import { ROLE_CHOICES } from '$lib/api/customization';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const roleOptions = ROLE_CHOICES.map((r) => ({ value: r, label: r }));
	const fields = $derived((form as { fields?: Record<string, string> } | null)?.fields ?? {});

	/*
	 * The menu form is seeded from what the engine stores and reseeded only
	 * when the stored menu changes. A link save reruns the load, so reseeding
	 * on it wiped the hidden and pinned entries being picked.
	 */
	const menuKey = () => JSON.stringify([data.settings.menu.hidden, data.settings.menu.pinned]);
	// svelte-ignore state_referenced_locally
	let hidden = $state<string[]>([...data.settings.menu.hidden]);
	// svelte-ignore state_referenced_locally
	let pinned = $state<string[]>([...data.settings.menu.pinned]);
	let seeded = menuKey();
	$effect.pre(() => {
		const key = menuKey();
		if (key === seeded) return;
		seeded = key;
		hidden = [...data.settings.menu.hidden];
		pinned = [...data.settings.menu.pinned];
	});

	const navOptions = $derived(
		data.navChoices.map((c) => ({ value: c.id, label: c.section ? `${c.section}: ${c.label}` : c.label })),
	);
	const pinOptions = $derived(navOptions.filter((o) => !hidden.includes(o.value)));

	let linkOpen = $state(false);
	let linkRoles = $state<string[]>([]);

	// The drawer reads only its own action's failure key.
	const failure = drawerFailure(() => form, ['addLink']);
	function openLink() {
		failure.opened();
		linkOpen = true;
	}

	const keep: SubmitFunction = () => async ({ update }) => update({ reset: false });

	const closeOnSuccess = (close: () => void): SubmitFunction => () => async ({ result, update }) => {
		if (result.type === 'success') close();
		await update({ reset: false });
	};
</script>

<PageShell
	title="Customization"
	documentTitle="Menu - Customization"
	description="Hide, pin and add entries in this tenant's menu."
	width="wide"
>
	{#snippet actions()}
		<Badge tone="violet" size="sm">Beta</Badge>
	{/snippet}

	<CustomizationTabs active="menu" />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Customization"
			absent="Customization is not included in this build."
		/>
	{:else if !data.entitled}
		<NotEnabled
			level={2}
			title="Customization"
			description="Set this tenant's name, logo, colors and menu."
		/>
	{:else}
		<Card pad="md">
			{#snippet header()}
				<SectionHeading level={2}>Menu</SectionHeading>
			{/snippet}
			<form method="POST" action="?/menu" class="flex flex-col gap-4" use:enhance={keep}>
				{#if form?.menuError}
					<Alert tone="danger">{form.menuError}</Alert>
				{:else if form && 'menuSaved' in form}
					<Alert tone="success" autoDismiss>Menu saved.</Alert>
				{/if}
				<div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
					<!-- The menu holds dozens of entries, so each list is searched
					     rather than drawn as a wall of boxes. Each pick posts its
					     own value. -->
					<MultiSelect
						id="menu-hidden"
						label="Hidden"
						placeholder="Nothing hidden"
						hint="Hide entries this tenant's team does not use. Hiding removes the entry from the menu only, and the page keeps its own access rules."
						searchable
						options={navOptions}
						bind:value={hidden}
					/>
					<MultiSelect
						id="menu-pinned"
						label="Pinned"
						placeholder="Nothing pinned"
						hint="Entries shown in a group of their own at the top of the menu."
						searchable
						options={pinOptions}
						bind:value={pinned}
					/>
					{#each hidden as id (id)}
						<input type="hidden" name="hidden" value={id} />
					{/each}
					{#each pinned.filter((id) => !hidden.includes(id)) as id (id)}
						<input type="hidden" name="pinned" value={id} />
					{/each}
				</div>
				<div><Button variant="primary" type="submit">Save</Button></div>
			</form>
		</Card>

		<Card pad="md">
			{#snippet header()}
				<div class="flex items-center justify-between gap-2">
					<SectionHeading level={2}>Links</SectionHeading>
					<Button variant="secondary" size="sm" onclick={openLink}>
						<Plus size={ICON.sm} /> New link
					</Button>
				</div>
			{/snippet}
			{#if data.settings.menu.links.length === 0}
				<p class="text-sm text-muted">No links yet. Create a link to put your team's own tools in the menu, such as a status page or a wiki.</p>
			{:else}
				<ul class="flex flex-col divide-y divide-line">
					{#each data.settings.menu.links as link, i (i)}
						<li class="flex items-center justify-between gap-3 py-2">
							<span class="flex min-w-0 items-center gap-2 text-sm">
								<span class="text-fg">{link.label}</span>
								<span class="truncate font-mono text-xs text-faint">{link.url}</span>
								{#if link.roles?.length}<Badge size="sm">{link.roles.join(', ')}</Badge>{/if}
							</span>
							<span class="flex shrink-0 items-center gap-2">
								{#if !link.url.startsWith('/admin/')}<ExternalLink size={ICON.sm} class="text-faint" aria-hidden="true" />{/if}
								<form method="POST" action="?/removeLink" use:enhance={confirmed(`Delete ${link.label}?`, 'It is removed from the menu for everyone in this tenant.', { confirmLabel: 'Delete' })}>
									<input type="hidden" name="index" value={i} />
									<Button variant="ghost" size="sm" type="submit" aria-label="Delete {link.label}">
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								</form>
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	{/if}
</PageShell>

<Drawer bind:open={linkOpen} title="New link">
	<form method="POST" action="?/addLink" id="link-form" class="flex flex-col gap-4" use:enhance={closeOnSuccess(() => (linkOpen = false))}>
		<FormErrors message={failure.drawer?.linkError} fields={failure.drawer?.linkError ? fields : {}} />
		<Input id="link-label" name="label" label="Label" required error={fields.label} />
		<Input id="link-url" name="url" label="Address" mono required placeholder="https://" hint="An https URL, or an admin path such as /admin/media." error={fields.url} />
		<CheckboxGroup name="roles" label="Seen by" hint="Leave empty for everyone." options={roleOptions} bind:value={linkRoles} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (linkOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="link-form">Create</Button>
	{/snippet}
</Drawer>
