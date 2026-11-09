<script lang="ts">
	/**
	 * The provider fields, shared by create and edit.
	 *
	 * The form is one component so the compatible kind's endpoint fields, the
	 * key placeholder and the private-address rule are stated once. It renders
	 * only the fields, so the owner decides where the buttons go: a drawer
	 * footer on create, a card on the detail page.
	 */
	import { CheckboxGroup, Input, NumberInput, PasswordInput, RadioGroup, Select, Toggle } from '@lyeve-labs/ui-kit';
	import { MODALITIES, PRESETS, PROVIDER_KINDS, isCompatibleKind, providerKindDescription, providerKindLabel, type AiProvider, type Modality, type ProviderKind } from '$lib/api/ai';

	let {
		id,
		provider = null,
		superAdmin,
	}: {
		/** The prefix for every field id, so two forms on one page stay distinct. */
		id: string;
		provider?: AiProvider | null;
		superAdmin: boolean;
	} = $props();

	let preset = $state('');
	// svelte-ignore state_referenced_locally
	const form = $state({
		kind: (provider?.kind ?? 'openai') as ProviderKind,
		baseUrl: provider?.base_url ?? '',
		keyHeader: provider?.key_header ?? '',
		queryString: provider?.query_string ?? '',
		allowPrivate: provider?.allow_private ?? false,
		enabled: provider?.enabled ?? true,
		modalities: {
			text: provider ? provider.modalities.includes('text') : true,
			embed: provider ? provider.modalities.includes('embed') : true,
			image: provider ? provider.modalities.includes('image') : true,
		} as Record<Modality, boolean>,
	});

	const compatible = $derived(isCompatibleKind(form.kind));
	const anthropicShaped = $derived(form.kind === 'anthropic_compatible');
	const kindOptions = PROVIDER_KINDS.map((k) => ({ value: k, label: providerKindLabel(k), description: providerKindDescription(k) }));
	const presetOptions = [{ value: '', label: 'None' }, ...PRESETS.map((p) => ({ value: p.id, label: p.label }))];

	// A preset fills what is blank and never overwrites what the operator typed.
	function applyPreset(next: string) {
		preset = next;
		const p = PRESETS.find((x) => x.id === next);
		if (!p) return;
		if (!form.baseUrl) form.baseUrl = p.base_url;
		if (!form.keyHeader) form.keyHeader = p.key_header;
		if (!form.queryString) form.queryString = p.query_string;
	}

	const keyHint = $derived(
		provider?.needs_key
			? "The saved key can no longer be decrypted after an encryption key change. Enter it again. The provider's other settings are kept."
			: provider?.has_key
				? 'A key is stored. Leave this blank to keep it.'
				: compatible
					? 'Optional. A local server usually needs none.'
					: 'Required. It is encrypted at rest and never shown again.'
	);
</script>

<input type="hidden" name="enabled" value={form.enabled ? 'true' : 'false'} />
<input type="hidden" name="allow_private" value={form.allowPrivate ? 'true' : 'false'} />

<div class="grid gap-4 md:grid-cols-2">
	<Input id="{id}-name" name="name" label="Name" required value={provider?.name ?? ''} placeholder="openai-primary" />
	<!-- Two of the four labels are long, so a strip of segments overflows a
	     phone. A list with a sentence on each stays inside it. -->
	<div class="md:col-span-2">
		<RadioGroup name="kind" label="Kind" options={kindOptions} bind:value={form.kind} />
	</div>

	{#if compatible && !anthropicShaped}
		<Select
			id="{id}-preset"
			name="preset"
			label="Preset"
			hint="Fills in the base URL and key header for a self-hosted server. The provider stays OpenAI-compatible."
			options={presetOptions}
			searchable
			value={preset}
			onvaluechange={applyPreset}
		/>
	{/if}
	{#if compatible}
		<Input
			id="{id}-base-url"
			name="base_url"
			label="Base URL"
			required
			bind:value={form.baseUrl}
			placeholder={anthropicShaped ? 'https://gateway.example.com/anthropic/v1' : 'http://localhost:11434/v1'}
			hint={anthropicShaped
				? 'The root URL of the Anthropic Messages API, without /messages.'
				: 'The root URL of the OpenAI-compatible API.'}
		/>
		<Input
			id="{id}-key-header"
			name="key_header"
			label="Key header"
			bind:value={form.keyHeader}
			placeholder={anthropicShaped ? 'x-api-key' : 'Authorization'}
			hint={anthropicShaped
				? 'Leave blank to send x-api-key, as Anthropic expects. Some gateways expect Authorization.'
				: 'Leave blank to send Authorization: Bearer. Azure expects api-key.'}
		/>
		<Input
			id="{id}-query-string"
			name="query_string"
			label="Query string"
			bind:value={form.queryString}
			placeholder="api-version=2024-10-21"
			hint="Added to every request. Azure expects api-version."
		/>
	{/if}

	<div class="md:col-span-2">
		<PasswordInput
			id="{id}-key"
			name="api_key"
			label="API key"
			required={!compatible && !provider?.has_key}
			placeholder={provider?.has_key && !provider.needs_key ? 'Stored' : 'sk-'}
			hint={keyHint}
			autocomplete="off"
		/>
	</div>

	<Input
		id="{id}-model"
		name="default_model"
		label="Default model"
		value={provider?.default_model ?? ''}
		placeholder="gpt-4o"
		hint="Used when a request does not name a model."
	/>
	<NumberInput
		id="{id}-priority"
		name="priority"
		label="Priority"
		value={provider?.priority ?? 100}
		min={-1000}
		max={1000}
		hint="When a request does not name a provider, higher priority is tried first."
	/>

	<CheckboxGroup
		class="md:col-span-2"
		name="modalities"
		label="Modalities"
		orientation="horizontal"
		options={MODALITIES.map((m) => ({ value: m, label: m }))}
		value={MODALITIES.filter((m) => form.modalities[m])}
		onchange={(v) => (form.modalities = { text: v.includes('text'), embed: v.includes('embed'), image: v.includes('image') })}
		hint="What this provider may be used for. A request also needs a model that supports it."
	/>

	<NumberInput
		id="{id}-rpm"
		name="rate_limit_rpm"
		label="Rate limit"
		value={provider?.rate_limit_rpm ?? 0}
		min={0}
		hint="Requests per minute. 0 means no limit."
	/>
	<NumberInput
		id="{id}-budget"
		name="max_budget_usd"
		label="Monthly budget"
		value={provider?.max_budget_usd ?? 0}
		min={0}
		step={0.01}
		hint="Dollars per billing period. 0 means no limit. Requests over the budget are refused with a 402."
	/>

	<div class="md:col-span-2">
		<Toggle id="{id}-enabled" label="Enabled" hint="When on, requests can be sent to this provider. Turning it off keeps its settings." bind:checked={form.enabled} />
	</div>

	{#if compatible && superAdmin}
		<div class="md:col-span-2 flex flex-col gap-2">
			<Toggle
				id="{id}-allow-private"
				label="Allow a private address"
				hint="When on, the base URL may resolve to a private, loopback or link-local address."
				bind:checked={form.allowPrivate}
			/>
			{#if form.allowPrivate}
				<p class="text-xs text-warn" role="note">
					Requests to this provider skip the private-address check, so you can reach a local Ollama or vLLM.
					The provider can then point at anything on your network the engine can reach, except the engine's own
					database. Only a super admin can set this.
				</p>
			{/if}
		</div>
	{/if}
</div>
