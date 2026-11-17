<script lang="ts">
	import { Alert, Badge, Breadcrumb, Button, Card, DescriptionList, PageShell, SectionHeading, Stat, type AccentTone } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { crumbsAfter } from '#lib/breadcrumb.ts';
	import { FileJson, FileText, Sparkles } from '@lucide/svelte';
	import type { ActionData, PageData } from './$types';
	import AiSection from '#lib/components/ai/AiSection.svelte';
	import { useCaseLabel } from '#lib/components/ai/use-case.ts';
	import { transcriptTotals } from '#lib/api/ai.ts';
	import { formatCount, formatDateTime } from '#lib/format.ts';
	import { ICON } from '#lib/icon.ts';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const back = { href: '/admin/ai/transcripts', label: 'Transcripts' };
	const t = $derived(data.transcript);
	const totals = $derived(transcriptTotals(t?.messages));
	// The recap the action just wrote shows at once. The stored one after a reload.
	const recap = $derived(form?.recap ?? t?.recap ?? '');
	let recapping = $state(false);

	const facts = $derived(
		t
			? [
					{ term: 'Kind', value: t.kind.replace('_', ' ') },
					{ term: 'Model', value: t.model || 'none' },
					{ term: 'Prompt', value: t.prompt_use_case ? `${useCaseLabel(t.prompt_use_case)}, version ${t.prompt_version}` : 'none' },
					{ term: 'Caller', value: t.caller || t.created_by || 'unknown' },
					{ term: 'Subject', value: t.subject_kind ? `${t.subject_kind} ${t.subject_id ?? ''}`.trim() : 'none' },
					{ term: 'Provider', value: t.provider_id ?? 'none' },
					{ term: 'Created', value: formatDateTime(t.created_at) },
				]
			: []
	);

	function roleTone(role: string): AccentTone {
		if (role === 'user') return 'brand';
		if (role === 'assistant') return 'violet';
		if (role === 'system') return 'warn';
		return 'neutral';
	}
</script>

<PageShell title="Transcript" description={t ? formatDateTime(t.created_at) : ''} width="wide" {back}>
	{#snippet breadcrumb()}
		<Breadcrumb items={crumbsAfter(back, [{ label: 'AI', href: '/admin/ai' }, { label: 'Transcripts', href: '/admin/ai/transcripts' }, { label: t ? t.id.slice(0, 8) : 'Transcript' }])} />
	{/snippet}
	{#snippet actions()}
		{#if t}
			<Button href="/admin/ai/transcripts/{t.id}/export?format=json" download="transcript-{t.id}.json" variant="secondary" size="sm">
				<FileJson size={ICON.sm} aria-hidden="true" /> JSON
			</Button>
			<Button href="/admin/ai/transcripts/{t.id}/export?format=markdown" download="transcript-{t.id}.md" variant="secondary" size="sm">
				<FileText size={ICON.sm} aria-hidden="true" /> Markdown
			</Button>
		{/if}
	{/snippet}

	<AiSection level={2} tab="transcripts" gate={data.gate} layoutGate={data.aiLayoutGate} noun="transcripts">
		{#if t}
			<div class="grid grid-cols-2 gap-4 md:grid-cols-4">
				<Stat size="sm" mono label="Messages" value={t.messages?.length ?? t.message_count} />
				<Stat size="sm" mono label="Tokens in" value={formatCount(totals.tokens_in)} />
				<Stat size="sm" mono label="Tokens out" value={formatCount(totals.tokens_out)} />
				<Stat size="sm" mono label="Cost" value="${totals.cost.toFixed(4)}" sub="estimated from the price table" />
			</div>

			<DescriptionList items={facts} />

			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Messages</SectionHeading>
				{#if !t.messages || t.messages.length === 0}
					<p class="text-sm text-muted">This transcript has no messages.</p>
				{:else}
					<ol class="flex flex-col gap-3" aria-label="Messages">
						{#each t.messages as m (m.id)}
							<li>
								<Card pad="sm">
									<div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-faint">
										<Badge tone={roleTone(m.role)} size="sm">{m.role}</Badge>
										<span>#{m.seq}</span>
										{#if m.role === 'assistant'}
											<span>{m.tokens_in} in, {m.tokens_out} out, {m.latency_ms} ms, ${m.cost_estimate}</span>
										{/if}
										<span class="ms-auto">{formatDateTime(m.created_at)}</span>
									</div>
									<pre class="whitespace-pre-wrap font-sans text-sm text-fg">{m.content}</pre>
								</Card>
							</li>
						{/each}
					</ol>
				{/if}
			</section>

			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>
					Recap
					{#snippet actions()}
						<form
							method="POST"
							action="?/recap"
							use:enhance={() => {
								recapping = true;
								return async ({ update }) => {
									recapping = false;
									await update({ reset: false });
								};
							}}
						>
							<Button variant="secondary" size="sm" type="submit" loading={recapping} disabled={!t.messages || t.messages.length === 0}>
								<Sparkles size={ICON.sm} aria-hidden="true" /> {recap ? 'Recap again' : 'Recap'}
							</Button>
						</form>
					{/snippet}
				</SectionHeading>
				{#if form?.error}
					<Alert tone="danger">{form.error}</Alert>
				{/if}
				{#if recap}
					<Card pad="sm">
						<pre class="whitespace-pre-wrap font-sans text-sm text-fg" data-testid="recap">{recap}</pre>
					</Card>
				{:else}
					<p class="text-sm text-muted">
						No recap yet. Recap asks the same provider for a short summary and saves it on this transcript. The
						recap request adds its own cost to this transcript.
					</p>
				{/if}
			</section>
		{/if}
	</AiSection>
</PageShell>
