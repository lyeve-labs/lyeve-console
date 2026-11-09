<script lang="ts">
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { Alert, Badge, Button, Drawer, EmptyState, Input, Modal, PageShell, SegmentedControl, Select, Table, Textarea, toast } from '@lyeve-labs/ui-kit';
	import { Eye, Lock, Mail, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import { confirmed, drawerFailure, submitter } from '$lib/forms.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';
	import { REQUIRED_PURPOSE, type EmailTemplate, type TemplateStatus } from '$lib/api/email-templates';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/*
	 * The drawer, the delete and the preview report through the one `form`, so
	 * each failure names the action that caused it. The drawer shows only a
	 * failed save, and only one that came back after it opened, so a failed
	 * delete never reads as a failure of the next form opened. A failed delete
	 * or preview shows above the list.
	 */
	const failure = drawerFailure(() => form as { action?: string; error?: string } | null, ['save']);
	const saveFailure = $derived(failure.drawer);
	const pageFailure = $derived(failure.page?.action === 'delete' || failure.page?.action === 'preview' ? failure.page : null);
	const pageRefusal = $derived(pageFailure ? formRefusal(pageFailure) : null);
	const formError = $derived(pageFailure?.error ?? '');

	// The plugin states the ceiling and the count. A limit of 0 is none, and
	// a read that failed states nothing: the create still answers the ceiling.
	const limit = $derived(data.limits?.limit ?? 0);
	const atCeiling = $derived(limit > 0 && (data.limits?.current ?? 0) >= limit);
	const templates = $derived(data.templates.ok ? data.templates.value : []);
	const starters = $derived(data.starters.ok ? data.starters.value : []);
	const optionalStarters = $derived(starters.filter((s) => !s.required));
	const starterOptions = $derived([{ value: '', label: 'A blank template' }, ...optionalStarters.map((s) => ({ value: s.key, label: s.key }))]);
	const STATUS_OPTIONS = [
		{ value: 'active', label: 'Active' },
		{ value: 'draft', label: 'Draft' },
		{ value: 'archived', label: 'Archived' },
	];
	const BLANK = `<mjml>
<mj-body>
<mj-section>
<mj-column>
<mj-text>Hello {{.Vars.name}}</mj-text>
</mj-column>
</mj-section>
</mj-body>
</mjml>`;

	// One drawer for both writes. A null target is a new template.
	let open = $state(false);
	let editing = $state<EmailTemplate | null>(null);
	let key = $state('');
	let starter = $state('');
	let subject = $state('');
	let body = $state('');
	let status = $state<TemplateStatus>('active');

	function openCreate() {
		editing = null;
		key = '';
		starter = '';
		subject = '';
		body = BLANK;
		status = 'active';
		failure.opened();
		open = true;
	}

	function openEdit(t: EmailTemplate) {
		editing = t;
		key = t.key;
		subject = t.subject;
		body = t.mjml_source;
		status = t.status;
		failure.opened();
		open = true;
	}

	// Picking a starter copies its subject and body into the form, and its
	// name when the author has not typed one.
	function pickStarter(value: string) {
		starter = value;
		const s = optionalStarters.find((x) => x.key === value);
		if (!s) {
			body = BLANK;
			return;
		}
		subject = s.subject;
		body = s.mjml_source;
		if (!key) key = s.key;
	}

	const linkVariable = $derived(editing?.required ? starters.find((s) => s.key === editing?.key)?.link_variable : undefined);

	function confirmDelete(t: EmailTemplate) {
		return confirmed(`Delete template ${t.key}?`, 'A trigger or a flow that sends it stops sending.', { confirmLabel: 'Delete' });
	}

	let previewKey = $state('');
	let previewForm = $state<HTMLFormElement>();
	let previewOpen = $state(false);
	const preview = $derived(form && 'preview' in form ? form.preview : null);
	// The preview opens only on a rendered answer. A failed render shows above
	// the list, where a modal with nothing in it would hide it, and as a toast,
	// because the reader pressed Preview on a row that may be far below it.
	const showPreview: SubmitFunction = () => {
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') previewOpen = true;
			else if (result.type === 'failure') {
				const said = (result.data as { error?: unknown } | undefined)?.error;
				toast.error(typeof said === 'string' && said ? said : 'Could not render the template.');
			}
		};
	};

	async function askPreview(t: EmailTemplate) {
		previewKey = t.key;
		await tick();
		previewForm?.requestSubmit();
	}

	const save = submitter(() => (open = false));
</script>

<PageShell
	title="Email templates"
	documentTitle="Email templates - Settings"
	description="Write the subject and body of each mail."
	width="wide"
	back={{ href: '/admin/settings/email', label: 'Email' }}
