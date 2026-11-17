<script lang="ts" module>
	interface WidgetAPI {
		render(el: HTMLElement, opts: Record<string, unknown>): string | number;
		remove?(id: string | number): void;
	}

	interface RecaptchaAPI {
		ready(fn: () => void): void;
		execute(siteKey: string, opts: { action: string }): Promise<string>;
	}

	type CaptchaWindow = Window & {
		turnstile?: WidgetAPI;
		hcaptcha?: WidgetAPI;
		grecaptcha?: RecaptchaAPI;
	};

	const loading = new Map<string, Promise<void>>();

	/** One script element per URL for the life of the page, however often the widget remounts. */
	function loadScript(src: string): Promise<void> {
		const pending = loading.get(src);
		if (pending) return pending;
		const p = new Promise<void>((resolve, reject) => {
			const el = document.createElement('script');
			el.src = src;
			el.async = true;
			el.addEventListener('load', () => resolve());
			el.addEventListener('error', () => {
				loading.delete(src);
				reject(new Error('captcha script failed to load'));
			});
			document.head.appendChild(el);
		});
		loading.set(src, p);
		return p;
	}

	/** reCAPTCHA tokens expire after two minutes, so a page left open asks for a fresh one before then. */
	const RECAPTCHA_REFRESH_MS = 90_000;
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { Alert } from '@lyeve-labs/ui-kit';
	import { CAPTCHA_ACTION, captchaScriptURL, type CaptchaChallenge } from '#lib/captcha.ts';

	interface Props {
		challenge: CaptchaChallenge;
		/** The token the provider issued, empty until the visitor passes the check. */
		token?: string;
		/** The form field the token is posted as. The engine reads `captcha_token`. */
		name?: string;
	}

	let { challenge, token = $bindable(''), name = 'captcha_token' }: Props = $props();

	let container: HTMLDivElement | undefined = $state();
	let failed = $state(false);

	onMount(() => {
		const w = window as CaptchaWindow;
		let widgetId: string | number | undefined;
		let refresh: ReturnType<typeof setInterval> | undefined;
		let gone = false;
		const { provider, siteKey } = challenge;

		loadScript(captchaScriptURL(challenge))
			.then(() => {
				if (gone) return;
				if (provider === 'recaptcha') {
					const g = w.grecaptcha;
					if (!g) throw new Error('reCAPTCHA did not initialize');
					const ask = () =>
						g.execute(siteKey, { action: CAPTCHA_ACTION }).then(
							(t) => (token = t),
							() => (failed = true)
						);
					g.ready(() => {
						if (gone) return;
						void ask();
						refresh = setInterval(ask, RECAPTCHA_REFRESH_MS);
					});
					return;
				}
				const api = provider === 'turnstile' ? w.turnstile : w.hcaptcha;
				if (!api || !container) throw new Error('captcha widget did not initialize');
				const opts: Record<string, unknown> = {
					sitekey: siteKey,
					callback: (t: string) => (token = t),
					'expired-callback': () => (token = ''),
					'error-callback': () => {
						token = '';
						failed = true;
					},
				};
				if (provider === 'turnstile') opts.action = CAPTCHA_ACTION;
				widgetId = api.render(container, opts);
			})
			.catch(() => (failed = true));

		return () => {
			gone = true;
			if (refresh) clearInterval(refresh);
			const api = provider === 'turnstile' ? w.turnstile : provider === 'hcaptcha' ? w.hcaptcha : undefined;
			if (api?.remove && widgetId !== undefined) api.remove(widgetId);
			token = '';
		};
	});
</script>

<div class="space-y-2" data-captcha={challenge.provider}>
	<input type="hidden" {name} value={token} />
	{#if challenge.provider !== 'recaptcha'}
		<div bind:this={container} class="flex justify-center"></div>
	{/if}
	{#if failed}
		<Alert tone="danger">
			The security check could not load. Check your connection, or allow the check's provider if a browser
			extension blocks it, then reload the page.
		</Alert>
	{/if}
</div>
