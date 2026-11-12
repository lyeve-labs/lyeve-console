<script lang="ts">
	import { SectionHeading, Table } from '@lyeve-labs/ui-kit';
	import type { FlowTemplate } from '$lib/api/flows';

	interface Props {
		templates?: FlowTemplate[];
	}

	let { templates = [] }: Props = $props();

	const ENV: { name: string; value: string }[] = [
		{ name: 'trigger', value: 'What started the run. HTTP: method, path, query, params, headers, body, ip, user. Event: schema, event, record_id, data, old_data. Cron: scheduled_at. A test run: whatever you typed in the Test tab.' },
		{ name: 'input', value: 'The value on the node\'s default in port: the upstream node\'s output, or a list when several edges land on it.' },
		{ name: 'inputs', value: 'Every inbound port by name, for nodes such as Join that take more than one.' },
		{ name: 'nodes', value: 'nodes.<id>.output for every node that has completed and sits upstream of this one.' },
		{ name: 'vars', value: 'Tenant variables, secrets included. A secret\'s value never appears in a run record.' },
		{ name: 'run', value: 'id, flow, version, started_at, is_test.' },
		{ name: 'now()', value: 'Time helpers plus map, filter, first, last, len, keys, values, get, join, split, lower, upper, trim, json, fromJSON and uuid.' },
	];

	const TEMPLATE_NOTES: Record<string, string> = {
		'join-three-tables-api':
			'An HTTP trigger, two content queries and a join, ending in a response. The trigger caches the answer for 30 seconds per customer and rate-limits by API key. Start here when you want one endpoint that returns data from three tables.',
		'nightly-sheet-export':
			'A cron trigger at 02:00, a content query and a sheets.append. It needs a google_sheets datasource named in the node. Start here for a scheduled export.',
		'enrich-on-create':
			'An event trigger on a content type, an HTTP lookup and a content.upsert that writes the answer back. Start here when a new record should be completed from an outside service.',
	};
</script>

<div class="prose-sm max-w-3xl space-y-6 p-4 text-sm text-fg">
	<section class="flex flex-col gap-1">
		<SectionHeading level={3}>What a flow is</SectionHeading>
		<p class="text-muted">
			A flow is a graph the tenant owns: one trigger, some nodes, the edges between them and a few
			settings. The trigger decides when it runs. Each node does one unit of work with the config
			you give it and passes its output along its edges. A flow is a draft until you publish it.
			Publishing saves a numbered version and turns the trigger on. Disable the flow to turn the
			trigger off without losing anything, and roll back to any earlier version from the settings panel.
		</p>
	</section>

	<section class="flex flex-col gap-1">
		<SectionHeading level={3}>How data moves</SectionHeading>
		<p class="text-muted">
			An edge carries the output of one node to an input port of the next. Every port has a name:
			<code class="font-mono text-xs">out</code> and <code class="font-mono text-xs">in</code> are the
			defaults, and a node such as Join names its ports
			<code class="font-mono text-xs">left</code> and <code class="font-mono text-xs">right</code>.
			A node runs once every inbound edge has resolved. A node with no inbound edge is a root and
			starts immediately with the trigger payload as its input. The dashed line on the canvas shows
			that. Fan-out is allowed. A port that takes several edges receives them as a list in edge
			order. The graph cannot loop back on itself, so the canvas does not let you draw an edge that
			would create a cycle.
		</p>
	</section>

	<section class="flex flex-col gap-1">
		<SectionHeading level={3}>Expressions</SectionHeading>
		<p class="mb-2 text-muted">
			Any string in a node's config may carry
			<code class="font-mono text-xs">{'{{ }}'}</code> segments. A value that is exactly one
			segment keeps its type, so a list stays a list. Anything else becomes text. A config may read
			<code class="font-mono text-xs">nodes.&lt;id&gt;</code> only for a node upstream of it, or the
			trigger. These names are available:
		</p>
		<Table label="Expression environment">
			<thead>
				<tr>
					<th scope="col">Name</th>
					<th scope="col">Value</th>
				</tr>
			</thead>
			<tbody>
				{#each ENV as row (row.name)}
					<tr>
						<td class="font-mono text-xs text-fg">{row.name}</td>
						<td class="text-muted">{row.value}</td>
					</tr>
				{/each}
			</tbody>
		</Table>
	</section>

	<section class="flex flex-col gap-1">
		<SectionHeading level={3}>The templates</SectionHeading>
		<ul class="list-disc space-y-2 pl-5 text-muted">
			{#each templates as t (t.id)}
				<li>
					<span class="font-medium text-fg">{t.name}.</span>
					{TEMPLATE_NOTES[t.id] ?? t.description}
				</li>
			{:else}
				{#each Object.entries(TEMPLATE_NOTES) as [id, note] (id)}
					<li><span class="font-mono text-xs text-fg">{id}.</span> {note}</li>
				{/each}
			{/each}
		</ul>
	</section>

	<section class="flex flex-col gap-1">
		<SectionHeading level={3}>Run a test</SectionHeading>
		<p class="text-muted">
			Run test executes the draft on the canvas, not the published version, with the trigger JSON
			from the Test tab. A node with side effects (writes, HTTP calls other than GET, email, events)
			runs in dry-run mode and reports what it would have done instead of doing it. Switch on Allow
			side effects to let those nodes act. Stop after node ends the run after the node you name, so you
			can inspect an intermediate output. A test run is recorded like any other, marked as a test.
			Live runs come from the trigger, or from Run on a published flow.
		</p>
	</section>

	<section class="flex flex-col gap-1">
		<SectionHeading level={3}>Export and import</SectionHeading>
		<p class="text-muted">
			An export is the definition as JSON or YAML, positions included, so it re-imports as drawn.
			It never includes a secret. A datasource is referenced by name. An import looks for that name
			in the target tenant and lists the ones it cannot find. Create them under Datasources
			before publishing. Secret variables export as the key alone, marked secret, with no value.
			Import creates a new flow, or replaces the draft of the flow whose slug you give.
		</p>
	</section>
</div>
