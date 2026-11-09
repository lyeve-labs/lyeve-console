<script lang="ts">
	import { Alert, Card, Breadcrumb, Button, PageShell, Select } from '@lyeve-labs/ui-kit';
	import type { PageData, ActionData } from './$types';
	import type { SchemaField } from '@lyeve-labs/client';
	import { enhance } from '$app/forms';
	import { Globe } from '@lucide/svelte';
	import { crumbsAfter } from '$lib/breadcrumb';
	import { buildEmpty, validate, serialize, extractM2MRelations } from '$lib/utils/content-form';
	import ContentForm from '$lib/components/ContentForm.svelte';
	import { ICON } from '$lib/icon';
	import { couldNotLoad } from '$lib/outage';
	import { tracked } from '$lib/forms.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let userFields = $derived(
		(data.schemaDef?.fields ?? []).filter((f: SchemaField) => !f.system),
	);

	// svelte-ignore state_referenced_locally
	let formValues = $state<Record<string, unknown>>(buildEmpty(data.schemaDef?.fields ?? []));
	let validationErrors = $state<Record<string, string>>({});
	let errorKeys = $state<Record<string, string>>({});
	const create = tracked(() => {});

	// Locale. Default to first locale's code or 'en'. A schema that is not
	// localized, or an instance without the localization plugin, has none.
	let locales = $derived(data.locales?.ok ? data.locales.value : []);
	// svelte-ignore state_referenced_locally
	let selectedLocale = $state((locales.find((l) => l.is_default) ?? locales[0])?.code ?? 'en');

	let serialized = $derived(() => {
		const base = JSON.parse(serialize(userFields, formValues)) as Record<string, unknown>;
		if (locales.length > 0) base._locale = selectedLocale;
		return JSON.stringify(base);
	});
	let m2mRelations = $derived(JSON.stringify(
		Object.fromEntries(extractM2MRelations(userFields, formValues).map((r) => [r.fieldName, r.ids]))
	));

	// A value the plugin refused comes back by field, so each control marks its
	// own message the way a value refused before sending does.
	$effect(() => {
		if (form && 'fieldErrors' in form && form.fieldErrors) {
			validationErrors = form.fieldErrors as Record<string, string>;
			errorKeys = ('errorKeys' in form && form.errorKeys ? form.errorKeys : {}) as Record<string, string>;
		}
	});

	// Set once the create answered but a link did not land. The entry exists,
	// so the form offers the entry instead of a second Create.
	let created = $derived(form && 'created' in form && typeof form.created === 'string' ? form.created : '');

	function handleSubmit(e: SubmitEvent) {
		const errors = validate(userFields, formValues);
		if (Object.keys(errors).length > 0) {
			e.preventDefault();
			validationErrors = errors;
			errorKeys = {};
		}
	}

	let schemaName = $derived(data.schemaDef?.name ?? '');
	let schemaLabel = $derived(data.schemaDef?.display_name || schemaName);

	const back = $derived({ href: `/admin/content/${schemaName}`, label: schemaLabel });
</script>

<PageShell
	title="New entry"
	description={`Add an entry to ${schemaLabel}.`}
	width="wide"
	{back}
>
	{#snippet breadcrumb()}
		<Breadcrumb items={crumbsAfter(back, [
			{ label: 'Content', href: '/admin/content' },
			{ label: schemaLabel, href: `/admin/content/${schemaName}` },
			{ label: 'New entry' },
		])} />
	{/snippet}

	{#snippet actions()}
		{#if locales.length > 0}
			<div class="flex items-end gap-2">
				<Globe size={ICON.sm} class="mb-2.5 text-muted" aria-hidden="true" />
				<Select
					id="entry-locale"
					label="Locale"
					searchable
					options={locales.map((l) => ({ value: l.code, label: `${l.name} (${l.code})` }))}
					value={selectedLocale}
					onvaluechange={(v) => (selectedLocale = v)}
				/>
			</div>
		{/if}
	{/snippet}

	{#if data.locales && !data.locales.ok}
		<Alert tone="warn">
			{couldNotLoad('the locales')} If you save now, the entry has no locale. Reload the page to try again.
		</Alert>
	{/if}

	<form
		method="POST"
		use:enhance={create.enhance}
		onsubmit={handleSubmit}
	>
		<!-- Serialized data hidden field. Reactive, always current -->
		<input type="hidden" name="data" value={serialized()} />
		<input type="hidden" name="m2m_relations" value={m2mRelations} />

		<Card class="space-y-5">
			<ContentForm
				fields={userFields}
				{formValues}
				{validationErrors}
				{errorKeys}
				relations={data.relations}
				mediaChoices={data.mediaChoices}
				error={form?.error}
			/>
		</Card>

		<div class="mt-5 flex justify-end">
			{#if created}
				<Button href={`/admin/content/${schemaName}/${encodeURIComponent(created)}`}>Open the entry</Button>
			{:else}
				<Button type="submit" loading={create.pending}>Create</Button>
			{/if}
		</div>
	</form>
</PageShell>
