<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Card,
		EmptyState,
		PageShell,
		SearchInput,
		SectionHeading,
	} from '@lyeve-labs/ui-kit';
	import type { PageData, ActionData } from './$types';
	import type { ConfigSetting } from './+page.server';
	import SettingRow from '$lib/components/SettingRow.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { Lock, FileCode, Terminal, PencilLine } from '@lucide/svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { ICON } from '$lib/icon';
	import { settingForms, settingMatches } from '$lib/config-forms';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let filter = $state('');

	// The action answers with a failure carrying an error or with a success, and
	// both name the setting they belong to so a row shows only its own result.
	interface SaveResult {
		key?: string;
		error?: string;
		success?: boolean;
	}
	const result = $derived((form ?? null) as SaveResult | null);

	const provenance = $derived(data.provenance.ok ? data.provenance.value : null);
	const settings = $derived(provenance?.settings ?? []);
	const counts = $derived(provenance?.counts ?? {});
	const suppressed = $derived(provenance?.suppressed ?? []);

	// Opened for one plugin, only its settings are listed.
	const scope = $derived(data.plugin ? new Set(data.plugin.keys) : null);
	const shown = $derived(settings.filter((s) => (!scope || scope.has(s.key)) && settingMatches(s, filter)));
	const editableCount = $derived(settings.filter((s) => s.editable).length);

	// Why a setting cannot be edited here, in the operator's terms.
	function pinnedBy(setting: ConfigSetting): string {
		if (setting.source === 'env') return 'Set by an environment variable, which always wins.';
		if (setting.source === 'file') {
			return setting.origin
				? `Set in ${setting.origin}. Tag the value !overridable there to edit it here.`
				: 'Set in the configuration file. Tag the value !overridable there to edit it here.';
		}
		return 'Not editable.';
	}
</script>