>
	{#snippet actions()}
		{#if data.limits}
			<span class="text-sm text-muted" data-testid="template-usage">
				{limit > 0 ? `${data.limits.current} of ${limit} templates` : `${data.limits.current} templates, no limit`}
			</span>
		{/if}
		{#if data.templates.ok}
			<Button variant="primary" size="sm" onclick={openCreate} disabled={atCeiling}>
				<Plus size={ICON.sm} />
				New template
			</Button>
		{/if}
	{/snippet}

	<FormErrors message={formError} refused={pageRefusal} />
	{#if atCeiling}
		<Alert tone="info" title="Every template slot is in use">
			{#snippet children()}This engine has reached its limit of {limit} templates. Edit one, delete one you no longer send, or change the license to allow more.{/snippet}
		</Alert>
	{/if}

	{#if !data.templates.ok}
		<GateNotice level={2} gate={data.templates.gate} title="Email templates" absent="Email templates need a newer version of the email plugin." />
	{:else if templates.length === 0}
		<EmptyState level={2} title="No templates yet" description="Create a template to set the subject and body of a mail.">
			{#snippet iconSnippet()}<Mail size={ICON.lg} />{/snippet}
			{#snippet action()}
				<Button variant="secondary" onclick={openCreate} disabled={atCeiling}>
					<Plus size={ICON.sm} />
					New template
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<Table label="Email templates">
			<thead>
				<tr>
					<th scope="col">Name</th>
					<th scope="col">Subject</th>
					<th scope="col">Status</th>
					<th scope="col">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each templates as t (t.id)}
					<tr>
						<td data-cell="nowrap">
							<span class="flex items-center gap-2">
								<span class="font-mono text-xs text-fg">{t.key}</span>
								{#if t.required}
									<Badge tone="brand" size="sm"><Lock size={ICON.xs} aria-hidden="true" /> Required</Badge>
								{/if}
							</span>
							{#if t.required && REQUIRED_PURPOSE[t.key]}
								<span class="block text-xs text-faint">{REQUIRED_PURPOSE[t.key]}</span>
							{/if}
						</td>
						<td class="text-sm text-muted">{t.subject}</td>
						<td data-cell="nowrap">
							<Badge tone={t.status === 'active' ? 'success' : 'neutral'} size="sm">{t.status}</Badge>
						</td>
						<td>
							<div class="flex items-center gap-2">
								<Button variant="ghost" size="sm" onclick={() => askPreview(t)} aria-label="Preview {t.key}">
									<Eye size={ICON.sm} />
								</Button>
								<Button variant="ghost" size="sm" onclick={() => openEdit(t)} aria-label="Edit {t.key}">
									<Pencil size={ICON.sm} />
								</Button>
								{#if !t.required}
									<form method="POST" action="?/delete" use:enhance={confirmDelete(t)}>
										<input type="hidden" name="id" value={t.id} />
										<Button variant="ghost" size="sm" type="submit" aria-label="Delete {t.key}">
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
	{/if}
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.key}` : 'New template'}>
	<form method="POST" action="?/save" id="template-form" use:enhance={save.enhance} class="flex flex-col gap-4">
		<FormErrors message={saveFailure?.error} refused={saveFailure ? formRefusal(saveFailure) : null} />
		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
		{:else}
			<Select
				id="template-starter"
				label="Start from"
				options={starterOptions}
				searchable
				value={starter}
				onvaluechange={pickStarter}
				hint={data.starters.ok
					? 'A ready-made template to copy. You can change everything it copies.'
					: 'Could not load the ready-made templates, so only a blank one is available.'}
			/>
			<Input id="template-key" name="key" label="Name" required mono placeholder="order-shipped" hint="Triggers and flows use this name to send the template. Use lowercase letters, digits and dashes." bind:value={key} />
		{/if}
		{#if editing?.required}
			<Alert tone="info" title="Required template">
				{#snippet children()}
					{REQUIRED_PURPOSE[editing?.key ?? ''] ?? 'A sign-in mail is sent from it.'} Change any word or the whole design. Keep
					<code class="font-mono text-xs">{`{{.Vars.${linkVariable ?? 'link'}}}`}</code> in the body, because it is the link the mail delivers.
				{/snippet}
			</Alert>
			<input type="hidden" name="status" value="active" />
		{:else}
			<input type="hidden" name="status" value={status} />
			<SegmentedControl label="Status" bind:value={status} options={STATUS_OPTIONS} />
		{/if}
		<Input id="template-subject" name="subject" label="Subject" required placeholder={'Your order has shipped, {{.Vars.name}}'} bind:value={subject} />
		<Textarea
			id="template-body"
			name="mjml_source"
			label="Body"
			rows={18}
			mono
			hint={'MJML markup. Print a value with {{.Vars.name}} and your branding with {{.Branding.CompanyName}}, {{.Branding.LogoURL}} or {{.Branding.PrimaryColor}}. At most 16 KB.'}
			bind:value={body}
		/>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="template-form" loading={save.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>

<Modal bind:open={previewOpen} title={preview ? `Preview of ${preview.key}` : 'Preview'} size="xl">
	{#if preview}
		<p class="mb-3 text-sm text-muted">Subject: <span class="text-fg">{preview.subject}</span></p>
		<!-- An empty sandbox runs no script and reaches nothing of the admin's. -->
		<!-- ui-consistency: allow raw-color - a mail client draws a message on white, so its preview is drawn on white in either theme -->
		<iframe title="Rendered {preview.key}" sandbox="" srcdoc={preview.html} class="h-[60vh] w-full rounded border border-line bg-white" data-testid="template-preview"></iframe>
		<p class="mt-2 text-xs text-faint">Rendered with sample values. Images from other sites are not loaded here.</p>
	{/if}
</Modal>

<form method="POST" action="?/preview" use:enhance={showPreview} bind:this={previewForm} class="hidden">
	<input type="hidden" name="key" value={previewKey} />
</form>
