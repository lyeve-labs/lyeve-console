<script lang="ts">
	import { formRefusal } from '$lib/api/refusal';
	import { Alert, Button, Card, CopyButton, CopyField, Input, PageShell, PasswordInput, Skeleton } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { Shield } from '@lucide/svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import type { ActionData, PageData } from './$types';
	import { tracked } from '$lib/forms.svelte';
	import { couldNotLoad } from '$lib/outage';
	import { ICON } from '$lib/icon';
	import { passkeyFailure, provePasskey, type ProofOptions } from '$lib/passkey-proof';
	import { tick } from 'svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The QR image, the generator and the placeholder all have to agree on one
	// edge length, so it is stated once.
	const QR_SIZE = 180;

	const setup = tracked(() => {});
	const prove = tracked(() => {});
	const verify = tracked(() => async ({ update }) => update({ reset: false }));
	const disable = tracked(() => {});

	// The step is what the last action answered. A fresh load is the start.
	const step = $derived(form?.step ?? 'idle');
	const uri = $derived(form && 'uri' in form ? (form.uri ?? '') : '');
	const secret = $derived(form && 'secret' in form ? (form.secret ?? '') : '');
	const backupCodes = $derived(form && 'backupCodes' in form ? (form.backupCodes ?? []) : []);
	const actionErrorText = $derived(form && 'error' in form ? form.error : undefined);
	const passwordError = $derived(form && 'passwordError' in form && typeof form.passwordError === 'string' ? form.passwordError : undefined);
	const proofSessionId = $derived(form && 'proofSessionId' in form ? (form.proofSessionId ?? '') : '');
	const proofOptions = $derived(form && 'options' in form ? (form.options as ProofOptions) : undefined);

	// The browser signs the challenge only on a click, so the passkey step has
	// its own button. Its answer goes into the hidden fields and the setup
	// form posts it.
	let assertion = $state('');
	let asking = $state(false);
	let passkeyError = $state('');
	let proofForm: HTMLFormElement | undefined = $state();

	async function usePasskey() {
		if (!proofOptions) return;
		passkeyError = '';
		asking = true;
		try {
			assertion = await provePasskey(proofOptions);
			await tick();
			proofForm?.requestSubmit();
		} catch (e) {
			passkeyError = passkeyFailure(e);
		} finally {
			asking = false;
		}
	}

	let code = $state('');
	let disableCode = $state('');
	let replaceCode = $state('');
	let qrDataUrl = $state('');

	// Only the browser draws the code, so the generator is loaded here and
	// never on the server. qrcode is CommonJS, which the dev server's SSR
	// runner cannot evaluate, and a static import would put the whole page
	// behind it.
	$effect(() => {
		if (!uri) {
			qrDataUrl = '';
			return;
		}
		let current = true;
		import('qrcode')
			.then(({ default: QRCode }) => QRCode.toDataURL(uri, { width: QR_SIZE, margin: 1 }))
			.then((url) => {
				if (current) qrDataUrl = url;
			});
		return () => {
			current = false;
		};
	});

	const mfaEnabled = $derived(data.mfa.ok && data.mfa.value.enabled);
	const hasPasskeys = $derived(data.mfa.ok && data.mfa.value.hasPasskeys);
	const description = $derived(
		!data.mfa.ok ? couldNotLoad('the two-factor status') : mfaEnabled ? 'Enabled on this account.' : 'Not enabled on this account.'
	);
</script>

