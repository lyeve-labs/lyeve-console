<script lang="ts">
	import {
		Alert,
		Badge,
		Card,
		PageShell,
		SectionHeading,
		Stat,
		Table,
	} from '@lyeve-labs/ui-kit';
	import RefreshButton from '$lib/components/RefreshButton.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import {
		BACKEND_SETTINGS,
		HEALTH_LABELS,
		TOPIC_SHAPE,
		connectionGuide,
		backendLabel,
		brokerHealth,
		deliveryRate,
		hasBroker,
		healthTone,
	} from '$lib/api/messagebroker';
	import { NO_VALUE, formatDateTime, plural } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const health = $derived(brokerHealth(data.status));
	const broker = $derived(hasBroker(data.status));
	const rate = $derived(deliveryRate(data.status));
	const outbox = $derived(data.status?.outbox);
	const guide = $derived(data.status ? connectionGuide(data.status.backend, data.status.topic_prefix) : null);
	const backendSettings = $derived(data.status ? (BACKEND_SETTINGS[data.status.backend] ?? []) : []);
</script>

<PageShell
	title="Message broker"
	description="See where content events are published and whether they arrive."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#snippet actions()}
		{#if data.permitted && data.gate.state === 'ok'}
			<RefreshButton />
		{/if}
	{/snippet}

	{#if !data.permitted}
		<Alert tone="brand">
			Only a super admin can see the broker status, because it shows infrastructure outside this
			engine and covers every tenant.
		</Alert>
	{:else if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Message broker"
			absent="The message broker is not included in this build."
		/>
	{:else if data.status}
		<div class="flex items-center gap-2">
			<Badge tone={healthTone(health)} dot>{HEALTH_LABELS[health]}</Badge>
			<span class="text-xs text-muted">{backendLabel(data.status.backend)}</span>
		</div>

		{#if data.status.degraded}
			<Alert tone="warn">
				The message broker plugin is not enabled on this engine, so events are dropped instead of
				published.
			</Alert>
		{:else if outbox?.enabled && outbox.available && (outbox.dead > 0 || data.status.failed > 0)}
			<!-- With an outbox a refused event is retried, so the lost and the
			     waiting counts lead, and Failed counts attempts. -->
			<Alert tone={outbox.dead > 0 ? 'danger' : 'warn'}>
				{#if outbox.dead > 0}
					{outbox.dead}
					{plural(outbox.dead, 'event')} failed every retry and never reached the broker.
				{/if}
				{outbox.pending}
				{plural(outbox.pending, 'event is', 'events are')} waiting in the outbox.
				{#if data.status.failed > 0}
					The broker refused {data.status.failed} publish
					{plural(data.status.failed, 'attempt')} since the engine last started. The outbox
					retries a refused event until the broker accepts it or it reaches its retry limit.
				{/if}
			</Alert>
		{:else if outbox?.enabled && !outbox.available && data.status.failed > 0}
			<Alert tone="warn">
				The broker refused {data.status.failed} publish
				{plural(data.status.failed, 'attempt')} since the engine last started. The outbox
				retries them. Could not load the outbox counts.
			</Alert>
		{:else if data.status.failed > 0}
			<Alert tone="danger">
				The broker refused {data.status.failed}
				{plural(data.status.failed, 'event')}. Refused events are not retried, but the content
				changes behind them were all saved.
			</Alert>
		{:else if data.status.dropped > 0 && !data.status.connected}
			<Alert tone="warn">
				{data.status.dropped}
				{plural(data.status.dropped, 'event')} were dropped because no broker connection was open.
				Check this engine's broker configuration.
			</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-3">
			<Stat size="sm" mono label="Published" value={data.status.published} />
			<Stat
				size="sm"
				mono
				label={outbox?.enabled ? 'Attempts refused by the broker' : 'Refused by the broker'}
				value={data.status.failed}
				tone={data.status.failed > 0 ? (outbox?.enabled ? 'warn' : 'danger') : 'neutral'}
			/>
			<Stat
				size="sm"
				mono
				label="Nowhere to send"
				value={data.status.dropped}
				tone={data.status.dropped > 0 ? 'warn' : 'neutral'}
			/>
			{#if outbox?.enabled}
				<Stat
					size="sm"
					mono
					label="Waiting in the outbox"
					value={outbox.available ? outbox.pending : NO_VALUE}
					tone={outbox.available && outbox.pending > 0 ? 'warn' : 'neutral'}
				/>
				<Stat
					size="sm"
					mono
					label="Lost after every attempt"
					value={outbox.available ? outbox.dead : NO_VALUE}
					tone={outbox.available && outbox.dead > 0 ? 'danger' : 'neutral'}
				/>
			{/if}
		</div>
		<p class="text-xs text-muted">
			Counted since the engine last started. A restart resets them to zero.
			{#if !broker}
				With no broker set, Published counts events that were discarded.
			{:else if rate !== null}
				{rate}% of attempts reached the broker.
			{/if}
		</p>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Connection</SectionHeading>
			<Table label="Connection">
				<tbody>
					<tr>
						<th scope="row">Backend</th>
						<td>{backendLabel(data.status.backend)}</td>
					</tr>
					<tr>
						<th scope="row">Connected</th>
						<td>
							{#if broker}
								<Badge tone={data.status.connected ? 'success' : 'warn'} dot>
									{data.status.connected ? 'Yes' : 'No'}
								</Badge>
							{:else}
								<span class="text-faint">{NO_VALUE}</span>
							{/if}
						</td>
					</tr>
					<tr>
						<th scope="row">Target</th>
						<!-- The engine removes the credentials before sending this, because a
						     broker URL routinely carries a user and a password and this page
						     gets pasted into support threads. -->
						<td class="font-mono text-xs">{data.status.target || NO_VALUE}</td>
					</tr>
					{#if data.status.stream}
						<tr>
							<th scope="row">Stream</th>
							<td class="font-mono text-xs">{data.status.stream}</td>
						</tr>
					{/if}
					{#if data.status.topic_prefix}
						<tr>
							<th scope="row">Topic prefix</th>
							<td class="font-mono text-xs">{data.status.topic_prefix}</td>
						</tr>
					{/if}
					<tr>
						<th scope="row">TLS</th>
						<td>
							{#if broker}
								<Badge tone={data.status.tls ? 'success' : 'danger'}>
									{data.status.tls ? 'On' : 'Off'}
								</Badge>
							{:else}
								<span class="text-faint">{NO_VALUE}</span>
							{/if}
						</td>
					</tr>
					<tr>
						<th scope="row">Topics</th>
						<td class="font-mono text-xs">{TOPIC_SHAPE}</td>
					</tr>
					<tr>
						<th scope="row">Last publish</th>
						<td class="text-xs text-faint">
							{broker && data.status.last_publish_at
								? formatDateTime(data.status.last_publish_at)
								: HEALTH_LABELS.idle}
						</td>
					</tr>
				</tbody>
			</Table>
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Connecting services</SectionHeading>
			{#if guide}
				<div class="grid gap-4 lg:grid-cols-3">
					<Card>
						<div class="flex flex-col gap-2 text-sm text-muted">
							<SectionHeading level={3}>What is published</SectionHeading>
							<p>
								Every content create, update and delete is published as JSON: the event type, content type,
								tenant, the record and an event id to deduplicate on. A broker outage delays events
								rather than losing them.
							</p>
							<p class="font-mono text-xs break-words text-fg">{guide.listen}</p>
						</div>
					</Card>
					<Card>
						<div class="flex flex-col gap-2 text-sm text-muted">
							<SectionHeading level={3}>Send to this engine</SectionHeading>
							<p>
								A flow whose trigger is <span class="font-medium text-fg">Message received</span> runs once
								per message under its tenant's namespace. Give it a group and every instance sharing the
								group splits the messages. Without one, each instance runs every message.
							</p>
							<p class="font-mono text-xs break-words text-fg">{guide.send}</p>
						</div>
					</Card>
					<Card>
						<div class="flex flex-col gap-2 text-sm text-muted">
							<SectionHeading level={3}>Send from a flow</SectionHeading>
							<p>
								The <span class="font-medium text-fg">Publish a message</span> node sends any payload a flow
								builds, on a subject under the run's tenant, so a flow can call another service the same way
								a content event does.
							</p>
							<a href="/admin/flows" class="relative hit-area self-start text-sm text-brand hover:underline">Open flows</a>
						</div>
					</Card>
				</div>
			{:else}
				<Alert tone="warn">
					No broker is connected. <span class="font-mono">EVENT_BUS</span> is unset or noop, so events are
					discarded and no flow receives messages. Set it to nats, kafka or rabbitmq.
				</Alert>
			{/if}
			<!-- One run of text per sentence end: a line break inside the markup
			     before a period renders as a space in front of it. -->
			<p class="text-xs text-muted">
				The broker is configured through <span class="font-mono">EVENT_BUS</span
				>{#if backendSettings.length}{' '}and {backendSettings.join(', ')}{/if}.
				{backendSettings.length
					? 'Set them as environment variables or in the configuration file'
					: 'Set it as an environment variable or in the configuration file'}, and see what each
				setting does on
				<a href="/admin/settings/configuration" class="text-brand hover:underline">Configuration</a>. TLS is on
				by default and a broker's certificate is always verified.
			</p>
		</section>

		{#if data.status.last_error}
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Most recent failure</SectionHeading>
				<!-- The current reason, not every one. A broker that is down produces
				     the same line thousands of times. -->
				<div class="rounded border border-line bg-surface-2 p-3">
					<p class="font-mono text-xs text-danger">{data.status.last_error.error}</p>
					<p class="mt-1 text-xs text-faint">
						Publishing to <span class="font-mono">{data.status.last_error.topic}</span>,
						{formatDateTime(data.status.last_error.at)}
					</p>
				</div>
			</section>
		{/if}
	{/if}
</PageShell>
