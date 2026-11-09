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
		Stat,
		Table,
		Textarea,
		Toggle,
	} from '@lyeve-labs/ui-kit';
	import RefreshButton from '$lib/components/RefreshButton.svelte';
	import { enhance } from '$app/forms';
	import { Copy, Pencil, Plus, Search, ShieldCheck, Trash2 } from '@lucide/svelte';
	import { duplicateRow } from '$lib/duplicate';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import PiiTabs from '$lib/components/PiiTabs.svelte';
	import {
		inApplyOrder,
		overriddenPresets,
		shortPattern,
		type CustomRule,
	} from '$lib/api/pii-mask';
	import { plural } from '$lib/format';
	import { confirmed } from '$lib/forms.svelte';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const rules = $derived(inApplyOrder(data.rules?.presets ?? []));
	const custom = $derived(data.rules?.custom ?? []);
	const overridden = $derived(overriddenPresets(custom));
	const enabledCount = $derived(custom.filter((r) => r.enabled).length);
	const maxEnabled = $derived(data.rules?.limits?.max_enabled_rules ?? 50);
	const tags = $derived(Object.entries(data.rules?.mask_tags ?? {}));

	// The rule being written. A new one starts disabled: a pattern saved
	// straight into the masking path is a change to every response, and it is
	// the one thing an operator cannot undo by reading the page.
	const BLANK = {
		id: '',
		name: '',
		description: '',
		pattern: '',
		replacement: '[redacted]',
		priority: 100,
		enabled: false,
	};
	let editing = $state({ ...BLANK });
	let open = $state(false);
	let sample = $state('');

	// Every form on this page reports through one result, so each failure is
	// tagged with its action and shown only where that action was made: a
	// save in the rule form, a dry run under it, a delete on the page. A
	// drawer opened after any result starts clean, so the result is set aside.
	let setAside = $state<unknown>(null);
	const current = $derived(form && form !== setAside ? (form as { action?: string; error?: string; test?: unknown }) : null);
	const testResult = $derived(current?.test ?? null);
	const failedAs = (actions: string[]) => (current?.action && actions.includes(current.action) ? (current.error ?? '') : '');
	const saveError = $derived(failedAs(['create', 'update']));
	const testError = $derived(failedAs(['test']));
	const rowError = $derived(failedAs(['delete']));

	function newRule() {
		editing = { ...BLANK };
		sample = '';
		setAside = form;
		open = true;
	}

	function edit(rule: CustomRule) {
		editing = {
			id: rule.id,
			name: rule.name,
			description: rule.description ?? '',
			pattern: rule.pattern,
			replacement: rule.replacement,
			priority: rule.priority,
			enabled: rule.enabled,
		};
		sample = '';
		setAside = form;
		open = true;
	}

	// The number input binds a string, and an empty box must not read as zero:
	// zero would run the rule ahead of every preset, which is the opposite of
	// what leaving a field blank means. The server applies the same default.
	let priorityText = $state('100');
	$effect(() => {
		priorityText = String(editing.priority ?? 100);
	});

	/**
	 * Copy a rule into the create drawer.
	 *
	 * The copy arrives switched off, which matters more here than anywhere
	 * else: a redaction rule that starts masking the moment it saves changes
	 * every response, and the operator pressed Duplicate because they are
	 * about to change the pattern.
	 */
	function duplicate(rule: CustomRule) {
		const draft = duplicateRow(rule as unknown as Record<string, unknown>, {
			taken: custom.map((r) => r.name),
		});
		editing = {
			id: '',
			name: String(draft.name ?? rule.name),
			description: rule.description ?? '',
			pattern: rule.pattern,
			replacement: rule.replacement,
			priority: rule.priority,
			enabled: false,
		};
		sample = '';
		setAside = form;
		open = true;
	}

	const deleteRule = (rule: CustomRule) =>
		confirmed(`Delete rule ${rule.name}?`, 'Values it masks appear unmasked from the next request.', {
			confirmLabel: 'Delete',
		});
</script>

