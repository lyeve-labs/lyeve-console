<script lang="ts">
	import { Alert, Badge, Button, Card, Label, SectionHeading, Tabs, type StatusTone } from '@lyeve-labs/ui-kit';
	import type { SchemaField } from '@lyeve-labs/client';
	import { enhance } from '$app/forms';
	import { CircleCheck } from '@lucide/svelte';
	import {
		completenessOf,
		translatableFields,
		translationValues,
		usesMarkedFields,
		type LocalePreferences,
		type Translation,
		type TranslationStatus,
	} from '$lib/api/localization';
	import FieldInput from './FieldInput.svelte';
	import { ICON } from '$lib/icon';
	import { plural } from '$lib/format';

	let {
		fields,
		locales,
		translations,
		unavailable = false,
		error = null,
		errorLocale = '',
	}: {
		fields: SchemaField[];
		locales: LocalePreferences;
		translations: Translation[];
		/** The plugin is entitled and did not answer. */
		unavailable?: boolean;
		/** The last action's refusal, shown under the locale it was about. */
		error?: string | null;
		errorLocale?: string;
	} = $props();

	let textFields = $derived(translatableFields(fields));

	// The source is written in the default locale, so it is never a tab: a
	// translation into the language the entry is already in is the entry.
	let targets = $derived(locales.enabled_locales.filter((l) => l !== locales.default_locale));

	let byLocale = $derived(new Map(translations.map((t) => [t.locale, t])));

	// The refused locale first, so the message lands on the tab it is about.
	function firstTab(): string {
		if (errorLocale && targets.includes(errorLocale)) return errorLocale;
		return targets[0] ?? '';
	}

	/**
	 * One field map per locale, seeded from what the plugin holds. Every
	 * action redirects back to this page, which swaps the props without
	 * remounting, so the seed is redone whenever a translation changes.
	 */
	function seed(): Record<string, Record<string, string>> {
		return Object.fromEntries(targets.map((l) => [l, translationValues(byLocale.get(l), textFields)]));
	}
	function version(): string {
		return translations.map((t) => `${t.locale}:${t.updated_at}:${t.translation_status}`).join('|') + '#' + targets.join(',');
	}
	// The open tab, the field maps and the version they were seeded from.
	// svelte-ignore state_referenced_locally
	const draft = $state({ active: firstTab(), values: seed(), version: version() });
	$effect(() => {
		const v = version();
		if (v === draft.version) return;
		draft.version = v;
		draft.values = seed();
	});
	$effect(() => {
		if (!targets.includes(draft.active)) draft.active = firstTab();
	});

	function current(locale: string): Translation | undefined {
		return byLocale.get(locale);
	}

	function statusOf(locale: string): TranslationStatus | 'missing' {
		return current(locale)?.translation_status ?? 'missing';
	}

	const STATUS_LABEL: Record<TranslationStatus | 'missing', string> = {
		missing: 'Not started',
		draft: 'Draft',
		translated: 'Translated',
		outdated: 'Outdated',
	};
	const STATUS_TONE: Record<TranslationStatus | 'missing', StatusTone> = {
		missing: 'neutral',
		draft: 'neutral',
		translated: 'success',
		outdated: 'warn',
	};

	// An outdated translation is named in the strip itself, so the operator
	// sees which languages need attention without opening each one.
	let tabs = $derived(
		targets.map((l) => ({ id: l, label: statusOf(l) === 'outdated' ? `${l}, outdated` : l })),
	);

	let submitting = $state(false);
	let serialized = $derived(JSON.stringify(draft.values[draft.active] ?? {}));

	// Whether the schema has been marked, or the panel is still guessing from
	// the field types. Worth saying, because the two answers can differ and an
	// editor should know which one they are looking at.
	let marked = $derived(usesMarkedFields(fields));

	/*
	 * How far along each locale is, measured from the boxes rather than from
	 * what was last saved, so the bar moves while somebody types. It is the
	 * same rule the plugin applies server-side: whitespace is not a
	 * translation, because a field holding a space is what a half-finished
	 * paste leaves behind.
	 */
	let progress = $derived(
		Object.fromEntries(
			targets.map((l) => [l, completenessOf(draft.values[l] ?? {}, textFields)]),
		),
	);
	let activeProgress = $derived(progress[draft.active]);

	/**
	 * Which locale a reader actually gets a field from.
	 *
	 * The Locales page states the chain abstractly, and standing in front of an
	 * entry the question is concrete. This walks the same chain the engine
	 * walks: the locale itself, its language when the tab carries a region, the
	 * tenant's stored chain, then the default, stopping at the default because
	 * the source fields are written in it.
	 */
	function resolvedFrom(field: string, locale: string): string {
		const chain = [locale];
		const cut = locale.search(/[-_]/);
		if (cut > 0) chain.push(locale.slice(0, cut));
		for (const l of locales.fallback_chain) chain.push(l);
		chain.push(locales.default_locale);

		const seen = new Set<string>();
		for (const l of chain) {
			if (!l || seen.has(l)) continue;
			seen.add(l);
			if (l === locales.default_locale) break;
			if ((draft.values[l]?.[field] ?? '').trim() !== '') return l;
		}
		return locales.default_locale;
	}
</script>

