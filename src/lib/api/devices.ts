/**
 * The device-fingerprint plugin's admin routes.
 *
 * Every route here is the signed-in person's own. The engine reads the user
 * out of the session claims and never takes one from the request, so this is
 * not an operator looking at somebody else's devices: it is a person looking
 * at theirs. That is why the screen lives with the account rather than in the
 * instance settings.
 *
 * Trusting is always the browser making the request. The fingerprint is
 * collected from the request itself, so "trust this device" can only ever mean
 * the one you are using, and a form that offered to trust another would be
 * lying about what the endpoint does.
 */
import type { HttpClient } from '@lyeve-labs/client';
import type { ListEnvelope } from './list';

const DEVICES_URL = '/api/admin/devices';
const TRUST_URL = '/api/admin/devices/trust';

/**
 * One remembered device, as the list route sends it.
 *
 * The fingerprint hash, the address and the tenant are deliberately absent:
 * the engine never serializes them. What identifies a device to its owner is
 * the label they gave it, the browser it was, and when it was last seen.
 *
 * The user agent is optional because an engine whose device plugin predates
 * it sends none, and that says nothing about which browser the device was.
 */
export interface Device {
	id: string;
	user_id: string;
	label: string;
	user_agent?: string;
	last_seen_at: string;
	created_at: string;
}

export async function listDevices(
	client: HttpClient,
	limit: number,
	offset: number
): Promise<ListEnvelope<Device>> {
	return client.get<ListEnvelope<Device>>(`${DEVICES_URL}?limit=${limit}&offset=${offset}`);
}

/** Remembers the browser making this request under a label. */
export async function trustThisDevice(client: HttpClient, label: string): Promise<Device> {
	return client.post<Device>(TRUST_URL, { label });
}

/** Forgets a device. The next sign-in from it is treated as new. */
export async function untrustDevice(client: HttpClient, id: string): Promise<void> {
	await client.post(`${DEVICES_URL}/${encodeURIComponent(id)}/untrust`, {});
}

/**
 * A browser and platform a person recognizes, out of a user agent string.
 *
 * The full string is kept for the title attribute, because this is a guess:
 * every browser lies about being every other browser in that header, and the
 * order below is the order that survives it. A string this cannot read is
 * shown as itself rather than as "Unknown", which would make two different
 * devices look like the same one.
 */
export function deviceName(userAgent: string | undefined): string {
	const ua = userAgent ?? '';
	if (!ua.trim()) return 'Unrecognized device';

	const browser = ua.includes('Edg/')
		? 'Edge'
		: ua.includes('OPR/') || ua.includes('Opera')
			? 'Opera'
			: ua.includes('Firefox/')
				? 'Firefox'
				: ua.includes('Chrome/')
					? 'Chrome'
					: ua.includes('Safari/')
						? 'Safari'
						: '';

	const platform = ua.includes('Android')
		? 'Android'
		: /iPhone|iPad|iPod/.test(ua)
			? 'iOS'
			: ua.includes('Mac OS X') || ua.includes('Macintosh')
				? 'macOS'
				: ua.includes('Windows')
					? 'Windows'
					: ua.includes('Linux')
						? 'Linux'
						: '';

	if (browser && platform) return `${browser} on ${platform}`;
	if (browser) return browser;
	if (platform) return platform;
	return ua.length > 48 ? `${ua.slice(0, 45)}...` : ua;
}

/** What a device is called on screen: the label, or what it looks like. */
export function deviceLabel(d: Device): string {
	return d.label?.trim() ? d.label : deviceName(d.user_agent);
}

/**
 * Whether this row is the browser reading the page.
 *
 * Matched on the user agent because it is the only thing the list and the
 * current request share: the fingerprint hash never leaves the engine. Two
 * identical browsers on one account therefore both match, so the screen says
 * "looks like this device" rather than claiming to know which one it is.
 */
export function looksLikeThisDevice(d: Device, userAgent: string | null | undefined): boolean {
	return !!userAgent && !!d.user_agent && d.user_agent === userAgent;
}
