<script lang="ts">
	import { Alert, Badge, Button, Collapsible, Drawer, FileInput, Panel, SectionHeading, Select, Textarea, toast } from '@lyeve-labs/ui-kit';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import type { ImportPlan } from '../+page.server';
	import { IMPORT_SOURCES } from '../import-sources';

	type ImportNote = { schema: string; field?: string; message: string };

	// Import, in two steps: the engine's plan first, then the run. The file
	// or the paste stays in the form between them, so the second submit sends
	// what the first one checked. The page opens it with show(), which starts
	// from no plan.
	let importOpen = $state(false);
	let importForm = $state<HTMLFormElement>();
	let importSource = $state<string>('lyeve');
	let importText = $state('');
	let importFileName = $state('');
	let importApply = $state(false);
	let importing = $state(false);
	let importPlan = $state<ImportPlan | null>(null);
	let importNotes = $state<ImportNote[]>([]);
	let importRenamed = $state<Record<string, string>>({});
	let importError = $state('');

	const importBlocked = $derived(
		(importPlan?.schemas ?? []).filter((s) => (s.missing?.length ?? 0) > 0).map((s) => s.name),
	);
	const importChanges = $derived((importPlan?.schemas ?? []).filter((s) => s.action !== 'unchanged').length);

	// The engine keys a rename by the name it ends with, "<schema>" or
	// "<schema>.<field>", and writes "<from> -> <to>" as the value. The line
	// names the field's schema once, in front of the name it came with.
	const importRenames = $derived(
		Object.entries(importRenamed).map(([key, line]) => {
			const [from, to] = line.split(' -> ');
			const dot = key.indexOf('.');
			return { key, from: (dot < 0 ? '' : key.slice(0, dot + 1)) + from, to };
		}),
	);

	export function show() {
		importPlan = null;
		importNotes = [];
		importRenamed = {};
		importError = '';
		importApply = false;
		importOpen = true;
	}

	/** Anything edited after the plan was read makes the plan stale. */
	function importEdited() {
		importPlan = null;
		importError = '';
	}

	async function runImport(apply: boolean) {
		importApply = apply;
		// The hidden field has to carry the flag before the form is read.
		await tick();
		importForm?.requestSubmit();
	}

	const submitImport: SubmitFunction = () => {
		importing = true;
		importError = '';
		return async ({ result }) => {
			importing = false;
			if (result.type === 'success' && result.data && 'plan' in result.data) {
				const d = result.data as {
					applied: boolean;
					plan: ImportPlan;
					renamed: Record<string, string>;
					notes: ImportNote[];
				};
				if (d.applied) {
					const n = d.plan.schemas.filter((x) => x.action !== 'unchanged').length;
					importOpen = false;
					toast.success(n === 1 ? 'Imported one content type' : `Imported ${n} content types`);
					await invalidateAll();
					return;
				}
				importPlan = d.plan;
				importNotes = d.notes;
				importRenamed = d.renamed;
			} else if (result.type === 'failure') {
				const d = (result.data ?? {}) as { error?: string; plan?: ImportPlan | null };
				importError = d.error ?? 'Could not import the definitions. Try again.';
				if (d.plan) importPlan = d.plan;
			} else if (result.type === 'error') {
				importError = 'Could not import the definitions. Try again.';
			}
		};
	};
</script>

<!-- Import in two steps: Check asks the engine for its plan and shows it, and
     Import runs that plan. Editing the file or the source after a check throws
     the plan away, so what runs is what was read. -->
<Drawer bind:open={importOpen} title="Import content types">
	<form
		method="POST"
		action="?/import"
		id="schema-import-form"
		enctype="multipart/form-data"
		use:enhance={submitImport}
		bind:this={importForm}
		class="flex flex-col gap-4"
	>
		<FormErrors message={importError || undefined} />
		<input type="hidden" name="apply" value={importApply ? 'true' : 'false'} />
		<Select
			id="import-source"
			name="source"
			label="Where the definitions come from"
			options={IMPORT_SOURCES.map((o) => ({ value: o.value, label: o.label }))}
			value={importSource}
			onvaluechange={(v) => {
				importSource = v;
				importEdited();
			}}
		/>
		<FileInput
			id="import-file"
			name="file"
			label="Definition file"
			accept=".json,.yaml,.yml,application/json,application/yaml"
			hint="Up to 4 MB. A LyEve export is YAML or JSON. For another system, use the file it exports."
			onchange={(files) => {
				importFileName = files?.[0]?.name ?? '';
				importEdited();
			}}
		/>
		<Textarea
			id="import-text"
			name="text"
			label="Or paste the definitions"
			rows={8}
			bind:value={importText}
			oninput={importEdited}
			placeholder={'schemas:\n  - name: articles\n    fields: []'}
			mono
		/>
		{#if importPlan}
			<div class="flex flex-col gap-3" data-testid="import-plan">
				<SectionHeading level={3}>What importing does</SectionHeading>
				{#if importChanges === 0}
					<p class="text-sm text-muted">Every content type in the file already matches. Importing changes nothing.</p>
				{/if}
				{#if importBlocked.length > 0}
					<Alert tone="danger" title="Some content types point at ones that are not here">
						{#snippet children()}
							{importBlocked.join(', ')} {importBlocked.length === 1 ? 'depends' : 'depend'} on a content type that is in neither the file nor this instance. Add it to the file, or create it first.
						{/snippet}
					</Alert>
				{/if}
				<ul class="flex flex-col gap-2">
					{#each importPlan.schemas as p (p.name)}
						<li>
							<Panel pad="sm">
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-mono text-sm text-fg">{p.name}</span>
									<Badge tone={p.action === 'create' ? 'success' : p.action === 'update' ? 'warn' : 'neutral'}>
										{p.action === 'create' ? 'Creates' : p.action === 'update' ? 'Changes' : 'Unchanged'}
									</Badge>
									{#if p.missing?.length}
										<span class="text-xs text-danger">needs {p.missing.join(', ')}</span>
									{/if}
								</div>
								{#if p.ddl?.length}
									<Collapsible label={`${p.ddl.length} ${p.ddl.length === 1 ? 'statement' : 'statements'}`} class="mt-2">
										<pre class="mt-1 overflow-x-auto rounded bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap text-fg">{p.ddl.join('\n\n')}</pre>
									</Collapsible>
								{/if}
							</Panel>
						</li>
					{/each}
				</ul>
				{#if importRenames.length > 0}
					<div>
						<p class="mb-1 text-xs text-muted">Renamed to fit the naming rules</p>
						<ul class="space-y-0.5 text-xs text-muted">
							{#each importRenames as r (r.key)}
								<li><span class="font-mono">{r.from}</span> to <span class="font-mono">{r.to}</span></li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if importNotes.length > 0}
					<div>
						<p class="mb-1 text-xs text-muted">Read before importing</p>
						<ul class="space-y-0.5 text-xs text-muted">
							{#each importNotes as n, i (i)}
								<li><span class="font-mono">{n.schema}{n.field ? `.${n.field}` : ''}</span>: {n.message}</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/if}
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (importOpen = false)}>Cancel</Button>
		{#if importPlan && importChanges > 0 && importBlocked.length === 0}
			<Button variant="primary" loading={importing && importApply} onclick={() => runImport(true)}>Import</Button>
		{:else}
			<Button
				variant="primary"
				loading={importing && !importApply}
				disabled={!importText.trim() && !importFileName}
				onclick={() => runImport(false)}
			>
				Check
			</Button>
		{/if}
	{/snippet}
</Drawer>
