<script lang="ts">
	import { tracked } from '$lib/forms.svelte';
	import { crumbsAfter } from '$lib/breadcrumb';
	import { Alert, Badge, Breadcrumb, Button, Card, Collapsible, PageShell, SectionHeading, Table, Textarea } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { History } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';
	import AiSection from '$lib/components/ai/AiSection.svelte';
	import { useCaseLabel } from '$lib/components/ai/use-case';
	import { formatDateTime, plural } from '$lib/format';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const back = { href: '/admin/ai/prompts', label: 'Prompts' };
	const p = $derived(data.prompt);
	// The editor starts from the text in force and is re-seeded when a new
	// version comes into force, after a save or a restore, even one whose text
	// matches the old. The version and the text are read through derived
	// values of their own, so a reload that hands back the same version, as
	// the layout does when the AI switch is read again, leaves what the reader
	// typed.
	const active = $derived(p?.active ?? '');
	const activeVersion = $derived(p?.active_version ?? 0);
	let body = $state('');
	$effect(() => {
		void activeVersion;
		body = active;
	});
	const dirty = $derived(!!p && body.trim() !== '' && body !== p.active);
	const nextVersion = $derived(p ? Math.max(0, ...p.versions.map((v) => v.version)) + 1 : 1);

	const save = tracked(() => async ({ update }) => update({ reset: false }));
</script>

<PageShell title={p ? useCaseLabel(p.use_case) : 'Prompt'} description={p ? `The system prompt for ${p.use_case}.` : ''} width="wide" {back}>
	{#snippet breadcrumb()}
		<Breadcrumb items={crumbsAfter(back, [{ label: 'AI', href: '/admin/ai' }, { label: 'Prompts', href: '/admin/ai/prompts' }, { label: p ? useCaseLabel(p.use_case) : 'Prompt' }])} />
	{/snippet}

	<AiSection level={2} tab="prompts" gate={data.gate} layoutGate={data.aiLayoutGate} noun="prompts">
		{#if p}
			<div class="flex flex-wrap items-center gap-2">
				{#if p.active_version === 0}
					<Badge tone="neutral">Using the default prompt</Badge>
				{:else}
					<Badge tone="brand">Using version {p.active_version}</Badge>
				{/if}
				<span class="text-xs text-faint">{p.versions.length} saved {plural(p.versions.length, 'version')}</span>
			</div>

			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Edit</SectionHeading>
				<Card>
					{#key p.active_version}
						<form method="POST" action="?/save" use:enhance={save.enhance} class="flex flex-col gap-4">
							<Textarea
								id="prompt-body"
								name="body"
								label="System prompt"
								rows={10}
								bind:value={body}
								hint="Saving creates version {nextVersion}, and every request for this use case uses it from then on. The guardrail below is always added to the end and cannot be removed."
							/>
							{#if form?.scope === 'save' && form.error}
								<Alert tone="danger">{form.error}</Alert>
							{:else if form?.scope === 'save' && 'version' in form}
								<Alert tone="success" autoDismiss>Saved as version {form.version}.</Alert>
							{/if}
							<div class="flex justify-end">
								<Button variant="primary" type="submit" disabled={!dirty} loading={save.pending}>Save as version {nextVersion}</Button>
							</div>
						</form>
					{/key}
				</Card>
				<Collapsible label="Guardrail, always appended">
					<pre class="whitespace-pre-wrap rounded-md bg-surface-2 p-3 font-mono text-xs text-muted">{p.guardrail}</pre>
				</Collapsible>
			</section>

			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Versions</SectionHeading>
				{#if form?.scope === 'restore' && form.error}
					<Alert tone="danger">{form.error}</Alert>
				{:else if form?.scope === 'restore' && 'version' in form}
					<Alert tone="success" autoDismiss>Version {form.from} restored as version {form.version}.</Alert>
				{/if}
				<Table label="Versions">
					<thead>
						<tr>
							<th scope="col">Version</th>
							<th scope="col">Saved</th>
							<th scope="col">By</th>
							<th scope="col">Text</th>
							<th scope="col" class="text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each p.versions as v (v.id)}
							<tr>
								<td data-cell="nowrap" class="font-medium">
									v{v.version}
									{#if v.version === p.active_version}<Badge tone="brand" size="sm" class="ms-2">current</Badge>{/if}
								</td>
								<td data-cell="nowrap" class="text-muted">{formatDateTime(v.created_at)}</td>
								<td data-cell="nowrap" class="text-muted">{v.created_by || 'unknown'}</td>
								<td>
									<Collapsible label="Show">
										<pre class="whitespace-pre-wrap font-mono text-xs text-muted">{v.body}</pre>
									</Collapsible>
								</td>
								<td class="text-right">
									{#if v.version !== p.active_version}
										<form method="POST" action="?/restore" use:enhance class="inline">
											<input type="hidden" name="version" value={v.version} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Make version {v.version} current">
												<History size={ICON.sm} aria-hidden="true" />
											</Button>
										</form>
									{/if}
								</td>
							</tr>
						{/each}
						<tr>
							<td data-cell="nowrap" class="font-medium">
								v0
								{#if p.active_version === 0}<Badge tone="brand" size="sm" class="ms-2">current</Badge>{/if}
							</td>
							<td data-cell="nowrap" class="text-muted">shipped</td>
							<td data-cell="nowrap" class="text-muted">the plugin</td>
							<td>
								<Collapsible label="Show">
									<pre class="whitespace-pre-wrap font-mono text-xs text-muted">{p.default}</pre>
								</Collapsible>
							</td>
							<td class="text-right">
								{#if p.active_version !== 0}
									<form method="POST" action="?/restore" use:enhance class="inline">
										<input type="hidden" name="version" value="0" />
										<Button variant="ghost" size="sm" type="submit" aria-label="Make the shipped default current">
											<History size={ICON.sm} aria-hidden="true" />
										</Button>
									</form>
								{/if}
							</td>
						</tr>
					</tbody>
				</Table>
				<p class="text-xs text-faint">
					Restoring an older version saves a copy of its text as a new version. No version is ever deleted. The
					shipped default is version 0.
				</p>
			</section>
		{/if}
	</AiSection>
</PageShell>
