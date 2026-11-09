<script lang="ts">
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		Alert,
		Badge,
		Button,
		Card,
		Input,
		PageShell,
		Panel,
		SectionHeading,
		Select,
		Tag,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { ArrowDown, ArrowUp, Plus, X } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const pageRefusal = $derived(formRefusal(form));

	// The saved answer wins over the loaded one: the action returns without a
	// redirect, so `data` still carries what the page opened with. A read that
	// failed shows no form, so the empty value below is never drawn.
	let loaded = $derived(
		form && 'locales' in form && form.locales
			? form.locales
			: data.locales.ok
				? data.locales.value
				: { default_locale: '', enabled_locales: [], fallback_chain: [] },
	);

	// The form, seeded once from what the page opened with.
	// svelte-ignore state_referenced_locally
	const draft = $state({
		defaultLocale: loaded.default_locale,
		enabled: [...loaded.enabled_locales],
		chain: [...loaded.fallback_chain],
	});
	let newLocale = $state('');
	let chainPick = $state<string | null>('');
	let submitting = $state(false);

	let addable = $derived(
		draft.enabled
			.filter((l) => l !== draft.defaultLocale && !draft.chain.includes(l))
			.map((l) => ({ value: l, label: l })),
	);

	function addLocale() {
		const code = newLocale.trim();
		if (!code || draft.enabled.includes(code)) return;
		draft.enabled = [...draft.enabled, code];
		newLocale = '';
	}

	function removeLocale(code: string) {
		draft.enabled = draft.enabled.filter((l) => l !== code);
		draft.chain = draft.chain.filter((l) => l !== code);
	}

	function appendToChain() {
		const pick = chainPick ?? '';
		if (!pick || draft.chain.includes(pick)) return;
		draft.chain = [...draft.chain, pick];
		chainPick = '';
	}

	function move(index: number, by: -1 | 1) {
		const to = index + by;
		if (to < 0 || to >= draft.chain.length) return;
		const next = [...draft.chain];
		[next[index], next[to]] = [next[to], next[index]];
		draft.chain = next;
	}

	let enabledJSON = $derived(JSON.stringify(draft.enabled));
	let chainJSON = $derived(JSON.stringify(draft.chain));
</script>

<PageShell
	title="Locales"
	description="Choose the languages for this tenant's content and the order missing translations fall back through."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#snippet actions()}
		<Badge tone="violet" size="sm">Beta</Badge>
	{/snippet}

	{#if !data.locales.ok}
		<GateNotice
			level={2}
			gate={data.locales.gate}
			title="Locales"
			absent="Localization is not included in this build."
		/>
	{:else}
		<FormErrors message={form?.error ?? undefined} refused={pageRefusal} />
		{#if form?.saved}
			<Alert tone="success" autoDismiss>Locales saved.</Alert>
		{/if}

		<form
			method="POST"
			action="?/save"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					submitting = false;
					await update({ reset: false });
				};
			}}
			class="flex flex-col gap-5"
		>
			<input type="hidden" name="enabled_locales" value={enabledJSON} />
			<input type="hidden" name="fallback_chain" value={chainJSON} />

			<Card>
				<div class="flex flex-col gap-4">
					<SectionHeading level={2}>Default locale</SectionHeading>
					<Input
						id="default-locale"
						name="default_locale"
						label="Default locale"
						hint="The language of the source fields. Readers who do not ask for a language get this one."
						placeholder="en"
						bind:value={draft.defaultLocale}
						autocomplete="off"
						mono
					/>
				</div>
			</Card>

			<Card>
				<div class="flex flex-col gap-4">
					<SectionHeading level={2}>Enabled locales</SectionHeading>
					<p class="text-sm text-muted">
						Each locale adds a tab to every entry's Translations panel. Use language tags such as
						<span class="font-mono">fr</span> or <span class="font-mono">pt-BR</span>.
					</p>
					<div class="flex flex-wrap items-center gap-2" role="list" aria-label="Enabled locales">
						{#each draft.enabled as code (code)}
							<div role="listitem">
								{#if code === draft.defaultLocale}
									<Tag label="{code} (default)" tone="brand" />
								{:else}
									<Tag label={code} removable onremove={() => removeLocale(code)} />
								{/if}
							</div>
						{:else}
							<span class="text-sm text-faint">No locales enabled yet.</span>
						{/each}
					</div>
					<div class="flex items-end gap-2">
						<Input
							id="new-locale"
							label="Add locale"
							placeholder="fr"
							bind:value={newLocale}
							autocomplete="off"
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									addLocale();
								}
							}}
							mono
						/>
						<Button type="button" variant="secondary" size="md" onclick={addLocale}>
							<Plus size={ICON.sm} /> Add locale
						</Button>
					</div>
				</div>
			</Card>

			<Card>
				<div class="flex flex-col gap-4">
					<SectionHeading level={2}>Fallback chain</SectionHeading>
					<p class="text-sm text-muted">
						When a translation is missing, readers get the first locale in this order that has one,
						then the source fields.
					</p>
					<ol class="flex flex-col gap-2" aria-label="Fallback chain">
						{#each draft.chain as code, i (code)}
							<li>
								<Panel pad="none">
									<div class="flex items-center gap-2 px-3 py-2">
										<span class="w-6 text-xs text-faint">{i + 1}.</span>
										<span class="flex-1 font-mono text-sm text-fg">{code}</span>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											aria-label="Move {code} up"
											disabled={i === 0}
											onclick={() => move(i, -1)}
										>
											<ArrowUp size={ICON.sm} />
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											aria-label="Move {code} down"
											disabled={i === draft.chain.length - 1}
											onclick={() => move(i, 1)}
										>
											<ArrowDown size={ICON.sm} />
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											aria-label="Remove {code} from the chain"
											onclick={() => (draft.chain = draft.chain.filter((l) => l !== code))}
										>
											<X size={ICON.sm} />
										</Button>
									</div>
								</Panel>
							</li>
						{:else}
							<li class="text-sm text-faint">
								No locales in the chain. A missing translation falls back to the source fields.
							</li>
						{/each}
					</ol>
					<div class="flex items-end gap-2">
						<div class="flex-1">
							<Select
								id="chain-pick"
								label="Append a locale"
								placeholder="Choose a locale"
								options={addable}
								searchable
								bind:value={chainPick}
								disabled={addable.length === 0}
							/>
						</div>
						<Button
							type="button"
							variant="secondary"
							size="md"
							disabled={!chainPick}
							onclick={appendToChain}
						>
							<Plus size={ICON.sm} /> Append
						</Button>
					</div>
				</div>
			</Card>

			<div class="flex justify-end">
				<Button type="submit" loading={submitting}>Save</Button>
			</div>
		</form>
	{/if}
</PageShell>
