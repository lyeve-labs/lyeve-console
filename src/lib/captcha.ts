/**
 * The sign-in challenge the engine asks for after repeated failed attempts.
 *
 * The captcha plugin answers a challenged login with `captcha_required`, the
 * public site key and the provider that key belongs to. The console renders
 * that provider's widget and posts the token it yields back with the next
 * attempt. Without the widget a challenged user cannot sign in from here until
 * the plugin's failure window passes.
 */

export type CaptchaProvider = 'turnstile' | 'hcaptcha' | 'recaptcha';

export interface CaptchaChallenge {
	provider: CaptchaProvider;
	siteKey: string;
}

const PROVIDERS: readonly CaptchaProvider[] = ['turnstile', 'hcaptcha', 'recaptcha'];

/**
 * The challenge carried by a refused login body, or null when there is none.
 *
 * A body that names no provider reads as Turnstile, the provider a plugin
 * that does not send the field uses. A provider this console cannot
 * render is also null: offering a widget that never yields a token would look
 * like a working form and refuse every submit.
 */
export function challengeFrom(body: unknown): CaptchaChallenge | null {
	if (!body || typeof body !== 'object') return null;
	const b = body as Record<string, unknown>;
	if (b.captcha_required !== true) return null;
	const siteKey = typeof b.captcha_site_key === 'string' ? b.captcha_site_key.trim() : '';
	if (!siteKey) return null;
	const named = typeof b.captcha_provider === 'string' ? b.captcha_provider.trim().toLowerCase() : '';
	const provider = (named || 'turnstile') as CaptchaProvider;
	if (!PROVIDERS.includes(provider)) return null;
	return { provider, siteKey };
}

/**
 * The script each provider serves its widget from. Turnstile and hCaptcha are
 * rendered explicitly into a container the page owns. reCAPTCHA v3 has no
 * visible widget and is keyed by the site key in the script URL itself.
 *
 * Each origin here is also allowed by the console's Content-Security-Policy in
 * vite.config.ts, and a provider added here needs its origins added there.
 */
export function captchaScriptURL(challenge: CaptchaChallenge): string {
	switch (challenge.provider) {
		case 'turnstile':
			return 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
		case 'hcaptcha':
			return 'https://js.hcaptcha.com/1/api.js?render=explicit';
		case 'recaptcha':
			return `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(challenge.siteKey)}`;
	}
}

/** The action label a provider that labels tokens attaches to this one. */
export const CAPTCHA_ACTION = 'login';
