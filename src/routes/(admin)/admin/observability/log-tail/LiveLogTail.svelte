<script lang="ts">
	import { Alert, Badge, Button, EmptyState, Input, SectionHeading, SegmentedControl, Table } from '@lyeve-labs/ui-kit';
	import { onMount } from 'svelte';
	import { Activity, RefreshCw, Trash2 } from '@lucide/svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { LOG_LEVELS, formatTime, logLevelLabel, logLevelTone } from '$lib/format';
	import { ICON } from '$lib/icon';

	interface Props {
		/** Whether the logging plugin runs, so there is a tail to follow. */
		running: boolean;
	}

	let { running }: Props = $props();

	/**
	 * One entry off the SSE tail.
	 *
	 * `level` is slog's severity integer (-4, 0, 4, 8), not the label. The
	 * engine serializes the ring buffer entry as it holds it and nothing turns
	 * the number back into a name on the way out. Typed as a string, the badge
	 * below would call a string method on a number and take the whole table
	 * down with it.
	 */
	interface LogEntry {
		timestamp: string;
		level: number;
		message: string;
		tenant_id?: string;
		plugin?: string;
		attrs?: Record<string, string>;
		sequence: number;
	}

	/**
	 * Where the tail stands. The browser retries a stream that dropped after it
	 * opened, and reports that as a connection being made again. A stream the
	 * engine refused is closed and stays closed, so retrying it on a timer only
	 * repeats the refusal. It waits for the reader to try again.
	 */
	type TailState = 'connecting' | 'open' | 'refused';

	let logEntries = $state<LogEntry[]>([]);
	let logState = $state<TailState>('connecting');
	let logPaused = $state(false);
	let logMinLevel = $state('INFO');
	let logKeyword = $state('');

	const MAX_LOG_ENTRIES = 200;

	// The stream reads the level and the keyword to build its URL, so it is
	// reopened by the effect below whenever either changes. The keyword is
	// applied after a pause, because a stream reopened on every keystroke would
	// tear down and rebuild the tail once per character.
	let appliedKeyword = $state('');
	const KEYWORD_DEBOUNCE_MS = 300;

	let logEs: EventSource | null = null;
	let logDestroyed = false;

	// The badge tells the truth: Connected only while a stream is open, and
	// Connecting from the moment one is closed until the next one opens.
	function closeLogStream() {
		logEs?.close();
		logEs = null;
		logState = 'connecting';
	}

	// A live tail is a stream, not a page read, so it stays on the client. The
	// filter is applied at the source: the stream is reopened rather than
	// filtered here, so a narrowed level also narrows what crosses the wire.
	function connectLogStream(minLevel: string, keyword: string) {
		if (logDestroyed) return;
		closeLogStream();

		const params = new URLSearchParams({ min_level: minLevel.toLowerCase() });
		if (keyword) params.set('keyword', keyword);

		const es = new EventSource(`/api/admin/logs/stream?${params}`);
		logEs = es;

		es.addEventListener('open', () => {
			if (logEs === es) logState = 'open';
		});

		es.addEventListener('log', (e: MessageEvent) => {
			if (logPaused) return;
			try {
				const entry: LogEntry = JSON.parse(e.data as string);
				logEntries = [entry, ...logEntries].slice(0, MAX_LOG_ENTRIES);
			} catch { /* ignore malformed */ }
		});

		// A stream the page closed by hand never errors, so this fires only for
		// the connection that is still current, and a stale one is ignored.
		es.addEventListener('error', () => {
			if (logEs !== es) return;
			if (es.readyState === EventSource.CLOSED) {
				logEs = null;
				logState = 'refused';
			} else {
				logState = 'connecting';
			}
		});
	}

	function retryLogStream() {
		connectLogStream(logMinLevel, appliedKeyword);
	}

	function setMinLevel(level: string) {
		logMinLevel = level;
	}

	function applyKeyword(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			appliedKeyword = logKeyword.trim();
		}
	}

	$effect(() => {
		const next = logKeyword.trim();
		const timer = setTimeout(() => { appliedKeyword = next; }, KEYWORD_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	});

	// The running prop reads through to the page's data, so an effect that
	// read it directly would rerun on every refresh, latency depth and saved
	// tunable, and close and empty the tail each time. The derived value
	// changes only when the flag does.
	const logTail = $derived(running);

	// This effect tracks only the two filter values and whether the plugin
	// runs. Its cleanup closes the stream it opened and nothing more, so a
	// filter change is a close followed by a reopen. The destroyed flag belongs
	// to unmount alone, below.
	$effect(() => {
		const minLevel = logMinLevel;
		const keyword = appliedKeyword;
		logEntries = [];
		if (!logTail) return;
		connectLogStream(minLevel, keyword);
		return () => closeLogStream();
	});

	onMount(() => () => {
		logDestroyed = true;
		closeLogStream();
	});
</script>

{#snippet noLogEntries()}
	<Activity size={ICON.lg} />
{/snippet}

<section class="flex flex-col gap-4">
	<div class="flex items-center gap-2">
		<SectionHeading level={2}>Live log tail</SectionHeading>
		{#if !logTail}
			<Badge tone="neutral" dot>Not running</Badge>
		{:else if logState === 'open'}
			<Badge tone="success" dot>Connected</Badge>
		{:else if logState === 'refused'}
			<Badge tone="danger" dot>Refused</Badge>
		{:else}
			<Badge tone="warn" dot>Connecting</Badge>
		{/if}
		{#if logTail}
			<span class="text-xs text-faint">{logEntries.length} entries</span>
		{/if}
	</div>

	{#if !logTail}
		<Alert tone="brand">
			The logging plugin is not running on this engine, so the live log tail is not available.
		</Alert>
	{:else}
		{#if logState === 'refused'}
			<Alert tone="warn" title="Could not connect to the live log tail">
				<p>The connection was refused, and it does not reconnect on its own. Choose Try again.</p>
				<div class="mt-3">
					<Button variant="secondary" size="sm" onclick={retryLogStream}>
						<RefreshCw size={ICON.sm} aria-hidden="true" /> Try again
					</Button>
				</div>
			</Alert>
		{/if}

		<ListToolbar label="Filter the log tail">
			{#snippet search()}
				<label for="tail-keyword" class="sr-only">Filter</label>
				<Input id="tail-keyword" bind:value={logKeyword} placeholder="Keyword, then Enter" onkeydown={applyKeyword} />
			{/snippet}
			{#snippet filters()}
				<div id="tail-level">
					<SegmentedControl
						label="Minimum level"
						labelHidden
						size="sm"
						options={LOG_LEVELS.map((lv) => ({ value: lv, label: lv }))}
						value={logMinLevel}
						onchange={setMinLevel}
					/>
				</div>
				<Button variant={logPaused ? 'primary' : 'secondary'} onclick={() => { logPaused = !logPaused; }}>
					{logPaused ? 'Resume' : 'Pause'}
				</Button>
				<Button variant="secondary" onclick={() => { logEntries = []; }}>
					<Trash2 size={ICON.sm} /> Clear
				</Button>
			{/snippet}
		</ListToolbar>

		{#if logEntries.length === 0}
			{#if logState !== 'refused'}
				<EmptyState
					iconSnippet={noLogEntries}
					title="Waiting for log entries"
					description="Entries at the selected level appear here as they are written."
				/>
			{/if}
		{:else}
			<div class="max-h-96 overflow-y-auto overscroll-contain rounded-xl">
				<Table hoverable label="Live log tail">
					<tbody>
						{#each logEntries as entry (entry.sequence)}
							<tr class="align-top">
								<td class="whitespace-nowrap font-mono text-xs">
									<!-- A timestamp that will not parse shows as it arrived, never as "Invalid Date". -->
									<span class="text-faint">{formatTime(entry.timestamp, entry.timestamp)}</span>
								</td>
								<td class="whitespace-nowrap">
									<Badge tone={logLevelTone(entry.level)}>{logLevelLabel(entry.level)}</Badge>
								</td>
								<td class="font-mono text-xs">{entry.message}</td>
								<td class="whitespace-nowrap text-xs">
									<span class="text-faint">
										{#if entry.tenant_id}<span class="mr-2">tenant {entry.tenant_id}</span>{/if}
										{#if entry.plugin}<span>plugin {entry.plugin}</span>{/if}
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			</div>
		{/if}
	{/if}
</section>
