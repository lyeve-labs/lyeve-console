<script lang="ts">
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { Alert, Badge, Button, Drawer, EmptyState, Input, PageShell, Select, Table, Textarea, Toggle } from '@lyeve-labs/ui-kit';
	import { MailPlus, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { confirmed, drawerFailure, submitter } from '$lib/forms.svelte';
	import type { ActionData, PageData } from './$types';
	import { TRIGGER_EVENT_LABELS, type EmailTrigger } from '$lib/api/email-triggers';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/*
	 * The drawer and the delete report through the one `form`, so each failure
	 * names the action that caused it. The drawer shows only a failed save, and
	 * only one that came back after it opened, so a failed delete never reads
	 * as a failure of the next form opened. A failed delete shows above the list.
	 */
	const failure = drawerFailure(() => form as { action?: string; error?: string } | null, ['save']);
	const saveFailure = $derived(failure.drawer);
	const deleteFailure = $derived(failure.page?.action === 'delete' ? failure.page : null);
	const pageRefusal = $derived(deleteFailure ? formRefusal(deleteFailure) : null);
	const saveRefusal = $derived(saveFailure ? formRefusal(saveFailure) : null);

	const eventLabel = (e: string) => TRIGGER_EVENT_LABELS[e] ?? e;
	const triggers = $derived(data.triggers.ok ? data.triggers.value.triggers : []);
	const events = $derived(data.triggers.ok ? data.triggers.value.events : []);
	const eventOptions = $derived((events.length ? events : Object.keys(TRIGGER_EVENT_LABELS)).map((e) => ({ value: e, label: eventLabel(e) })));
	const schemaNames = $derived(data.schemas.ok ? data.schemas.value : []);
	// The field posts what it holds, so a trigger opened for editing always
	// finds its own schema and template among the options, even when a read
	// failed or the template is no longer active. Otherwise the field would
	// look blank while it sends the stored value.
	const schemaOptions = $derived.by(() => {
		const names = [...schemaNames];
		const current = editing?.schema;
		if (current && current !== '*' && !names.includes(current)) names.push(current);
		return [{ value: '*', label: 'Every content type' }, ...names.map((s) => ({ value: s, label: s }))];
	});
	// A draft or archived template is refused at send time, so the list offers
	// the active ones and says so when there are none. A list that did not
	// answer says nothing about how many there are.
	const activeTemplates = $derived(data.templates.ok ? data.templates.value.filter((t) => t.status === 'active') : []);
	const templateOptions = $derived.by(() => {
		const options = activeTemplates.map((t) => ({ value: t.key, label: `${t.key}: ${t.subject}` }));
		const current = editing?.template_key;
		if (current && !options.some((o) => o.value === current)) options.push({ value: current, label: current });
		return options;
	});
	// A new trigger needs an active template to send, so the create is offered
	// only once the templates answered with one. The notice above the list
	// says why when it is not.
	const canCreate = $derived(data.triggers.ok && data.templates.ok && activeTemplates.length > 0);
	// The license this instance holds refuses a trigger create or update, so
	// New and Edit are disabled with the reason above the list. Delete stays.
	const writeRefusal = $derived(data.writeRefusal ?? null);

	// One drawer for both writes. A null target is a new trigger.
	let open = $state(false);
	let editing = $state<EmailTrigger | null>(null);
	let name = $state('');
	let eventName = $state('after_create');
	let schema = $state('*');
	let templateKey = $state('');
	let toStatic = $state('');
	let toField = $state('');
	let locale = $state('');
	let enabled = $state(true);

	function openCreate() {
		editing = null;
		name = '';
		eventName = 'after_create';
		schema = '*';
		templateKey = activeTemplates[0]?.key ?? '';
		toStatic = '';
		toField = 'email';
		locale = '';
		enabled = true;
		failure.opened();
		open = true;
	}

	function openEdit(t: EmailTrigger) {
		editing = t;
		name = t.name;
		eventName = t.event;
		schema = t.schema;
		templateKey = t.template_key;
		toStatic = t.to_static.join(', ');
		toField = t.to_field;
		locale = t.locale;
		enabled = t.enabled;
		failure.opened();
		open = true;
	}

	function confirmDelete(t: EmailTrigger) {
		return confirmed(`Delete trigger ${t.name}?`, 'Mail stops going out for this event.', { confirmLabel: 'Delete' });
	}

	const save = submitter(() => (open = false));

	function recipients(t: EmailTrigger): string {
		const parts = [...t.to_static];
		if (t.to_field) parts.push(`the record's ${t.to_field}`);
		return parts.join(', ');
	}
</script>

<PageShell
	title="Email triggers"
	documentTitle="Email triggers - Settings"
	description="Send a template when a record is written or a review moves."
	width="wide"
	back={{ href: '/admin/settings/email', label: 'Email' }}
>
	{#snippet actions()}
		{#if canCreate}
			<Button variant="primary" size="sm" onclick={openCreate} disabled={!!writeRefusal}>
				<Plus size={ICON.sm} />
				New trigger
			</Button>
		{/if}
	{/snippet}

	<FormErrors message={deleteFailure?.error} refused={pageRefusal} />
	{#if data.triggers.ok && !data.templates.ok}
		<GateNotice level={2} gate={data.templates.gate} title="Email templates" absent="Email templates need a newer version of the email plugin." />
	{:else if data.triggers.ok && activeTemplates.length === 0}
		<Alert tone="warn" title="No active template">
			{#snippet children()}A trigger needs an active email template, and this tenant has none. <a class="text-brand underline" href="/admin/settings/email/templates">Create one in Email templates</a> first.{/snippet}
		</Alert>
	{/if}

	{#if data.triggers.ok && writeRefusal}
		<Alert tone="warn" title="Triggers cannot be created or changed">
			{#snippet children()}Creating or editing a trigger is not enabled on this engine. You can still delete triggers.{/snippet}
		</Alert>
	{/if}

	{#if !data.triggers.ok}
		<GateNotice level={2} gate={data.triggers.gate} title="Email triggers" absent="Email triggers need a newer version of the email plugin." />
	{:else if triggers.length === 0}
		<EmptyState level={2} title="No triggers yet" description="Create a trigger to send a template to fixed addresses or to an address on the record each time its event fires.">
			{#snippet iconSnippet()}<MailPlus size={ICON.lg} />{/snippet}
			{#snippet action()}
				{#if canCreate}
					<Button variant="secondary" onclick={openCreate} disabled={!!writeRefusal}>
						<Plus size={ICON.sm} />
						New trigger
					</Button>
				{/if}
			{/snippet}
		</EmptyState>
	{:else}
		<Table label="Email triggers">
			<thead>
				<tr>
					<th scope="col">Name</th>
					<th scope="col">When</th>
					<th scope="col">Template</th>
					<th scope="col">To</th>
					<th scope="col">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each triggers as t (t.id)}
					<tr>
						<td data-cell="nowrap">
							<span class="flex items-center gap-2 text-sm text-fg">
								{t.name}
								{#if !t.enabled}<Badge tone="neutral" size="sm">off</Badge>{/if}
							</span>
						</td>
						<td class="text-sm text-muted">{eventLabel(t.event)} in <span class="font-mono text-xs">{t.schema === '*' ? 'every content type' : t.schema}</span></td>
						<td data-cell="nowrap" class="font-mono text-xs text-fg">{t.template_key}</td>
						<td class="text-sm text-muted">{recipients(t)}</td>
						<td>
							<div class="flex items-center gap-2">
								<Button
								variant="ghost"
								size="sm"
								onclick={() => openEdit(t)}
								aria-label="Edit {t.name}"
								disabled={!!writeRefusal}
							>
									<Pencil size={ICON.sm} />
								</Button>
								<form method="POST" action="?/delete" use:enhance={confirmDelete(t)}>
									<input type="hidden" name="id" value={t.id} />
									<Button variant="ghost" size="sm" type="submit" aria-label="Delete {t.name}">
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
</PageShell>

<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New trigger'}>
	<form method="POST" action="?/save" id="trigger-form" use:enhance={save.enhance} class="flex flex-col gap-4">
		<FormErrors message={saveFailure?.error} refused={saveRefusal} />
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
		<input type="hidden" name="enabled" value={enabled ? 'true' : 'false'} />
		<Input id="trigger-name" name="name" label="Name" required placeholder="Order confirmation" bind:value={name} />
		<Select id="trigger-event" name="event" label="When" required searchable options={eventOptions} value={eventName} onvaluechange={(v) => (eventName = v)} />
		<Select
			id="trigger-schema"
			name="schema"
			label="In"
			searchable
			options={schemaOptions}
			value={schema}
			onvaluechange={(v) => (schema = v)}
			hint={data.schemas.ok
			? 'The content type whose records the trigger watches. For a review event, choose the content type of the entry under review.'
			: 'Could not load content types, so only every content type is listed. Reload the page to try again.'}
		/>
		<Select
			id="trigger-template"
			name="template_key"
			label="Template"
			required
			searchable
			options={templateOptions}
			value={templateKey}
			onvaluechange={(v) => (templateKey = v)}
			hint="The template can use the record's fields as variables, plus event, schema and record_id."
		/>
		<Textarea
			id="trigger-to"
			name="to_static"
			label="Send to"
			rows={2}
			placeholder="ops@example.com, sales@example.com"
			hint="Fixed addresses, separated by commas. At most 50 across both lists."
			bind:value={toStatic}
		/>
		<Input
			id="trigger-to-field"
			name="to_field"
			label="Recipient field"
			placeholder="email"
			mono
			hint="A record field with an email address, such as the customer's email. Leave blank to send only to the fixed addresses."
			bind:value={toField}
		/>
		<Input id="trigger-locale" name="locale" label="Locale" placeholder="en" mono hint="Which translation of the template to send. Leave blank to send en." bind:value={locale} />
		<Toggle id="trigger-enabled" label="Enabled" hint="A disabled trigger keeps its settings and sends nothing." bind:checked={enabled} />
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="trigger-form" loading={save.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>

