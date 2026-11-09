<script lang="ts">
	import { fieldErrors, submitter } from '$lib/forms.svelte';
	import { passwordTooLong } from '$lib/api/users';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import {
		Alert,
		Button,
		Card,
		CopyButton,
		CopyField,
		Input,
		PageShell,
		PasswordInput,
		SectionHeading,
		Spinner,
		StepIndicator,
	} from '@lyeve-labs/ui-kit';
	import { ICON } from '$lib/icon';
	import type { SetupModeStatus } from '$lib/api/setup';
	import type { ActionData, PageData } from './$types';
	import type { SubmitFunction } from '@sveltejs/kit';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/** How often the screen asks the engine again while it waits on it. */
	const POLL_MS = 3000;

	const steps = [
		{ label: 'Configure', description: 'Database and secrets' },
		{ label: 'Restart', description: 'Load the new settings' },
		{ label: 'Create admin', description: 'The first super admin' },
	];

	// The status a token read returned. It is kept here and not in the action
	// result alone, so the secrets stay on screen while the page polls for the
	// restart. Nothing else stores them.
	let modeStatus = $state<SetupModeStatus | null>(null);
	$effect(() => {
		if (form && 'status' in form && form.status) modeStatus = form.status as SetupModeStatus;
	});

	const missingDatabase = $derived(modeStatus?.missing.some((m) => m.env === 'DATABASE_URL') ?? false);
	const generatedSecrets = $derived(modeStatus?.missing.filter((m) => m.generated) ?? []);
	// StepIndicator counts from 1.
	const currentStep = $derived(data.state === 'needs_admin' ? 3 : modeStatus ? 2 : 1);
	const polling = $derived(data.state === 'unreachable' || (data.state === 'setup_mode' && modeStatus !== null));

	// Waiting on the engine is the one thing this screen cannot do for the
	// operator, so it re-runs the load until the state moves on.
	$effect(() => {
		if (!polling) return;
		const id = setInterval(() => void invalidateAll(), POLL_MS);
		return () => clearInterval(id);
	});

	const tokenHint = $derived(
		data.tokenSource === 'env'
			? "The value of LYEVE_SETUP_TOKEN in the engine's environment."
			: 'Find it in the output the engine wrote when it started, on the line that holds setup_token, for example with: docker logs <engine container> 2>&1 | grep setup_token. Copy the value that follows setup_token.',
	);

	const formError = $derived(form && 'error' in form ? (form.error as string) : null);
	const serverFields = $derived(fieldErrors(form));

	// The browser's own bubble for a `required` field disappears on the next
	// click and is never announced a second time, so the page validates before
	// submitting and keeps the message in the document instead.
	let errors = $state<Record<string, string>>({});

	// Reading order, so focus lands on the first rejected field rather than the
	// first one the object happens to enumerate.
	const FIELDS = ['setup_token', 'email', 'password', 'confirm'] as const;

	function validate(target: HTMLFormElement): boolean {
		const fd = new FormData(target);
		const setupToken = String(fd.get('setup_token') ?? '').trim();
		const email = String(fd.get('email') ?? '').trim();
		const password = String(fd.get('password') ?? '');
		const confirm = String(fd.get('confirm') ?? '');

		const found: Record<string, string> = {};
		if (!setupToken) found.setup_token = 'Enter the setup token.';
		if (!email) found.email = 'Enter your email.';
		// The rules are the engine's password policy, which an install can
		// change. The engine names the rule a refused password broke, so the
		// page states no rule of its own that could disagree with it.
		if (!password) found.password = 'Enter a password.';
		else if (passwordTooLong(password)) found.password = passwordTooLong(password) ?? '';
		if (!confirm) found.confirm = 'Enter the password again.';
		else if (password && confirm !== password) found.confirm = 'The passwords do not match.';

		errors = found;
		if (Object.keys(found).length === 0) return true;

		// A field message is wired to its control through aria-describedby, which
		// a screen reader reads when that control takes focus. Moving focus is
		// what makes the rejection audible at all, and it puts the caret where
		// the correction has to be typed.
		const first = FIELDS.find((field) => found[field]);
		if (first) target.querySelector<HTMLInputElement>(`#${first}`)?.focus();
		return false;
	}

	const create = submitter();

	// SvelteKit's enhance posts the form whatever an onsubmit handler decided,
	// so a refused form is canceled here, the one place enhance asks before it
	// sends.
	const createAdmin: SubmitFunction = (input) => {
		if (!validate(input.formElement)) {
			input.cancel();
			return;
		}
		return create.enhance(input);
	};
	const read = submitter();
</script>

