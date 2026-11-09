<script lang="ts">
	import { Alert, Badge, Button, Input, SectionHeading, SegmentedControl, Table, CopyField } from '@lyeve-labs/ui-kit';
	import { Play, Square } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { streamUrl, parseTopics, STREAM_KEEP, type StreamTransport } from '$lib/api/stream-lab';
	import { formatTime } from '$lib/format';

	// A stream is the one lab a form action cannot send: it stays open and
	// the answer arrives over time. The browser opens it itself, on this
	// origin, with the session cookie, the way the log stream on
	// Observability does, and the realtime plugin checks that the Origin is
	// this host.

	let transport = $state<StreamTransport>('sse');
	let topics = $state('*');
	let status = $state<'idle' | 'connecting' | 'open' | 'closed' | 'failed'>('idle');
	let received = $state<{ at: string; topic: string; id: string; data: string }[]>([]);
	let es: EventSource | null = null;
	let ws: WebSocket | null = null;

	const url = $derived(streamUrl(transport, parseTopics(topics), typeof location === 'undefined' ? '' : location.host, typeof location === 'undefined' ? 'https:' : location.protocol));

	function keep(topic: string, id: string, data: string) {
		received = [{ at: formatTime(new Date()), topic, id, data }, ...received].slice(0, STREAM_KEEP);
	}

	function connect() {
		disconnect();
		status = 'connecting';
		if (transport === 'sse') {
			const source = new EventSource(url);
			es = source;
			source.onopen = () => (status = 'open');
			source.onerror = () => {
				// The browser retries a dropped stream on its own. A stream
				// refused before it opened is closed and stays closed.
				status = source.readyState === EventSource.CLOSED ? 'failed' : 'connecting';
			};
			source.onmessage = (e) => keep('message', e.lastEventId, e.data);
			// The plugin names each event after the topic it was subscribed
			// under, and no topic is the catch-all.
			const names = parseTopics(topics);
			for (const t of names.length ? names : ['*']) {
				source.addEventListener(t, (e) => keep(t, (e as MessageEvent).lastEventId, (e as MessageEvent).data));
			}
			return;
		}
		const socket = new WebSocket(url);
		ws = socket;
		socket.onopen = () => (status = 'open');
		socket.onerror = () => (status = 'failed');
		socket.onclose = () => {
			if (status !== 'failed') status = 'closed';
		};
		socket.onmessage = (e) => {
			const raw = typeof e.data === 'string' ? e.data : '(binary frame)';
			try {
				const m = JSON.parse(raw) as { type?: string; topic?: string; id?: number; data?: unknown };
				keep(m.topic || m.type || 'message', m.id != null ? String(m.id) : '', JSON.stringify(m.data ?? m));
			} catch {
				keep('message', '', raw);
			}
		};
	}

	function disconnect() {
		es?.close();
		ws?.close();
		es = null;
		ws = null;
		if (status !== 'idle') status = 'closed';
	}

	$effect(() => () => disconnect());

	const stateTone = $derived(status === 'open' ? 'success' : status === 'failed' ? 'danger' : status === 'connecting' ? 'warn' : 'neutral');
</script>

<section class="flex flex-col gap-4">
	<SectionHeading level={2}>Streams</SectionHeading>
	<p class="text-sm text-muted">Subscribe to the realtime plugin's events as a client would.</p>
	<ul class="flex flex-col gap-1 text-sm text-muted">
		<li><span class="font-mono">content:&lt;schema&gt;</span> for writes to a content type</li>
		<li><span class="font-mono">schema:changed</span> for content type changes</li>
		<li>The topic a flow's publish node names</li>
		<li><span class="font-mono">*</span> for every event</li>
	</ul>
	<p class="text-sm text-muted">
		Events from other nodes arrive here too, so you can test a multi-node setup.
	</p>

	<SegmentedControl
		label="Transport"
		bind:value={transport}
		options={[
			{ value: 'sse', label: 'Server-sent events' },
			{ value: 'ws', label: 'WebSocket' },
		]}
	/>
	<Input
		id="stream-topics"
		label="Topics"
		mono
		hint="Separated by commas, at most 20. Leave it empty for every topic."
		bind:value={topics}
	/>
	<CopyField label="Stream URL" value={url} copyLabel="Copy the stream URL" />
	<div class="flex items-center gap-2">
		{#if status === 'open' || status === 'connecting'}
			<Button variant="secondary" onclick={disconnect}><Square size={ICON.sm} /> Disconnect</Button>
		{:else}
			<Button variant="primary" onclick={connect}><Play size={ICON.sm} /> Connect</Button>
		{/if}
		<Badge tone={stateTone} dot>{status}</Badge>
		{#if received.length > 0}
			<Button variant="ghost" size="sm" onclick={() => (received = [])}>Clear</Button>
		{/if}
	</div>

	{#if status === 'failed'}
		<Alert tone="danger">
			The stream was refused. Check that the realtime plugin is running, and that this page's origin is the
			engine's own host or one of its CORS origins.
		</Alert>
	{/if}

	<SectionHeading level={3}>What arrives</SectionHeading>
	<p class="text-xs text-muted">
		Each event has its topic, a per-topic id that a reconnecting client resumes from, and the payload. For a
		content write, the payload is the record and the action.
	</p>
	{#if received.length === 0}
		<p class="text-sm text-faint">No events yet. Save an entry in another tab to see one arrive.</p>
	{:else}
		<div class="max-h-96 overflow-auto rounded border border-line">
			<Table label="Events received">
				<thead>
					<tr>
						<th scope="col">Time</th>
						<th scope="col">Topic</th>
						<th scope="col">Id</th>
						<th scope="col">Payload</th>
					</tr>
				</thead>
				<tbody>
					{#each received as r, i (i)}
						<tr>
							<td data-cell="nowrap" class="text-xs text-faint">{r.at}</td>
							<td data-cell="nowrap" class="font-mono text-xs">{r.topic}</td>
							<td data-cell="nowrap" class="font-mono text-xs text-faint">{r.id}</td>
							<td class="font-mono text-xs break-all">{r.data}</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		</div>
	{/if}
</section>
