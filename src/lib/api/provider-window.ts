/**
 * How long an account a tenant's identity provider created may sign in
 * without that provider.
 *
 * Such an account can also sign in by password, reset its password or ask for
 * an email link, but only within this many days of its last sign-in through
 * the provider. Removing a person in the provider so closes every other way in
 * once the window passes. The engine reads and writes the request's tenant,
 * for its admin or a super admin, and records every change in the audit log.
 */
import type { HttpClient } from '@lyeve-labs/client';

const PROVIDER_WINDOW_URL = '/api/admin/auth/provider-window';

/** The window when a tenant has never set one. */
export const PROVIDER_WINDOW_DEFAULT_DAYS = 30;
/** The longest window the engine stores. */
export const PROVIDER_WINDOW_MAX_DAYS = 365;

export interface ProviderWindow {
	/** Whole days. 0 allows sign-in through the provider only. */
	days: number;
}

export function readProviderWindow(client: HttpClient): Promise<ProviderWindow> {
	return client.get<ProviderWindow>(PROVIDER_WINDOW_URL);
}

export function saveProviderWindow(client: HttpClient, days: number): Promise<ProviderWindow> {
	return client.put<ProviderWindow>(PROVIDER_WINDOW_URL, { days });
}

/**
 * The days a form field holds, or null when the engine would refuse them: a
 * whole number from 0 to the most it stores. Checked before sending, so the
 * engine never sees a value it refuses.
 */
export function parseWindowDays(raw: string): number | null {
	const text = raw.trim();
	if (!/^\d+$/.test(text)) return null;
	const days = Number(text);
	return days <= PROVIDER_WINDOW_MAX_DAYS ? days : null;
}