<PageShell width="narrow" title="Set up LyEve" documentTitle="Set up" description="Finish configuring the engine and create the first super admin.">
	<div class="space-y-6">
		<StepIndicator {steps} current={currentStep} />

		{#if formError}
			<Alert tone="danger">{formError}</Alert>
		{/if}

		{#if data.state === 'unreachable'}
			<Card pad="lg">
				<div class="space-y-4" data-state="unreachable">
					<SectionHeading level={2}>Waiting for the engine</SectionHeading>
					<p class="text-muted">
						Could not reach the engine. If it is starting or restarting, this page continues once it is up. If
						this lasts, check that the engine is running and that the console's CORE_INTERNAL_URL points at it.
					</p>
					<p class="flex items-center gap-2 text-sm text-muted" role="status">
						<Spinner size={ICON.sm} />
						Checking again every few seconds.
					</p>
				</div>
			</Card>
		{:else if data.state === 'setup_mode' && !modeStatus}
			<Card pad="lg">
				<form method="POST" action="?/status" use:enhance={read.enhance} class="space-y-5" data-state="setup-mode">
					<SectionHeading level={2}>The engine is missing settings</SectionHeading>
					<p class="text-muted">
						The engine started in setup mode and shows only this screen until its configuration is complete.
						Enter the setup token to see what to set.
					</p>
					{#if data.tokenSource === null}
						<Alert tone="warn">
							This engine has no setup token, so setup cannot continue. Set LYEVE_SETUP_TOKEN in its environment and
							restart it, or restart it to print a new one-time token to its log.
						</Alert>
					{/if}
					<PasswordInput id="setup_token" name="setup_token" label="Setup token" autocomplete="off" required hint={tokenHint} />
					<Button type="submit" variant="primary" full loading={read.pending}>Show what to set</Button>
				</form>
			</Card>
		{:else if data.state === 'setup_mode' && modeStatus}
			<Card pad="lg">
				<div class="space-y-5" data-state="configure">
					<SectionHeading level={2}>Set these, then restart the engine</SectionHeading>
					<ul class="space-y-2 text-sm text-fg">
						{#if missingDatabase}
							<li data-missing="database">
								<span class="font-medium">Database.</span>
								<span class="text-muted">
									DATABASE_URL points the engine at PostgreSQL, MySQL or SQL Server. Replace the placeholder with your
									own connection string.
								</span>
							</li>
						{/if}
						{#each generatedSecrets as secret (secret.env)}
							<li data-missing="secret">
								<span class="font-medium">{secret.env}.</span>
								<span class="text-muted">A new random value for it is shown below.</span>
							</li>
						{/each}
					</ul>

					{#if modeStatus.secrets_included}
						<Alert tone="warn">
							These secrets are shown only once. Copy them now and store them with the engine's settings.
							The engine does not save them, so they are gone after it restarts.
						</Alert>
					{:else if generatedSecrets.length > 0}
						<Alert tone="warn">
							The generated secrets were already shown once. Restart the engine to generate new ones, or set values
							of your own.
						</Alert>
					{/if}

					<div class="space-y-2">
						<div class="flex items-center justify-between gap-3">
							<SectionHeading level={3}>Environment variables</SectionHeading>
							<CopyButton value={modeStatus.env} label="Copy" />
						</div>
						<pre class="overflow-x-auto rounded-md border border-line bg-surface-2 p-3 text-xs text-fg" data-block="env">{modeStatus.env}</pre>
					</div>

					<div class="space-y-2">
						<div class="flex items-center justify-between gap-3">
							<SectionHeading level={3}>Or in lyeve.yaml</SectionHeading>
							<CopyButton value={modeStatus.yaml} label="Copy" />
						</div>
						<pre class="overflow-x-auto rounded-md border border-line bg-surface-2 p-3 text-xs text-fg" data-block="yaml">{modeStatus.yaml}</pre>
					</div>

					<div class="space-y-2">
						<SectionHeading level={3}>Restart the engine</SectionHeading>
						<p class="text-sm text-muted">The engine cannot restart itself. Use the command for how you run it:</p>
						<ul class="space-y-2">
							{#each modeStatus.restart as step (step.label)}
								<li><CopyField label={step.label} value={step.command} wrap /></li>
							{/each}
						</ul>
					</div>

					<p class="flex items-center gap-2 text-sm text-muted" role="status" data-state="waiting">
						<Spinner size={ICON.sm} />
						Waiting for the engine to restart with its settings.
					</p>
				</div>
			</Card>
		{:else}
			<Card pad="lg">
				<form
					method="POST"
					action="?/create"
					novalidate
					use:enhance={createAdmin}
					class="space-y-5"
					data-state="create-admin"
				>
					<Alert tone="success">The engine is configured and its database is reachable.</Alert>
					<SectionHeading level={2}>Create the first super admin</SectionHeading>
					{#if data.tokenSource === null}
						<Alert tone="warn">
							This engine has no setup token, so setup cannot continue. Set LYEVE_SETUP_TOKEN in its environment and
							restart it, or restart it to print a new one-time token to its log.
						</Alert>
					{:else if data.tokenSource === 'log'}
						<p class="text-sm text-muted">
							If the engine restarted since you last read its log, it printed a new token. Use the latest one.
						</p>
					{/if}

					<PasswordInput
						id="setup_token"
						name="setup_token"
						label="Setup token"
						autocomplete="off"
						required
						hint={tokenHint}
						error={errors.setup_token}
					/>

					<Input
						id="email"
						name="email"
						type="email"
						label="Email"
						placeholder="admin@example.com"
						autocomplete="email"
						required
						error={errors.email}
					/>

					<PasswordInput
						id="password"
						name="password"
						label="Password"
						autocomplete="new-password"
						required
						hint="It must meet the engine's password policy. If it breaks a rule, you'll see which one."
						error={errors.password ?? serverFields.password}
					/>

					<PasswordInput
						id="confirm"
						name="confirm"
						label="Confirm password"
						autocomplete="new-password"
						required
						error={errors.confirm}
					/>

					<Button type="submit" variant="primary" full loading={create.pending}>Create super admin account</Button>
				</form>
			</Card>
		{/if}
	</div>
</PageShell>
