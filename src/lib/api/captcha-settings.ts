/**
 * The captcha plugin's tenant settings.
 *
 * A tenant may bring its own captcha provider and keys for the pages and
 * flows it serves. The admin login is not one of them: it always challenges
 * with the instance's own settings, so a tenant that misconfigures its keys
 * cannot lock its admins out. The read never carries the secret, only whether
 * one is stored, and a save that leaves the secret empty keeps the stored one.
 */
import type { HttpClient } from '@lyeve-labs/client';

const CAPTCHA_SETTINGS_URL = '/api/admin/captcha/settings';

export type CaptchaProvider = 'turnstile' | 'hcaptcha' | 'recaptcha';

export const CAPTCHA_PROVIDERS: readonly { value: CaptchaProvider; label: string }[] = [
	{ value: 'turnstile', label: 'Turnstile' },
	{ value: 'hcaptcha', label: 'hCaptcha' },
	{ value: 'recaptcha', label: 'reCAPTCHA' },
];

export interface CaptchaWidget {
	provider: string;
	site_key: string;
	enabled: boolean;
}

export interface TenantCaptcha {
	provider: CaptchaProvider;
	site_key: string;
	has_secret: boolean;
	/** reCAPTCHA v3 only: the lowest score a check passes with. Null is the provider's default. */
	score_floor: number | null;
	/** The failed-attempt count that calls for a captcha. Null is the instance threshold. */
	failure_threshold?: number | null;
}

export interface CaptchaSettings {
	/** Which settings this tenant's flows verify with. */
	source: 'tenant' | 'instance';
	tenant: TenantCaptcha | null;
	instance: CaptchaWidget;
	/** Whether this instance may save or change tenant settings. Clearing is always allowed. */
	licensed: boolean;
}

export interface SaveCaptchaSettings {
	provider: CaptchaProvider;
	site_key: string;
	/** Empty keeps the stored secret. */
	secret_key: string;
	score_floor: number | null;
	/**
	 * The plugin stores whatever the body carries here, absent as null, so a
	 * save sends back the threshold it read rather than clearing it.
	 */
	failure_threshold: number | null;
}

export async function readCaptchaSettings(client: HttpClient): Promise<CaptchaSettings> {
	return client.get<CaptchaSettings>(CAPTCHA_SETTINGS_URL);
}

export async function saveCaptchaSettings(client: HttpClient, body: SaveCaptchaSettings): Promise<CaptchaSettings> {
	return client.put<CaptchaSettings>(CAPTCHA_SETTINGS_URL, body);
}

export async function clearCaptchaSettings(client: HttpClient): Promise<void> {
	await client.delete(CAPTCHA_SETTINGS_URL);
}

export function isCaptchaProvider(v: string): v is CaptchaProvider {
	return CAPTCHA_PROVIDERS.some((p) => p.value === v);
}

export function providerLabel(v: string): string {
	return CAPTCHA_PROVIDERS.find((p) => p.value === v)?.label ?? (v || 'None');
}
