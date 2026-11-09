<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import type { EndpointDoc, EndpointParam } from '$lib/api/reference';
	import { VALUES_SHOWN } from '$lib/api/openapi';
	import { curlFor, gateSentence } from '$lib/api/request-preview';
	import { isWriteMethod, unfilledParameters, type TryResult } from '$lib/api/try-it';
	import { enhance } from '$app/forms';
	import { ChevronDown, ChevronRight, Download, Play } from '@lucide/svelte';
	import {
		Alert,
		Badge,
		Button,
		Card,
		Checkbox,
		CopyButton,
		EmptyState,
		Input,
		PageShell,
		SearchInput,
		SectionHeading,
		SegmentedControl,
		Table,
		Textarea,
		Collapsible,
		type AccentTone,
	} from '@lyeve-labs/ui-kit';
	import ResizableAside from '$lib/components/ResizableAside.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { ICON } from '$lib/icon';
	import { methodTone } from '$lib/tones';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Which endpoint the last run belonged to. Without it every expanded row
	// would show the same response, because the form result is one value for
	// the whole page.
	let triedKey = $state('');
	const tried = $derived((form as { tried?: TryResult } | null)?.tried ?? null);
	const tryError = $derived((form as { tryError?: string } | null)?.tryError ?? '');

	// The admin half is a super admin's. The engine refuses it to anyone
	// else, so for them there is nothing to switch to. The choice is in the
	// URL, so a link to either half is shareable.
	const HALVES = [
		{ value: 'public', label: 'Public API', href: '/admin/api-reference' },
		{ value: 'admin', label: 'Admin API', href: '/admin/api-reference?api=admin' },
	];

	let query = $state('');
	let expandedIds = $state(new Set<string>());
	// Parameters whose value list has been opened past the first few.
	let openedValues = $state(new Set<string>());

	function valuesKey(key: string, p: EndpointParam) {
		return `${key}::${p.in}::${p.name}`;
	}
	function toggleValues(id: string) {
		if (openedValues.has(id)) openedValues.delete(id);
		else openedValues.add(id);
		openedValues = new Set(openedValues);
	}
	function shownValues(p: EndpointParam, open: boolean): string[] {
		if (!p.values) return [];
		return open ? p.values : p.values.slice(0, VALUES_SHOWN);
	}

	let filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return data.groups;
		return data.groups
			.map((g) => ({
				...g,
				endpoints: g.endpoints.filter(
					(e) =>
						e.path.toLowerCase().includes(q) ||
						e.summary.toLowerCase().includes(q) ||
						e.method.toLowerCase().includes(q),
				),
			}))
			.filter((g) => g.endpoints.length > 0);
	});

	function endpointKey(groupId: string, e: EndpointDoc) {
		return `${groupId}::${e.method}::${e.path}`;
	}

	/**
	 * The id the disclosure points aria-controls at.
	 *
	 * The key is built from the path, so it carries slashes, colons and the
	 * braces of a path parameter. An id holding those is legal but reads badly
	 * in a tool that echoes it, so the value is reduced to one shape.
	 */
	function panelId(key: string): string {
		return `endpoint-${key.replace(/[^A-Za-z0-9]+/g, '-')}`;
	}

	function toggleExpand(id: string) {
		if (expandedIds.has(id)) {
			expandedIds.delete(id);
		} else {
			expandedIds.add(id);
		}
		expandedIds = new Set(expandedIds);
	}

	const authLabel: Record<string, string> = {
		none: 'Public',
		bearer: 'Bearer JWT',
		cookie: 'Session cookie',
		'bearer-or-cookie': 'Bearer or cookie',
	};
	const authTone: Record<string, AccentTone> = {
		none: 'neutral',
		bearer: 'brand',
		cookie: 'violet',
		'bearer-or-cookie': 'warn',
	};

	const serverTone: Record<string, AccentTone> = {
		admin: 'violet',
		api: 'success',
		both: 'neutral',
	};
	const serverLabel: Record<string, string> = {
		admin: 'Admin API',
		api: 'Content API',
		both: 'both servers',
	};

	/** The rail repeats the server name the section heading already carries. */
	function shortLabel(label: string) {
		// \u00b7 is the separator the group labels are built with.
		return label.replace(/^(?:Admin|API|Plugin)\s*\u00b7\s*/, '');
	}

	function scrollToGroup(id: string) {
		document.getElementById(`group-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	/**
	 * A route a plugin declared arrives with no summary of its own, and the
	 * document fills that with the method and path, which the row already
	 * shows. Showing it twice, truncated, says nothing.
	 */
	function hasSummary(ep: EndpointDoc): boolean {
		const echo = `${ep.method} ${ep.path}`;
		return !!ep.summary && ep.summary !== echo && ep.summary !== ep.path;
	}

	const isPlugin = (g: { label: string }) => /^Plugin\s*\u00b7/.test(g.label);
	let adminGroups = $derived(filtered.filter((g) => g.server === 'admin' && !isPlugin(g)));
	let pluginGroups = $derived(filtered.filter((g) => isPlugin(g)));
	let apiGroups = $derived(filtered.filter((g) => (g.server === 'api' || g.server === 'both') && !isPlugin(g)));
	// Plugin rows would fill most of the rail, so they open on demand.
	let pluginsOpen = $state(false);
</script>

<!-- What a row shows, rendered inside the disclosure button when there is
     something to disclose and in a plain container when there is not. The two
     differ only in what wraps them. -->
{#snippet endpointSummary(ep: EndpointDoc)}
	<Badge tone={methodTone(ep.method)} class="w-16 shrink-0 justify-center font-mono">
		{ep.method}
	</Badge>

	<!-- Below sm: the path takes a line of its own under the badges and breaks
	     where it must. Truncated to one line beside them, a phone shows a few
	     characters of the path, which name nothing. -->
	<span
		class="order-last min-w-0 basis-full font-mono text-sm text-fg [overflow-wrap:anywhere] sm:order-none sm:flex-1 sm:basis-auto sm:truncate"
	>
		{ep.path}
	</span>

	{#if hasSummary(ep)}
		<span class="hidden max-w-80 shrink-0 truncate text-sm text-faint sm:block">
			{ep.summary}
		</span>
	{/if}

	<span class="shrink-0">
		<Badge tone={authTone[ep.auth]}>{authLabel[ep.auth]}</Badge>
	</span>
{/snippet}

<PageShell
	title="API reference"
	description={data.source === 'engine'
		? `Browse ${data.half === 'admin' ? 'the /api/admin routes, for super admins' : 'the content API, auth and every route outside /api/admin'}, from the engine's OpenAPI document${data.collections ? `, including ${data.collections} collections in the content API` : ''}.`
		: data.half === 'admin'
			? 'Browse the /api/admin routes, for super admins.'
			: 'Browse the content API, auth and every route outside /api/admin.'}
	fill
>
	{#snippet actions()}
		<Button
			href={data.specHref}
			variant="outline"
			size="sm"
			target="_blank"
			rel="noopener"
			title="Download the OpenAPI 3.1 JSON spec"
		>
			<Download size={ICON.sm} /> OpenAPI spec
		</Button>
	{/snippet}

	<div class="flex min-h-0 flex-1 overflow-hidden">
		{#snippet groupLinks(groups: typeof filtered)}
			{#each groups as g (g.id)}
				<button
					onclick={() => scrollToGroup(g.id)}
					class="w-full px-4 py-2 coarse:min-h-control text-left text-sm text-muted transition-colors hover:bg-surface-2/40 hover:text-fg"
				>
					{shortLabel(g.label)}
				</button>
			{/each}
		{/snippet}

		<ResizableAside storageKey="lyeve-api-reference-nav" label="Endpoints" side="start" width={288} min={200} max={480} breakpoint="lg" below="hidden" collapsible testId="api-reference-nav">
			{#if adminGroups.length > 0}
				<div class="px-4 pt-4 pb-1">
					<p class="text-xs font-semibold tracking-widest text-faint uppercase">Admin API</p>
				</div>
				{@render groupLinks(adminGroups)}
			{/if}

			{#if pluginGroups.length > 0}
				<button
					type="button"
					class="flex w-full items-center justify-between px-4 pt-4 pb-1 coarse:min-h-control text-left"
					onclick={() => (pluginsOpen = !pluginsOpen)}
					aria-expanded={pluginsOpen}
				>
					<span class="text-xs font-semibold tracking-widest text-faint uppercase">
						Plugins <span class="font-normal tracking-normal normal-case">({pluginGroups.length})</span>
					</span>
					<span class="text-faint">
						{#if pluginsOpen}<ChevronDown size={ICON.xs} />{:else}<ChevronRight size={ICON.xs} />{/if}
					</span>
				</button>
				{#if pluginsOpen}
					{@render groupLinks(pluginGroups)}
				{/if}
			{/if}

			{#if apiGroups.length > 0}
				<div class="px-4 pt-4 pb-1">
					<p class="text-xs font-semibold tracking-widest text-faint uppercase">Content API</p>
				</div>
				{@render groupLinks(apiGroups)}
			{/if}
		</ResizableAside>

		<div class="min-h-0 flex-1 overflow-y-auto">
			<div class="max-w-7xl space-y-10 px-6 py-6">
				<!-- The search and the document switch narrow the list, so they sit
				     on the list's own row rather than in the page header. -->
				<ListToolbar label="Filter endpoints">
					{#snippet search()}
						<!-- The label is for a screen reader only. A placeholder is no
						     name, because it leaves as soon as the box is typed into. -->
						<label for="endpoint-search" class="sr-only">Search endpoints</label>
						<SearchInput id="endpoint-search" bind:value={query} placeholder="Search endpoints" />
					{/snippet}
					{#snippet filters()}
						{#if data.canSeeAdmin}
							<SegmentedControl label="Document" labelHidden value={data.half} options={HALVES} />
						{/if}
					{/snippet}
				</ListToolbar>

				{#if data.source === 'catalog'}
					<Alert tone="warn" title="Showing the built-in catalog">
						Could not load the engine's API document, so this is the catalog built into the console.
						Reload the page to try again.
					</Alert>
				{/if}

				{#each filtered as group (group.id)}
					<section id="group-{group.id}">
						<SectionHeading level={2}>
							{group.label}
							{#snippet actions()}
								<Badge tone={serverTone[group.server]} class="font-mono">
									{serverLabel[group.server]}
								</Badge>
							{/snippet}
						</SectionHeading>
						<p class="mt-1 mb-4 text-sm text-faint">{group.description}</p>

						<div class="space-y-2">
							{#each group.endpoints as ep (endpointKey(group.id, ep))}
								{@const key = endpointKey(group.id, ep)}
								{@const expanded = expandedIds.has(key)}
								{@const hasDetails = true}

								<Card pad="none">
									<!-- The row is a plain container. One control inside another is a
									     single tab stop for two things to press, and a screen reader
									     announces the outer one with no way to reach the inner. The
									     disclosure is a button beside the copy button, so each is
									     reached and pressed on its own. -->
									<div
										class="flex w-full items-center gap-3 px-4 py-3
											{hasDetails ? 'transition-colors hover:bg-surface-2/30' : ''}"
									>
										{#if hasDetails}
											<button
												type="button"
												onclick={() => toggleExpand(key)}
												aria-expanded={expanded}
												aria-controls={expanded ? panelId(key) : undefined}
												class="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-left coarse:min-h-control"
											>
												{@render endpointSummary(ep)}

												<span class="shrink-0 text-faint">
													{#if expanded}
														<ChevronDown size={ICON.sm} />
													{:else}
														<ChevronRight size={ICON.sm} />
													{/if}
												</span>
											</button>
										{:else}
											<div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
												{@render endpointSummary(ep)}
											</div>
										{/if}

										<CopyButton
											value={ep.path}
											label="Copy the path {ep.path}"
											title="Copy the path {ep.path}"
											size={ICON.sm}
											class="shrink-0"
										/>
									</div>

									{#if expanded}
										{@const preview = curlFor(ep)}
										<!-- aria-controls names this only while it exists. The panel is
										     rendered rather than hidden, so a collapsed row naming it would
										     point at an element that is not on the page. -->
										<div id={panelId(key)} class="space-y-4 border-t border-line px-4 py-4">
											{#if ep.description}
												<p class="text-sm text-muted">{ep.description}</p>
											{/if}

											<div>
												<p class="mb-1.5 text-xs font-medium text-faint">Gate</p>
												<p class="text-sm text-muted">{gateSentence(ep)}</p>
											</div>

											{@render tryIt(ep, key)}

											{#if ep.roles?.length}
												<div>
													<p class="mb-1.5 text-xs font-medium text-faint">Required roles</p>
													<div class="flex flex-wrap gap-1.5">
														{#each ep.roles as role (role)}
															<Badge tone="violet" class="font-mono">{role}</Badge>
														{/each}
													</div>
												</div>
											{/if}

											{#if ep.params?.length}
												<div>
													<p class="mb-2 text-xs font-medium text-faint">Parameters</p>
													<Table label="API reference">
														<thead>
															<tr>
																<th scope="col">Name</th>
																<th scope="col">In</th>
																<th scope="col">Type</th>
																<th scope="col">Required</th>
																<th scope="col">Description</th>
															</tr>
														</thead>
														<tbody>
															{#each ep.params as param (`${param.in}:${param.name}`)}
																<tr>
																	<td data-cell="nowrap" class="font-mono">{param.name}</td>
																	<td data-cell="nowrap" class="text-faint">{param.in}</td>
																	<td data-cell="nowrap" class="font-mono text-faint">{param.type}</td>
																	<td data-cell="nowrap">
																		{#if param.required}
																			<span class="text-danger">yes</span>
																		{:else}
																			<span class="text-faint">no</span>
																		{/if}
																	</td>
																	<td class="text-muted">
																		{param.description}
																		{#if param.values?.length}
																			{@const vk = valuesKey(key, param)}
																			{@const open = openedValues.has(vk)}
																			<span class="mt-1 flex flex-wrap items-center gap-1">
																				{#each shownValues(param, open) as v}
																					<code class="rounded bg-surface-2 px-1 font-mono text-xs text-fg">{v}</code>
																				{/each}
																				{#if param.values.length > VALUES_SHOWN}
																					<button
																						type="button"
																						class="text-xs text-brand hover:underline"
																						onclick={() => toggleValues(vk)}
																						aria-expanded={open}
																					>
																						{open ? 'Show fewer' : `and ${param.values.length - VALUES_SHOWN} more`}
																					</button>
																				{/if}
																			</span>
																		{/if}
																	</td>
																</tr>
															{/each}
														</tbody>
													</Table>
												</div>
											{/if}

											{#if ep.requestBody}
												<div>
													<p class="mb-1.5 text-xs font-medium text-faint">
														Request body
														{#if ep.requestBody.description}
															<span class="font-normal text-faint">
																- {ep.requestBody.description}</span
															>
														{/if}
													</p>
													{#if ep.requestBody.example}
														<div class="group/code relative">
															<pre class="overflow-x-auto rounded-lg border border-line bg-ink p-3 font-mono text-xs leading-relaxed text-fg">{ep.requestBody.example}</pre>
															<CopyButton
																value={ep.requestBody.example}
																label="Copy the example request body for {ep.method} {ep.path}"
																title="Copy the example request body for {ep.method} {ep.path}"
																size={ICON.xs}
																class="absolute top-2 right-2 rounded bg-surface-2 opacity-0 transition-opacity group-hover/code:opacity-100 has-[:focus-visible]:opacity-100 pointer-coarse:opacity-100"
															/>
														</div>
													{/if}
												</div>
											{/if}

											{#if ep.response}
												<div>
													<p class="mb-1.5 text-xs font-medium text-faint">
														Response
														{#if ep.response.description}
															<span class="font-normal text-faint"> - {ep.response.description}</span>
														{/if}
													</p>
													{#if ep.response.example}
														<div class="group/code relative">
															<pre class="overflow-x-auto rounded-lg border border-line bg-ink p-3 font-mono text-xs leading-relaxed text-fg">{ep.response.example}</pre>
															<CopyButton
																value={ep.response.example}
																label="Copy the example response body for {ep.method} {ep.path}"
																title="Copy the example response body for {ep.method} {ep.path}"
																size={ICON.xs}
																class="absolute top-2 right-2 rounded bg-surface-2 opacity-0 transition-opacity group-hover/code:opacity-100 has-[:focus-visible]:opacity-100 pointer-coarse:opacity-100"
															/>
														</div>
													{/if}
												</div>
											{/if}

											<div>
												<p class="mb-1.5 text-xs font-medium text-faint">
													Request
													<span class="font-normal text-faint"> (paste it, then fill in the placeholders)</span>
												</p>
												<div class="group/code relative">
													<pre class="overflow-x-auto rounded-lg border border-line bg-ink p-3 font-mono text-xs leading-relaxed text-fg">{preview}</pre>
													<CopyButton
														value={preview}
														label="Copy a curl request for {ep.method} {ep.path}"
														title="Copy a curl request for {ep.method} {ep.path}"
														size={ICON.xs}
														class="absolute top-2 right-2 rounded bg-surface-2 opacity-0 transition-opacity group-hover/code:opacity-100 has-[:focus-visible]:opacity-100 pointer-coarse:opacity-100"
													/>
												</div>
											</div>
										</div>
									{/if}
								</Card>
							{/each}
						</div>
					</section>
				{/each}

				{#if filtered.length === 0}
					<EmptyState
						level={2}
						title={`No endpoints match "${query}"`}
						description="Clear the search to see every endpoint."
					/>
				{/if}
			</div>
		</div>
	</div>
</PageShell>

<!--
	Running one endpoint against this engine.

	A reference answers "what exists". The question somebody actually opened it
	with is "what does this return on my data", and this page is in an unusual
	position to answer it: the reader already holds a session against the very
	engine being documented, so there is no key to make and nothing to set up.

	The whole design is in what it refuses. A GET is one press. A write needs
	the super admin role and an acknowledgment of that one call, and the
	acknowledgment is not remembered, because this page looks like
	documentation rather than like a console and a DELETE here deletes real
	data. None of that is configurable: no setting weakens this control.
-->
{#snippet tryIt(ep: EndpointDoc, key: string)}
	{@const method = ep.method.toUpperCase()}
	{@const write = isWriteMethod(method)}
	{@const missing = unfilledParameters(ep.path)}
	{@const mine = triedKey === key}
	<Collapsible class="rounded-lg border border-line" label="Try it" badge={write ? 'changes data' : undefined}>
		<form
			method="POST"
			action="?/try"
			use:enhance={() => {
				triedKey = key;
				return async ({ update }) => update({ reset: false });
			}}
			class="flex flex-col gap-3 border-t border-line p-3"
		>
			<input type="hidden" name="method" value={method} />
			<Input
				id="try-path-{key}"
				name="path"
				label="Path"
				value={ep.path}
				hint={missing.length > 0
					? `Replace ${missing.map((m) => `{${m}}`).join(', ')} with real values before sending.`
					: 'The request goes to this engine, signed in as you.'}
			/>

			{#if write}
				{#if data.canSeeAdmin}
					<Checkbox
						name="acknowledge"
						label={`I understand this ${method} changes data on this engine.`}
					/>
					<Textarea id="try-body-{key}" name="body" label="Body" rows={3} />
				{:else}
					<p class="text-xs text-faint">
						Only a super admin can send a {method} from this page. The curl line below is the
						complete request.
					</p>
				{/if}
			{/if}

			{#if !write || data.canSeeAdmin}
				<div>
					<Button variant="secondary" size="sm" type="submit">
						<Play size={ICON.sm} /> Send
					</Button>
				</div>
			{/if}
		</form>

		{#if mine && tryError}
			<div class="px-3 pb-3"><Alert tone="danger">{tryError}</Alert></div>
		{:else if mine && tried}
			<div class="flex flex-col gap-2 px-3 pb-3">
				<div class="flex flex-wrap items-center gap-2 text-xs">
					<Badge tone={tried.status < 400 ? 'success' : tried.status < 500 ? 'warn' : 'danger'}>
						{tried.status}
					</Badge>
					<span class="text-faint">{tried.durationMs} ms</span>
					{#if tried.contentType}
						<span class="font-mono text-faint">{tried.contentType.split(';')[0]}</span>
					{/if}
					{#if tried.truncated}
						<span class="text-faint">body cut to 64 KB</span>
					{/if}
				</div>
				<pre
					class="max-h-80 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs text-fg">{tried.body}</pre>
			</div>
		{/if}
	</Collapsible>
{/snippet}