<PageShell
	title="Configuration"
	description="See every engine setting and where its value comes from."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#if !data.provenance.ok}
		<GateNotice
			level={2}
			gate={data.provenance.gate}
			title="Configuration"
			absent="Configuration needs a newer version of the engine."
		/>
	{:else}
		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Where the values come from</SectionHeading>

			<div class="flex flex-wrap items-center gap-3">
				<Badge tone="neutral">
					<Terminal size={ICON.xs} aria-hidden="true" />
					{counts.env ?? 0} from the environment
				</Badge>
				<Badge tone="neutral">
					<FileCode size={ICON.xs} aria-hidden="true" />
					{counts.file ?? 0} from files
				</Badge>
				<Badge tone="neutral">
					<PencilLine size={ICON.xs} aria-hidden="true" />
					{counts.admin ?? 0} saved here
				</Badge>
				<span class="text-xs text-faint">{editableCount} of {settings.length} editable</span>
			</div>

			{#if suppressed.length > 0}
				<Alert tone="warn" title="Set to empty by an environment variable">
					<p>
						A file or this page sets these, but an empty environment variable overrides them. Check for a
						leftover line in a .env file.
					</p>
					<p class="mt-2 font-mono text-xs text-faint">{suppressed.join(', ')}</p>
				</Alert>
			{/if}
		</section>

		<Card>
			<div class="flex flex-col gap-3 text-sm text-muted">
				<SectionHeading level={3}>How to set a setting</SectionHeading>
				<p>
					<span class="font-medium text-fg">An environment variable</span>, such as
					<code class="font-mono text-xs">JWT_EXPIRY_SECS=900</code>, wins over everything. Setting one to
					empty turns the setting off, even when a file or this page sets it.
				</p>
				<p>
					<span class="font-medium text-fg">A YAML file</span> comes next. The engine uses the file or
					directory set in <code class="font-mono text-xs">LYEVE_CONFIG</code>. Without it, the engine uses
					<code class="font-mono text-xs">lyeve.yaml</code> (or <code class="font-mono text-xs">lyeve.yml</code>) in the
					directory it runs in, then in <code class="font-mono text-xs">/etc/lyeve</code>, then the files of
					<code class="font-mono text-xs">/etc/lyeve/conf.d</code> in name order. A key is the variable's name in
					lower case, <code class="font-mono text-xs">jwt_expiry_secs: 900</code>, or nested, with each
					underscore a level: <code class="font-mono text-xs">database:</code> then
					<code class="font-mono text-xs">url: ...</code> is <code class="font-mono text-xs">DATABASE_URL</code>. A
					<code class="font-mono text-xs">$include</code> key pulls in other files. A value tagged
					<code class="font-mono text-xs">!overridable</code> becomes a default you can change on this page.
					Any other file value is fixed here.
				</p>
				<p>
					<span class="font-medium text-fg">This page</span> sets what neither of those sets. A saved
					value applies immediately, without a restart, except for a setting read when the engine starts,
					which applies at the next restart. A setting nobody sets uses its default.
				</p>
			</div>
		</Card>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Settings</SectionHeading>
			{#if data.plugin}
				<Alert tone={data.plugin.found ? 'brand' : 'warn'}>
					{#if data.plugin.found}
						Showing the settings of the <span class="font-mono">{data.plugin.name}</span> plugin.
					{:else if data.plugin.failed}
						Could not load the settings of the <span class="font-mono">{data.plugin.name}</span> plugin, so
						some may be missing below. Reload the page to try again.
					{:else}
						The <span class="font-mono">{data.plugin.name}</span> plugin has no settings, or is not running.
					{/if}
					<a href="/admin/settings/configuration" class="ml-1 text-brand hover:underline">Show every setting</a>
				</Alert>
			{/if}

			<div class="flex flex-col gap-4">
				<ListToolbar label="Filter settings">
					{#snippet search()}
						<label for="config-filter" class="sr-only">Filter settings</label>
						<SearchInput id="config-filter" placeholder="Name or what it does" bind:value={filter} />
					{/snippet}
				</ListToolbar>

				{#if settings.length === 0}
					<EmptyState
						title="No settings to show"
						description="Reload the page to try again."
					/>
				{:else if shown.length === 0}
					<EmptyState
						title="No settings match this search"
						description="Clear the search to see every setting."
					/>
				{:else}
					<Card pad="none">
						<div class="divide-y divide-line">
							{#each shown as setting (setting.key)}
								<div class="p-4">
									<div class="flex flex-wrap items-baseline justify-between gap-2">
										<code class="font-mono text-sm text-fg">{setting.key}</code>
										<span class="inline-flex items-center gap-1 text-xs text-faint">
											{#if setting.source === 'env'}
												<Terminal size={ICON.xs} aria-hidden="true" /> environment
											{:else if setting.source === 'file'}
												<FileCode size={ICON.xs} aria-hidden="true" /> {setting.origin ?? 'file'}
											{:else if setting.source === 'admin'}
												<PencilLine size={ICON.xs} aria-hidden="true" /> saved here
											{:else}
												default
											{/if}
										</span>
									</div>
									{#if setting.description}
										<p class="mt-1 text-sm text-muted">{setting.description}</p>
									{/if}
									<p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
										{#if setting.default}<span>Default: {setting.default}</span>{/if}
										<span>Environment <code class="font-mono">{settingForms(setting.key).env}</code></span>
										<span>File <code class="font-mono">{settingForms(setting.key).file}</code></span>
									</p>

									{#if setting.editable}
										{#if setting.read_at_start}
											<p class="mt-1 text-xs text-faint">Read when the engine starts. A saved value applies at the next restart.</p>
										{/if}
										<div class="mt-2">
											<SettingRow
												id="set-{setting.key}"
												name={setting.key}
												label={setting.key}
												value={setting.value}
												secret={setting.secret}
												saved={setting.read_at_start
													? 'Saved. It applies when the engine next restarts.'
													: 'Saved. It applies now.'}
												{result}
											/>
										</div>
									{:else}
										<div class="mt-2 flex flex-wrap items-center gap-2">
											<Lock size={ICON.xs} class="text-faint" aria-hidden="true" />
											{#if setting.secret}
												<span class="flex-1 rounded-lg bg-surface-2 px-3 py-1.5 text-sm text-faint">
													Stored, not shown.
												</span>
											{:else}
												<code
													class="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-1.5 font-mono text-sm break-all text-muted"
												>
													{setting.value ?? ''}
												</code>
											{/if}
										</div>
										<p class="mt-1 text-xs text-faint">{pinnedBy(setting)}</p>
									{/if}
								</div>
							{/each}
						</div>
					</Card>
				{/if}
			</div>
		</section>
	{/if}
</PageShell>
