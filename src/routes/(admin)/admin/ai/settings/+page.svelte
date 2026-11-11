<script lang="ts">
	import { Alert, Badge, Card, DescriptionList, Input, PageShell, Panel, SectionHeading, Toggle } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import AiSection from '$lib/components/ai/AiSection.svelte';
	import SettingRow from '$lib/components/SettingRow.svelte';
	import { GATE_OK } from '$lib/api/gate';
	import { retentionDays } from '$lib/api/ai';
	import { formatDateTime } from '$lib/format';
	import { couldNotLoad } from '$lib/outage';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The switch as the action last left it, or as the layout read it.
	const settings = $derived(form?.scope === 'switch' && 'settings' in form ? form.settings : data.aiSettings);
	const switchError = $derived(form?.scope === 'switch' && form.error ? form.error : null);
	const configResult = $derived(form?.scope === 'config' ? { key: form.key, error: form.error, success: 'success' in form } : null);

	let enabledForm = $state<HTMLFormElement | null>(null);
	let transcriptsForm = $state<HTMLFormElement | null>(null);
	let assistantForm = $state<HTMLFormElement | null>(null);
	// A plugin older than the switch sends none, and the assistant is on by default.
	const assistantOn = $derived(settings?.assistant_enabled !== false);

	const retention = $derived(data.instance.find((s) => s.key === 'ai_transcript_retention'));
	// The window the plugin applies now. Without the AI license it is fixed,
	// whatever the configuration says, so the configuration is not offered.
	const fixedRetention = $derived(
		settings?.transcript_retention && !settings.transcript_retention.editable ? settings.transcript_retention : null,
	);
	const instanceTranscripts = $derived(data.instance.find((s) => s.key === 'ai_transcripts_enabled'));
</script>

<PageShell title="AI settings" description="Turn AI on or off for this tenant, and choose whether and how long transcripts are kept." width="wide">
	<AiSection level={2} tab="settings" gate={GATE_OK} layoutGate={data.aiLayoutGate} noun="settings">
		{#if settings}
			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>This tenant</SectionHeading>
				<Card>
					<div class="flex flex-col gap-6">
						<form bind:this={enabledForm} method="POST" action="?/save" use:enhance class="flex flex-col gap-3" data-testid="ai-enabled-form">
							<input type="hidden" name="enabled" value={settings.enabled ? 'false' : 'true'} />
							<Toggle
								id="ai-enabled"
								label="AI for this tenant"
								hint="When off, AI routes return 404, flow nodes and the editor assistant stop, and nothing is sent to any provider."
								checked={settings.enabled}
								onchange={() => enabledForm?.requestSubmit()}
							/>
							<Panel pad="sm">
								<div class="text-sm leading-relaxed text-muted" data-testid="what-never-leaves">
									<p class="mb-2 font-medium text-fg">What never leaves this engine</p>
									<p>
										Only the request to the endpoint you configured leaves this engine: the system prompt, the
										conversation and, for image operations, the image. It goes to the vendor behind that endpoint, under
										your agreement with that vendor, and to nobody else. The plugin has no default provider, no hosted
										proxy and no prompt telemetry. LyEve Labs never sees your prompts, responses, keys, transcripts or
										vendor replies, which vendor you use, or whether you use AI at all. A local endpoint on your own
										network sends nothing to a third party. Transcripts are stored in your database for the retention
										window below, and are included in tenant deletion and in data subject export and erasure.
										They are not anonymized, because they never leave your database. Read your vendor's data processing
										agreement and training-use terms. You sign those terms, and the plugin cannot change them.
									</p>
								</div>
							</Panel>
						</form>

						<form bind:this={transcriptsForm} method="POST" action="?/save" use:enhance class="flex flex-col gap-3" data-testid="ai-transcripts-form">
							<input type="hidden" name="transcripts_enabled" value={settings.transcripts_enabled ? 'false' : 'true'} />
							<Toggle
								id="ai-transcripts"
								label="Store transcripts"
								hint="When off, no messages or recaps are stored and requests return no transcript id. Existing transcripts stay until retention removes them."
								checked={settings.transcripts_enabled}
								disabled={!settings.enabled}
								onchange={() => transcriptsForm?.requestSubmit()}
							/>
						</form>

						<form bind:this={assistantForm} method="POST" action="?/save" use:enhance class="flex flex-col gap-3" data-testid="ai-assistant-form">
							<input type="hidden" name="assistant_enabled" value={assistantOn ? 'false' : 'true'} />
							<Toggle
								id="ai-assistant"
								label="Assistant"
								hint="When on, everyone who signs in can ask the assistant, and it can do only what their role allows."
								checked={assistantOn}
								disabled={!settings.enabled}
								onchange={() => assistantForm?.requestSubmit()}
							/>
						</form>

						{#if switchError}
							<Alert tone="danger">{switchError}</Alert>
						{/if}
						<p class="text-xs text-faint">
							{#if settings.updated_at && settings.updated_by}
								Last changed {formatDateTime(settings.updated_at)} by {settings.updated_by}.
							{:else}
								Never changed. AI is on by default.
							{/if}
						</p>
					</div>
				</Card>
			</section>

			<section class="flex flex-col gap-4">
				<SectionHeading level={2}>Retention</SectionHeading>
				<Card>
					{#if fixedRetention}
						<div data-testid="retention-fixed">
							<Input
								id="retention-fixed"
								label="Retention"
								value={retentionDays(fixedRetention.value)}
								hint="On the free tier, transcripts are kept for {retentionDays(fixedRetention.value)}, and the AI license lets you choose how long."
								disabled
								class="sm:max-w-xs"
							/>
						</div>
					{:else}
						<div class="flex flex-col gap-4">
							<p class="text-sm text-muted">
								Retention applies to the whole engine, not one tenant. Every hour, transcripts older than the retention
								window are deleted on every tenant. The minimum is 1h and the default is 720h (30 days).
							</p>
							{#if data.instanceReadable && retention && instanceTranscripts}
								<DescriptionList
									items={[
										{ term: 'Retention', value: `${retention.value} (${retention.source})` },
										{ term: 'Engine transcript switch', value: `${instanceTranscripts.value} (${instanceTranscripts.source})` },
									]}
								/>
							{/if}
							{#if data.isSuperAdmin && retention?.editable}
								<SettingRow
									id="retention"
									name="ai_transcript_retention"
									label="Retention"
									value={retention.value}
									action="?/config"
									saved="Retention saved. It applies from the next hourly cleanup."
									result={configResult}
								/>
							{:else if data.isSuperAdmin && data.instanceReadable}
								<p class="text-xs text-faint">
									<Badge tone="neutral" size="sm">{retention?.source ?? 'default'}</Badge>
									This setting comes from the engine's configuration and cannot be changed here.
								</p>
							{:else if !data.isSuperAdmin}
								<p class="text-xs text-faint">Only a super admin can see and change the retention window.</p>
							{:else}
								<p class="text-xs text-faint">{couldNotLoad('the retention window', { reload: true })}</p>
							{/if}
						</div>
					{/if}
				</Card>
			</section>
		{/if}
	</AiSection>
</PageShell>
