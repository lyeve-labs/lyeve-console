<script lang="ts">
	import { Alert, Badge, Button, Card, CheckboxGroup, Drawer, EmptyState, Input, PageShell, SectionHeading, Table } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { Pencil, Plus, Trash2 } from '@lucide/svelte';
	import { confirmed, drawerFailure } from '$lib/forms.svelte';
	import { ICON } from '$lib/icon';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import CustomizationTabs from '$lib/components/CustomizationTabs.svelte';
	import { slugify, ROLE_CHOICES } from '$lib/api/customization';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const roleOptions = ROLE_CHOICES.map((r) => ({ value: r, label: r }));
	const fields = $derived((form as { fields?: Record<string, string> } | null)?.fields ?? {});

	let pageOpen = $state(false);
	let pageTitle = $state('');
	let pageSlug = $state('');
	let slugTouched = $state(false);
	let pageRoles = $state<string[]>([]);
	const suggestedSlug = $derived(slugTouched ? pageSlug : slugify(pageTitle));

	// The drawer reads only its own action's failure key.
	const failure = drawerFailure(() => form, ['createPage']);
	function openPage() {
		failure.opened();
		pageOpen = true;
	}
</script>

<PageShell
	title="Customization"
	documentTitle="Pages - Customization"
	description="Create pages for this tenant, each with its own menu entry."
	width="wide"
>
	{#snippet actions()}
		<Badge tone="violet" size="sm">Beta</Badge>
	{/snippet}

	<CustomizationTabs active="pages" />

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
				<div class="flex items-center justify-between gap-2">
					<SectionHeading level={2}>Pages</SectionHeading>
					<Button variant="secondary" size="sm" onclick={openPage}>
						<Plus size={ICON.sm} /> New page
					</Button>
				</div>
			{/snippet}
			{#if form?.pageDeleteError}
				<Alert tone="danger">{form.pageDeleteError}</Alert>
			{/if}
			{#if data.pages.length === 0}
				<EmptyState title="No pages yet" description="Create a page from text, callouts, content lists, counts and links. Each page gets its own menu entry.">
					{#snippet action()}
						<Button variant="secondary" onclick={openPage}>
							<Plus size={ICON.sm} /> New page
						</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Pages">
					<thead>
						<tr>
							<th scope="col">Page</th>
							<th scope="col">Seen by</th>
							<th scope="col" class="text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each data.pages as p (p.slug)}
							<tr>
								<td>
									<a href="/admin/pages/{p.slug}" class="text-fg transition-colors hover:text-brand">{p.title}</a>
									{#if data.settings.home_page === p.slug}<Badge tone="brand" size="sm">Dashboard</Badge>{/if}
								</td>
								<td class="text-xs text-muted">{p.roles.length ? p.roles.join(', ') : 'Everyone'}</td>
								<td>
									<div class="flex items-center justify-end gap-2">
										<Button variant="ghost" size="sm" href="/admin/settings/customization/pages/{p.slug}" aria-label="Edit {p.title}">
											<Pencil size={ICON.sm} />
										</Button>
										<form method="POST" action="?/deletePage" use:enhance={confirmed(`Delete ${p.title}?`, 'Its menu entry is removed too, and the dashboard stops showing it.', { confirmLabel: 'Delete' })}>
											<input type="hidden" name="slug" value={p.slug} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Delete {p.title}">
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
		</Card>
	{/if}
</PageShell>

<Drawer bind:open={pageOpen} title="New page">
	<form method="POST" action="?/createPage" id="page-form" class="flex flex-col gap-4" use:enhance>
		<FormErrors message={failure.drawer?.pageError} fields={failure.drawer?.pageError ? fields : {}} />
		<Input id="page-title" name="title" label="Title" required bind:value={pageTitle} error={fields.title} />
		<Input
			id="page-slug"
			name="slug"
			label="Address"
			mono
			hint="The page opens at /admin/pages/ followed by this."
			value={suggestedSlug}
			oninput={(e: Event & { currentTarget: HTMLInputElement }) => {
				slugTouched = true;
				pageSlug = e.currentTarget.value;
			}}
			error={fields.slug}
		/>
		<CheckboxGroup name="roles" label="Seen by" hint="Leave empty for everyone in this tenant." options={roleOptions} bind:value={pageRoles} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (pageOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="page-form">Create</Button>
	{/snippet}
</Drawer>
