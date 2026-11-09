<script lang="ts">
	/**
	 * One lab's response: its status, timing, headers and body.
	 *
	 * Every lab renders the answer the same way, so it lives here rather than
	 * in each lab's page.
	 */
	import { Alert, Badge, CopyButton, SectionHeading, Table } from '@lyeve-labs/ui-kit';
	import { documentedStatus, statusHint, type LabEndpoint, type LabResult } from '$lib/api/labs';
	import { httpStatusTone } from '$lib/tones';

	interface Props {
		result: LabResult;
		/** The documented route the request was sent to, when the lab knows it. */
		expected?: LabEndpoint | null;
	}

	let { result, expected = null }: Props = $props();
</script>

<SectionHeading level={3}>Response</SectionHeading>
<div class="flex flex-wrap items-center gap-2">
	<Badge tone={httpStatusTone(result.status)} dot>
		{result.status}
		{result.statusText}
	</Badge>
	<span class="font-mono text-xs text-faint">{result.method} {result.path}</span>
	<span class="text-xs text-faint">{result.durationMs} ms</span>
</div>
{#if expected}
	{@const doc = documentedStatus(expected.statuses, result.status)}
	{#if doc}
		<p class="text-xs text-muted">Documented: {doc.code} {doc.description}</p>
	{:else if doc === false}
		<p class="text-xs text-warn">
			{result.status} is not a documented status for this route
			({expected.statuses?.map((x) => x.code).join(', ')}).
		</p>
	{/if}
{/if}
{#if statusHint(result.status)}
	<!-- The statuses a tester meets once and has to guess at. 402 is the
	     one worth spelling out: nothing about the request is wrong. -->
	<Alert tone={httpStatusTone(result.status) === 'success' ? 'brand' : 'warn'}>
		{statusHint(result.status)}
	</Alert>
{/if}
{#if Object.keys(result.headers).length > 0}
	<Table label="Response">
		<tbody>
			{#each Object.entries(result.headers) as [name, value] (name)}
				<tr>
					<th scope="row" class="font-mono text-xs">{name}</th>
					<td class="font-mono text-xs text-faint">{value}</td>
				</tr>
			{/each}
		</tbody>
	</Table>
{/if}
<div class="flex items-center justify-between gap-2">
	<span class="text-xs text-muted">{result.json ? 'JSON' : 'Not JSON'}</span>
	<CopyButton value={result.body} label="Copy the response" />
</div>
<pre class="max-h-96 overflow-auto rounded border border-line bg-surface-2 p-3 font-mono text-xs">{result.body ||
		'(empty body)'}</pre>
