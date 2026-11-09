<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		SectionHeading,
		Table,
		Toggle,
		toast,
	} from '@lyeve-labs/ui-kit';
	import CacheTabs from '$lib/components/CacheTabs.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { enhance } from '$app/forms';
	import { confirmed, tracked } from '$lib/forms.svelte';
	import { atLimit } from '$lib/api/limits';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Eraser, Pencil, Plus, Route, Trash2 } from '@lucide/svelte';
	import { ruleCount, ttlLabel, type CacheRule } from '$lib/api/cache';
	import { plural } from '$lib/format';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const formError = $derived((form as { error?: string } | null)?.error ?? '');
	const refusal = $derived(formRefusal(form));
	// A failed save names the drawer it came from, so it is said inside that
	// drawer and nowhere else. Every other failure is the page's.
	const fromDrawer = $derived(
		form && 'drawer' in form && typeof form.drawer === 'string' ? form.drawer : null,
	);
	const rules = $derived(data.rules);
	const ruleTags = $derived([...new Set(rules.rows.flatMap((r) => r.tags))].sort());
	const rulesFull = $derived(rules.licensed !== true && atLimit(rules.limit));

	let ruleOpen = $state(false);
	let editing = $state<CacheRule | null>(null);
	let pattern = $state('/api/v1/content/{schema}');
	let ttl = $state('300');
	let ruleTagText = $state('');
	let ruleEnabled = $state(true);
	let purgeTag = $state('');

	function openCreate() {
		editing = null;
		pattern = '/api/v1/content/{schema}';
		ttl = '300';
		ruleTagText = '';
		ruleEnabled = true;
		ruleOpen = true;
	}

	function openEdit(r: CacheRule) {
		editing = r;
		pattern = r.pattern;
		ttl = String(r.ttl_seconds);
		ruleTagText = r.tags.join(', ');
		ruleEnabled = r.enabled;
		ruleOpen = true;
	}

	const saveRule = tracked(() => {
		const verb = editing ? 'saved' : 'created';
		const subject = pattern;
		return async ({ result, update }) => {
			if (result.type !== 'failure') ruleOpen = false;
			await update();
			if (result.type === 'success') toast.success(`Rule for ${subject} ${verb}.`);
		};
	});

	function removeRule(r: CacheRule): SubmitFunction {
		return confirmed(
			`Delete the rule for ${r.pattern}?`,
			'Its cached responses are removed, and the route is served without the cache from the next request.',
			{ confirmLabel: 'Delete', success: `Rule for ${r.pattern} deleted.` },
		);
	}

	/**
	 * A purge evicts this tenant's cached responses. Every one is recomputed on
	 * its next request, so the confirm says what it puts on the database.
	 */
	function purge(what: string): SubmitFunction {
		return confirmed(
			`Purge ${what}?`,
			'Each purged response is computed again on its next request.',
			{
				confirmLabel: 'Purge',
				success: (data) => {
					const n = (data as { purged?: number } | undefined)?.purged ?? 0;
					return `${n} ${plural(n, 'response')} purged.`;
				},
			},
		);
	}
</script>