<PageShell
	title="PII masking"
	description="Choose what is masked in responses and logs."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#snippet actions()}
		<RefreshButton />
		<!-- Optional, because a page can be rendered before its load has run and
		     a header that dereferences the gate takes the whole page down. -->
		{#if data.gate?.state === 'ok'}
			<Button variant="primary" size="sm" onclick={newRule}>
				<Plus size={ICON.sm} /> New rule
			</Button>
		{/if}
	{/snippet}

	<PiiTabs active="rules" />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="PII masking"
			absent="PII masking is not included in this build. Responses are not masked."
		/>
	{:else}
		{#if rowError}
			<Alert tone="danger">{rowError}</Alert>
		{/if}
		{#if form && 'saved' in form && form.saved}
			<Alert tone="success" autoDismiss>Rule saved. It applies from the next request.</Alert>
		{/if}
		{#if form && 'deleted' in form && form.deleted}
			<Alert tone="success" autoDismiss>Rule deleted.</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-3">
			<!-- What is running, which is the presets this tenant has not
			     replaced plus its own enabled rules. The presets alone are not
			     what masks a value. -->
			<Stat
				size="sm"
				mono
				label="Rules applied"
				value={rules.filter((r) => !overridden.has(r.name.toUpperCase())).length + enabledCount}
			/>
			<Stat size="sm" mono label="Your own rules" value={`${enabledCount} of ${maxEnabled}`} />
			<Stat size="sm" mono label="Mask styles" value={tags.length} />
		</div>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Your own rules</SectionHeading>
			<p class="text-xs text-muted">
				Add patterns for this tenant in RE2, the regular expression syntax Go uses. RE2 does not backtrack, so a pattern cannot slow a response down without limit. It has no backreferences and no lookahead. Give a rule a preset's name to replace that preset, which is how you narrow one or turn it off. Each enabled rule is another pass over every response body, so twenty rules make masking about half as fast.
			</p>

			{#if custom.length === 0}
				<EmptyState
					title="No rules of your own"
					description="The presets below still apply. Add a pattern for identifiers only you use, such as an account or order number."
				>
					{#snippet iconSnippet()}
						<ShieldCheck size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Your own rules">
					<thead>
						<tr>
							<th scope="col">Order</th>
							<th scope="col">Rule</th>
							<th scope="col">Matches</th>
							<th scope="col">Replaced with</th>
							<th scope="col">State</th>
							<th scope="col" class="text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each custom as rule (rule.id)}
							<tr>
								<td data-cell="nowrap" class="text-xs text-faint">{rule.priority}</td>
								<td data-cell="nowrap">
									{rule.name}
									{#if rule.description}
										<div class="text-xs text-faint">{rule.description}</div>
									{/if}
								</td>
								<td class="font-mono text-xs" title={rule.pattern}>{shortPattern(rule.pattern)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{rule.replacement}</td>
								<td data-cell="nowrap">
									{#if rule.enabled}
										<Badge tone="success">Masking</Badge>
									{:else}
										<Badge tone="neutral">Off</Badge>
									{/if}
								</td>
								<td data-cell="nowrap" class="text-right">
									<Button variant="ghost" size="sm" aria-label={`Edit ${rule.name}`} onclick={() => edit(rule)}>
										<Pencil size={ICON.sm} />
									</Button>
									<Button variant="ghost" size="sm" aria-label={`Duplicate ${rule.name}`} onclick={() => duplicate(rule)}>
										<Copy size={ICON.sm} />
									</Button>
									<form method="POST" action="?/delete" use:enhance={deleteRule(rule)} class="inline-block">
										<input type="hidden" name="id" value={rule.id} />
										<Button variant="ghost" size="sm" type="submit" aria-label={`Delete ${rule.name}`}>
											<Trash2 size={ICON.sm} class="text-danger" />
										</Button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Presets, in the order they run</SectionHeading>
			<p class="text-xs text-muted">
				Priority decides which rule wins when two patterns match the same text. Lower runs first. Presets come with the plugin and cannot be edited, so a mistake in one of your own rules cannot break email masking for everyone. Create a rule with a preset's name to replace that preset.
			</p>

			{#if rules.length === 0}
				<EmptyState
					title="No rules loaded"
					description="No rule is loaded, so responses are not masked. Reload the page to try again."
				>
					{#snippet iconSnippet()}
						<ShieldCheck size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Rules, in the order they run">
					<thead>
						<tr>
							<th scope="col">Order</th>
							<th scope="col">Rule</th>
							<th scope="col">Matches</th>
							<th scope="col">Replaced with</th>
						</tr>
					</thead>
					<tbody>
						{#each rules as rule (rule.name)}
							{@const replaced = overridden.has(rule.name.toUpperCase())}
							<tr class={replaced ? 'opacity-60' : ''}>
								<td data-cell="nowrap" class="text-xs text-faint">{rule.priority}</td>
								<td data-cell="nowrap">
									{rule.name}
									{#if replaced}
										<Badge tone="neutral">replaced by yours</Badge>
									{/if}
									{#if rule.description}
										<div class="text-xs text-faint">{rule.description}</div>
									{/if}
								</td>
								<td class="font-mono text-xs" title={rule.pattern}
									>{shortPattern(rule.pattern)}</td
								>
								<td data-cell="nowrap" class="font-mono text-xs">{rule.replacement}</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}

			{#if tags.length > 0}
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-xs text-muted">Mask styles a field can ask for</span>
					{#each tags as [tag, meaning] (tag)}
						<Badge tone="neutral">{tag}</Badge>
						<span class="text-xs text-faint">{meaning}</span>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</PageShell>

<!--
	The rule being written, and a place to find out what it does before it runs.

	A redaction rule is invisible when it is right and silent when it is wrong,
	so a pattern saved without trying it is a guess about every future response.
	The sample box runs the pattern server-side through the same validation the
	save uses and stores nothing, which is what makes this safe to press
	repeatedly while a pattern is being worked out.
-->
<Drawer bind:open title={editing.id ? `Edit ${editing.name}` : 'New rule'}>
	<form
		id="pii-rule-form"
		method="POST"
		action={editing.id ? '?/update' : '?/create'}
		use:enhance={() => async ({ result, update }) => {
			await update({ reset: false });
			// A refused save keeps the drawer open, with the reason at the top
			// of the form and the rule as it was typed.
			if (result.type === 'success' || result.type === 'redirect') open = false;
		}}
		class="flex flex-col gap-4"
	>
		<FormErrors message={saveError || undefined} />
		{#if editing.id}
			<input type="hidden" name="id" value={editing.id} />
		{/if}

		<Input
			id="rule-name"
			name="name"
			label="Name"
			required
			hint="How a masked value is labeled in the access log. Use a preset's name to replace that preset."
			bind:value={editing.name}
		/>
		<Input
			id="rule-description"
			name="description"
			label="Description"
			hint="What it matches, for whoever reads this next."
			bind:value={editing.description}
		/>
		<Input
			id="rule-pattern"
			name="pattern"
			label="Pattern"
			required
			hint="RE2 syntax. No backreferences and no lookahead."
			bind:value={editing.pattern}
		/>
		<Input
			id="rule-replacement"
			name="replacement"
			label="Replaced with"
			required
			bind:value={editing.replacement}
		/>
		<Input
			id="rule-priority"
			name="priority"
			label="Priority"
			type="number"
			hint={editing.id
				? 'Lower runs first. The presets run between 5 and 50, so 100 puts yours after all of them, and 0 before them.'
				: 'Lower runs first. The presets run between 5 and 50, so 100 puts yours after all of them. A new rule needs 1 or more. Edit it later to set 0.'}
			bind:value={priorityText}
		/>
		<!-- The kit's Toggle is a button and serializes nothing, so the value
		     the form submits is a field of its own. -->
		<input type="hidden" name="enabled" value={editing.enabled ? 'true' : 'false'} />
		<Toggle
			id="rule-enabled"
			label="Masking"
			hint="A new rule starts off. Turning it on changes every response from the next request."
			bind:checked={editing.enabled}
		/>
	</form>

	<div class="mt-6 flex flex-col gap-3 border-t border-line pt-4">
		<SectionHeading level={3}>Try it</SectionHeading>
		<p class="text-xs text-muted">
			Paste something the pattern should hide. Nothing here is stored.
		</p>
		<form method="POST" action="?/test" use:enhance class="flex flex-col gap-3">
			<input type="hidden" name="pattern" value={editing.pattern} />
			<input type="hidden" name="replacement" value={editing.replacement} />
			<Textarea
				id="rule-sample"
				name="sample"
				label="Sample"
				rows={3}
				bind:value={sample}
			/>
			<div>
				<Button variant="secondary" size="sm" type="submit">
					<Search size={ICON.sm} /> Run it
				</Button>
			</div>
		</form>

		{#if testError}
			<Alert tone="danger">{testError}</Alert>
		{:else if testResult}
			{@const result = testResult as
				| { valid: false; error: string }
				| { valid: true; matches: string[]; count: number; masked: string }}
			{#if !result.valid}
				<Alert tone="danger">{result.error}</Alert>
			{:else if result.count === 0}
				<!-- The commonest way a rule is wrong. It saves, it enables, and
				     it hides nothing, and no other screen would ever say so. -->
				<Alert tone="warn">
					The pattern matched nothing in this sample, so it would mask nothing.
				</Alert>
			{:else}
				<Alert tone="success">
					{result.count}
					{plural(result.count, 'match', 'matches')}.
				</Alert>
				<div class="flex flex-col gap-1">
					<span class="text-xs text-muted">What a reader would get</span>
					<pre
						class="overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs text-fg">{result.masked}</pre>
				</div>
			{/if}
		{/if}
	</div>

	<!-- A snippet is a prop of the drawer only as its direct child, so the
	     footer sits here and names the rule form it submits. -->
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="pii-rule-form">{editing.id ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>