<Card>
	{#snippet header()}
		<div class="flex items-center justify-between gap-3">
			<SectionHeading level={3}>
				<span class="flex items-center gap-2">
					Translations
					<Badge tone="violet" size="sm">Beta</Badge>
				</span>
			</SectionHeading>
			<a href="/admin/settings/localization" class="relative hit-area text-xs text-muted hover:text-fg transition-colors">
				Locales
			</a>
		</div>
	{/snippet}

	<div class="flex flex-col gap-4" data-testid="translations-panel">
		{#if unavailable}
			<Alert tone="warn" title="Could not load translations">
				The localization plugin is not running on this engine, so translations are not available.
			</Alert>
		{:else if targets.length === 0}
			<p class="text-sm text-muted">
				No locales to translate into yet. Enable one under
				<a href="/admin/settings/localization" class="text-brand underline-offset-2 hover:underline">
					locales
				</a>
				to add it here as a tab.
			</p>
		{:else if textFields.length === 0}
			<p class="text-sm text-muted">This content type has no text field to translate.</p>
		{:else}
			{#if !marked}
				<!-- The schema carries no per-field mark, so these are every
				     text field rather than the ones somebody chose. Saying so
				     stops the list reading as a decision nobody made. -->
				<p class="text-xs text-faint">
					No field on this content type is marked as translated, so every text field is shown. Mark
					the ones you translate in the
					<a href="/admin/schema" class="text-brand underline-offset-2 hover:underline">
						schema builder
					</a>
					to show only those.
				</p>
			{/if}

			<Tabs items={tabs} active={draft.active} onchange={(id) => (draft.active = id)} />

			{#if draft.active && draft.values[draft.active]}
				{@const t = current(draft.active)}
				{@const status = statusOf(draft.active)}
				<div class="flex flex-col gap-4" data-testid="translation-{draft.active}" data-status={status}>
					<div class="flex flex-wrap items-center gap-2">
						<Badge tone={STATUS_TONE[status]} dot>{STATUS_LABEL[status]}</Badge>
						{#if status === 'outdated'}
							<span class="text-xs text-warn">
								The source changed after this was translated. Review it, then mark it translated.
							</span>
						{:else if status === 'missing'}
							<span class="text-xs text-faint">Readers of {draft.active} see the source until this is saved.</span>
						{/if}
						{#if t && status !== 'translated'}
							<form method="POST" action="?/markTranslated" use:enhance class="ml-auto">
								<input type="hidden" name="locale" value={draft.active} />
								<Button variant="secondary" size="sm" type="submit">
									<CircleCheck size={ICON.sm} /> Mark translated
								</Button>
							</form>
						{/if}
					</div>

					<!-- How far along, measured from the boxes rather than from what
					     was last saved, so it moves while somebody types. A
					     schema with nothing marked is complete rather than zero:
					     there is nothing outstanding. -->
					<div class="flex flex-col gap-1.5" data-testid="completeness-{draft.active}">
						<div class="flex items-baseline justify-between gap-2 text-xs">
							<span class="text-muted">
								{activeProgress.done} of {activeProgress.total}
								{plural(activeProgress.total, 'field')} written
							</span>
							<span class="font-mono text-faint">{activeProgress.percent}%</span>
						</div>
						<div class="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
							<div
								class="h-full transition-[width] duration-progress {activeProgress.percent === 100
									? 'bg-success'
									: 'bg-brand'}"
								style:width={`${activeProgress.percent}%`}
							></div>
						</div>
					</div>

					{#if error && errorLocale === draft.active}
						<Alert tone="danger">{error}</Alert>
					{/if}

					<form
						method="POST"
						action="?/saveTranslation"
						use:enhance={() => {
							submitting = true;
							return async ({ update }) => {
								submitting = false;
								await update();
							};
						}}
						class="flex flex-col gap-4"
					>
						<input type="hidden" name="locale" value={draft.active} />
						<input type="hidden" name="exists" value={t ? 'true' : 'false'} />
						<input type="hidden" name="data" value={serialized} />

						{#each textFields as field (field.name)}
							<div class="flex flex-col gap-1.5" data-field-name={field.name}>
								<Label
									for={field.field_type === 'rich_text' ? undefined : `translation-${draft.active}-${field.name}`}
									hint={field.field_type}
								>
									{field.name}
								</Label>
								<FieldInput
									{field}
									id="translation-{draft.active}-{field.name}"
									bind:value={draft.values[draft.active][field.name]}
								/>
								<!-- What a reader actually gets for this field, right
								     here. The chain is stated on the Locales page and
								     nobody can work out from there whether this box
								     being empty means French or Spanish reaches the
								     reader. -->
								{#if (draft.values[draft.active][field.name] ?? '').trim() === ''}
									<!-- Once the locale has a translation, the reader gets that
									     one row, and a field it leaves out reads from the source.
									     The plugin keeps a saved title when a save sends none, and
									     a new translation cannot be saved without one. -->
									{@const from = t ? locales.default_locale : resolvedFrom(field.name, draft.active)}
									<p class="text-xs text-faint">
										{#if field.name === 'title' && !t}
											A new translation needs a title. If you leave it empty, it copies the current source title, and later changes to the source do not update it.
										{:else if field.name === 'title'}
											If you leave it empty, the title saved for {draft.active} stays as it is.
										{:else if from === locales.default_locale}
											Readers of {draft.active} see the source while this is empty.
										{:else}
											Readers of {draft.active} see this field in {from} while this is empty.
										{/if}
									</p>
								{/if}
							</div>
						{/each}

						<div class="flex justify-end">
							<Button type="submit" size="sm" loading={submitting}>Save</Button>
						</div>
					</form>
				</div>
			{/if}
		{/if}
	</div>
</Card>