<PageShell
	title="Two-factor authentication"
	{description}
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	<FormErrors message={actionErrorText || undefined} refused={formRefusal(form)} />

	{#if step === 'done'}
		<Alert tone="success" title="Two-factor authentication is on">
			Save these backup codes somewhere safe. They are not shown again. If the copy fails, write them down before you leave this page.
		</Alert>
		<Card>
			<div class="flex flex-col gap-4">
				<div class="grid grid-cols-2 gap-2">
					{#each backupCodes as backupCode (backupCode)}
						<code class="bg-surface-2 border border-line rounded-lg px-3 py-1 text-xs font-mono text-fg">
							{backupCode}
						</code>
					{/each}
				</div>
				<div class="flex items-center justify-end gap-3">
					<CopyButton value={backupCodes.join('\n')} text="Copy all codes" />
					<Button variant="primary" href="/admin/settings/mfa">Done</Button>
				</div>
			</div>
		</Card>
	{:else if step === 'proving'}
		<Card>
			<form method="POST" action="?/setup" use:enhance={setup.enhance} bind:this={proofForm} class="flex flex-col gap-4">
				<input type="hidden" name="proof_session_id" value={proofSessionId} />
				<input type="hidden" name="assertion" value={assertion} />
				<p class="text-fg text-sm">
					Confirm it is you with one of this account's passkeys. The authenticator app setup starts after that.
				</p>
				{#if passkeyError}
					<Alert tone="danger">{passkeyError}</Alert>
				{/if}
				<div class="flex justify-end gap-3">
					<Button variant="secondary" href="/admin/settings/mfa">Cancel</Button>
					<Button type="button" variant="primary" onclick={usePasskey} loading={asking || setup.pending}>
						Use a passkey
					</Button>
				</div>
			</form>
		</Card>
	{:else if step === 'confirming'}
		<Card>
			<form method="POST" action="?/verify" use:enhance={verify.enhance} class="flex flex-col gap-5">
				<input type="hidden" name="uri" value={uri} />
				<input type="hidden" name="secret" value={secret} />
				<p class="text-fg text-sm">
					Scan this QR code in an authenticator app, or enter the secret by hand.
				</p>
				<!-- The code carries the same secret as the field below it, and that
				     field is the accessible equivalent, so the image is decorative. -->
				<div class="flex justify-center">
					{#if qrDataUrl}
						<img
							src={qrDataUrl}
							alt=""
							data-testid="totp-qr"
							class="rounded-lg border border-line"
							width={QR_SIZE}
							height={QR_SIZE}
						/>
					{:else}
						<Skeleton
							width="{QR_SIZE}px"
							height="{QR_SIZE}px"
							rounded="rounded-lg"
							class="border border-line"
						/>
					{/if}
				</div>
				<CopyField id="totp-secret" label="Manual entry secret" value={secret} copyLabel="Copy the manual entry secret" />
				<Input
					id="totp-code"
					name="code"
					label="The 6-digit code from the app"
					required
					bind:value={code}
					placeholder="123456"
					autocomplete="one-time-code"
					inputmode="numeric"
					maxlength={6}
				/>
				<div class="flex justify-end">
					<Button type="submit" variant="primary" disabled={code.length < 6} loading={verify.pending}>
						Verify and turn on
					</Button>
				</div>
			</form>
		</Card>
	{:else if step === 'password'}
		<Card>
			<form method="POST" action="?/setup" use:enhance={setup.enhance} class="flex flex-col gap-4">
				<p class="text-fg text-sm">
					Confirm it is you with your password. You signed in too long ago to turn on two-factor authentication without it.
				</p>
				<PasswordInput
					id="first-factor-password"
					name="password"
					label="Password"
					autocomplete="current-password"
					required
					error={passwordError}
				/>
				<div class="flex justify-end gap-3">
					<Button variant="secondary" href="/admin/settings/mfa">Cancel</Button>
					<Button type="submit" variant="primary" loading={setup.pending}>
						<Shield size={ICON.sm} aria-hidden="true" />
						Turn on two-factor authentication
					</Button>
				</div>
			</form>
		</Card>
	{:else if step === 'signIn'}
		<!-- Signing out first, because the sign-in page sends a signed-in
		     reader straight back here without a new sign-in. -->
		<Alert tone="warn">
			<p>Sign in again to add a second factor.</p>
			<form method="POST" action="/logout" class="mt-3">
				<Button type="submit" variant="secondary" size="sm">Sign in again</Button>
			</form>
		</Alert>
	{:else if !data.mfa.ok}
		<GateNotice level={2} gate={data.mfa.gate} title="Two-factor authentication" absent="Two-factor authentication is not included in this build." />
	{:else if hasPasskeys}
		<Alert tone="success" title="Two-factor authentication is on">
			This account has a passkey, so signing in takes a second factor. While a passkey is registered, this page cannot show whether an authenticator app is also set up.
		</Alert>
		<Card>
			<div class="flex flex-col gap-4">
				<p class="text-fg text-sm">
					Set up an authenticator app as well. Confirm it is you first, with a passkey or with a code. If an app is already
					set up, the new key replaces it once you verify a code.
				</p>
				<form method="POST" action="?/prove" use:enhance={prove.enhance} class="flex justify-end">
					<Button type="submit" variant="secondary" loading={prove.pending}>
						Confirm with a passkey
					</Button>
				</form>
				<form method="POST" action="?/setup" use:enhance={setup.enhance} class="flex flex-col gap-4">
					<Input
						id="replace-code"
						name="code"
						label="Or enter a code"
						hint="A current code from an authenticator app already set up, or a backup code."
						bind:value={replaceCode}
						autocomplete="one-time-code"
					/>
					<div class="flex justify-end">
						<Button type="submit" variant="secondary" disabled={replaceCode.trim().length === 0} loading={setup.pending}>
							<Shield size={ICON.sm} aria-hidden="true" />
							Set up with this code
						</Button>
					</div>
				</form>
			</div>
		</Card>
		<Card>
			<form method="POST" action="?/disable" use:enhance={disable.enhance} class="flex flex-col gap-4">
				<Input
					id="dis-code"
					name="code"
					label="Code"
					hint="A current code from the authenticator app, or a backup code. This turns off the app only. Passkeys stay."
					bind:value={disableCode}
					autocomplete="one-time-code"
				/>
				<div class="flex justify-end">
					<Button type="submit" variant="danger" disabled={disableCode.trim().length === 0} loading={disable.pending}>
						Turn off the authenticator app
					</Button>
				</div>
			</form>
		</Card>
	{:else if mfaEnabled}
		<Alert tone="success" title="Two-factor authentication is on">
			Signing in to this account takes a code from the authenticator app.
		</Alert>
		<Card>
			<form method="POST" action="?/setup" use:enhance={setup.enhance} class="flex flex-col gap-4">
				<p class="text-fg text-sm">
					Move to another authenticator app. The new key replaces the current one once you verify a code from it.
				</p>
				<Input
					id="replace-code"
					name="code"
					label="Code"
					hint="A current code from the authenticator app, or a backup code."
					bind:value={replaceCode}
					autocomplete="one-time-code"
				/>
				<div class="flex justify-end">
					<Button type="submit" variant="secondary" disabled={replaceCode.trim().length === 0} loading={setup.pending}>
						<Shield size={ICON.sm} aria-hidden="true" />
						Replace the authenticator app
					</Button>
				</div>
			</form>
		</Card>
		<Card>
			<form method="POST" action="?/disable" use:enhance={disable.enhance} class="flex flex-col gap-4">
				<Input
					id="dis-code"
					name="code"
					label="Code"
					hint="A current code from the authenticator app, or a backup code."
					bind:value={disableCode}
					autocomplete="one-time-code"
				/>
				<div class="flex justify-end">
					<Button type="submit" variant="danger" disabled={disableCode.trim().length === 0} loading={disable.pending}>
						Turn off
					</Button>
				</div>
			</form>
		</Card>
	{:else}
		<Card>
			<form method="POST" action="?/setup" use:enhance={setup.enhance} class="flex flex-col gap-4">
				<p class="text-fg text-sm">Two-factor authentication is off for this account.</p>
				<div class="flex justify-end">
					<Button type="submit" variant="primary" loading={setup.pending}>
						<Shield size={ICON.sm} aria-hidden="true" />
						Turn on two-factor authentication
					</Button>
				</div>
			</form>
		</Card>
	{/if}
</PageShell>
