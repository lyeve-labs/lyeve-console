<script lang="ts">
	import { Alert, Badge, Button, CopyButton, PageShell, SectionHeading, Table } from '@lyeve-labs/ui-kit';
	import { FlaskConical } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import GraphqlTabs from '$lib/components/GraphqlTabs.svelte';
	import { GRAPHQL_HTTP, GRAPHQL_WS, type RootField } from '$lib/api/graphql';
	import type { PageData } from './$types';
	import { ICON } from '$lib/icon';
	import { couldNotLoad } from '$lib/outage';

	let { data }: { data: PageData } = $props();

	const curl = `curl -X POST ${GRAPHQL_HTTP} \\\n  -H 'Authorization: Bearer <token>' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"query":"{ __typename }"}'`;

	const schemaRoots = $derived(data.schema.ok ? data.schema.value.roots : null);
	const refused = $derived(data.schema.ok ? data.schema.value.refused : null);
	const roots = $derived(
		schemaRoots
			? ([
					['Queries', schemaRoots.query],
					['Mutations', schemaRoots.mutation],
					['Subscriptions', schemaRoots.subscription],
				] as [string, RootField[]][])
			: [],
	);
</script>

<PageShell
	title="GraphQL"
	documentTitle="GraphQL - Settings"
	description="See the schema generated from your content types and the addresses that serve it."
	width="wide"
>
	{#snippet actions()}
		<Button variant="secondary" size="sm" href="/admin/api-labs/graphql">
			<FlaskConical size={ICON.sm} /> Try it in API labs
		</Button>
	{/snippet}

	<GraphqlTabs active="schema" />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="GraphQL"
			absent="GraphQL is not included in this build."
		/>
	{:else}
		<section class="flex flex-col gap-3">
			<SectionHeading level={2}>Endpoints</SectionHeading>
			<Table label="GraphQL endpoints">
				<tbody>
					<tr>
						<th scope="row" class="text-sm">Queries and mutations</th>
						<td data-cell="nowrap" class="font-mono text-xs">POST {GRAPHQL_HTTP}</td>
						<td class="min-w-48 text-xs text-muted">A GET on the same path only reports whether the endpoint is ready.</td>
					</tr>
					<tr>
						<th scope="row" class="text-sm">Subscriptions</th>
						<td data-cell="nowrap" class="font-mono text-xs">GET {GRAPHQL_WS}</td>
						<td class="min-w-48 text-xs text-muted">WebSocket with the graphql-ws protocol. Send the token in connection_init.</td>
					</tr>
				</tbody>
			</Table>
			<p class="text-xs text-muted">
				Both accept the same credentials as the REST API, a bearer token or an API key. To send a persisted
				query's hash instead of its text, the query must be on the Persisted queries tab.
			</p>
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between gap-2">
					<span class="text-xs text-muted">A first request</span>
					<CopyButton value={curl} label="Copy the request" />
				</div>
				<pre class="overflow-auto rounded border border-line bg-surface-2 p-3 font-mono text-xs">{curl}</pre>
			</div>
		</section>

		<section class="flex flex-col gap-3">
			<SectionHeading level={2}>Schema</SectionHeading>
			{#if !data.schema.ok}
				<GateNotice gate={data.schema.gate} title="GraphQL schema" absent="The schema view needs a newer version of the GraphQL plugin." />
			{:else if refused}
				<Alert tone="warn">
					Introspection was refused: {refused} By default the graphql.introspection setting allows it only for
					an administrator, and the setting can turn it off. The schema is served either way.
				</Alert>
			{:else if !schemaRoots}
				<Alert tone="danger">{couldNotLoad('the GraphQL schema', { reload: true })}</Alert>
			{:else}
				<p class="text-xs text-muted">
					Built from your content types. A content type you add in the schema builder appears here as its own
					fields.
				</p>
				<div class="grid gap-4 xl:grid-cols-3">
					{#each roots as [label, fields] (label)}
						<div class="flex flex-col gap-2">
							<SectionHeading level={3}>{label} <Badge tone="neutral" size="sm">{fields.length}</Badge></SectionHeading>
							{#if fields.length === 0}
								<p class="text-sm text-faint">None.</p>
							{:else}
								<div class="max-h-96 overflow-auto rounded border border-line">
									<Table label={label}>
										<tbody>
											{#each fields as f (f.name)}
												<tr>
													<!-- The table breaks a narrow column anywhere, which split
													     names mid-word. Each identifier is held whole, so a long
													     argument list breaks only between arguments. -->
													<td class="font-mono text-xs text-fg">
														<span class="whitespace-nowrap">{f.name}</span>{#each f.args as arg, i (arg)}{#if i > 0}{' '}{/if}<span
																class="whitespace-nowrap text-faint"
																>{i === 0 ? '(' : ''}{arg}{i === f.args.length - 1 ? ')' : ','}</span
															>{/each}
													</td>
													<td class="text-xs text-muted">{f.description}</td>
												</tr>
											{/each}
										</tbody>
									</Table>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</PageShell>