<PageShell
	title="Cache"
	documentTitle="Response cache rules - Cache"
	description="Choose which public routes are answered from the cache, and purge what they stored."
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	{#snippet actions()}
		{#if data.gate.state === 'ok' && rules.gate.state === 'ok'}
			<!-- At the ceiling a create can only be refused, so the button waits
			     and the warning beside the rules says why. -->
			<Button
				variant="primary"
				size="sm"
				onclick={openCreate}
				disabled={rulesFull}
				aria-describedby={rulesFull ? 'rules-full' : undefined}
			>
				<Plus size={ICON.sm} /> New rule
			</Button>
		{/if}
	{/snippet}

	<CacheTabs active="rules" rules={rules.gate.state === 'ok' ? rules.rows.length : undefined} />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Cache"
			absent="The cache is not included in this build."
		/>
	{:else}
		<FormErrors message={fromDrawer ? undefined : formError} refused={fromDrawer ? null : refusal} />

		<section class="flex flex-col gap-4" aria-label="Response cache rules">
			<div class="flex flex-wrap items-center gap-2">
				<SectionHeading level={2}>Response cache rules</SectionHeading>
				{#if rules.gate.state === 'ok'}
					<Badge tone={rulesFull ? 'warn' : 'neutral'}>{ruleCount(rules.limit, rules.rows.length)}</Badge>
				{/if}
			</div>
			<p class="text-sm text-muted">
				A rule serves one of this tenant's public read routes from the cache for its time to live. When
				content changes, responses from rules tagged with its content type are purged. A rule with no tags
				is purged by every content change.
			</p>
			{#if rules.gate.state !== 'ok'}
				<GateNotice
					gate={rules.gate}
					title="Response cache rules"
					absent="Response cache rules need a newer version of the cache plugin."
				/>
			{:else}
				{#if rulesFull}
					<div id="rules-full">
						<Alert tone="warn" title="All available rules are in use">
							{rules.limit?.current} of {rules.limit?.limit} rules are in use. Delete one to add another, or
							change the license to allow more. Existing rules keep serving either way.
						</Alert>
					</div>
				{/if}

				<div class="flex flex-wrap items-end gap-2">
					<form method="POST" action="?/purge" use:enhance={purge('every cached response of this tenant')}>
						<Button variant="secondary" size="sm" type="submit">
							<Eraser size={ICON.sm} /> Purge all
						</Button>
					</form>
					<form
						method="POST"
						action="?/purge"
						class="flex items-end gap-2"
						use:enhance={purge(`the responses tagged ${purgeTag || 'with this tag'}`)}
					>
						<Input id="purge-tag" name="tag" label="Purge by tag" placeholder="posts" bind:value={purgeTag} />
						<Button variant="secondary" size="sm" type="submit" disabled={!purgeTag.trim()}>Purge tag</Button>
					</form>
					{#if ruleTags.length > 0}
						<p class="text-xs text-faint">Tags in use: {ruleTags.join(', ')}</p>
					{/if}
				</div>

				{#if rules.rows.length === 0}
					<EmptyState
						title="No response cache rules yet"
						description="Create a rule to serve a public read route from the cache. Until then, every public read is computed on each request."
					>
						{#snippet iconSnippet()}
							<Route size={ICON.lg} />
						{/snippet}
						{#snippet action()}
							<Button variant="secondary" onclick={openCreate}>
								<Plus size={ICON.sm} /> New rule
							</Button>
						{/snippet}
					</EmptyState>
				{:else}
					<Table label="Response cache rules">
						<thead>
							<tr>
								<th scope="col">Route</th>
								<th scope="col">Time to live</th>
								<th scope="col">Tags</th>
								<th scope="col">State</th>
								<th scope="col"><span class="sr-only">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{#each rules.rows as r (r.id)}
								<tr>
									<td class="max-w-md truncate font-mono text-xs" title={r.pattern}>{r.pattern}</td>
									<td data-cell="nowrap" class="font-mono text-xs">{ttlLabel(r.ttl_seconds)}</td>
									<td class="text-xs text-faint">{r.tags.join(', ') || 'Every content change'}</td>
									<td data-cell="nowrap">
										<Badge tone={r.enabled ? 'success' : 'neutral'} dot>{r.enabled ? 'Serving' : 'Off'}</Badge>
									</td>
									<td data-cell="nowrap">
										<div class="flex items-center justify-end gap-1">
											<form method="POST" action="?/purge" use:enhance={purge(`what ${r.pattern} cached`)}>
												<input type="hidden" name="rule" value={r.id} />
												<Button variant="ghost" size="sm" type="submit" aria-label="Purge {r.pattern}" title="Purge">
													<Eraser size={ICON.sm} />
												</Button>
											</form>
											<Button variant="ghost" size="sm" aria-label="Edit {r.pattern}" onclick={() => openEdit(r)}>
												<Pencil size={ICON.sm} />
											</Button>
											<form method="POST" action="?/deleteRule" use:enhance={removeRule(r)}>
												<input type="hidden" name="id" value={r.id} />
												<Button variant="ghost" size="sm" type="submit" aria-label="Delete {r.pattern}">
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
			{/if}
		</section>
	{/if}
</PageShell>

<Drawer bind:open={ruleOpen} title={editing ? 'Edit rule' : 'New rule'}>
	<form id="cache-rule-form" method="POST" action={editing ? '?/updateRule' : '?/createRule'} use:enhance={saveRule.enhance}>
		<FormErrors
			message={fromDrawer === 'rule' ? formError || undefined : undefined}
			refused={fromDrawer === 'rule' ? refusal : null}
		/>
		{#if editing}
			<input type="hidden" name="id" value={editing.id} />
		{/if}
		<div class="flex flex-col gap-4">
			<Input
				id="rule-pattern"
				name="pattern"
				label="Route"
				hint="A path under /api/v1/. A segment can be a glob such as post-* or a {'{name}'} for any one segment. ** can only come last."
				bind:value={pattern}
				required
			/>
			<Input
				id="rule-ttl"
				name="ttl_seconds"
				label="Time to live, in seconds"
				hint="How long a cached response is served before it is computed again."
				bind:value={ttl}
				required
			/>
			<Input
				id="rule-tags"
				name="tags"
				label="Tags"
				hint="Content types whose changes purge this rule, separated by commas. Leave empty to purge on every content change."
				bind:value={ruleTagText}
			/>
			<input type="hidden" name="enabled" value={ruleEnabled ? 'true' : 'false'} />
			<Toggle id="rule-enabled" label="Serve from the cache" bind:checked={ruleEnabled} />
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (ruleOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="cache-rule-form" loading={saveRule.pending}>
			{editing ? 'Save' : 'Create'}
		</Button>
	{/snippet}
</Drawer>
