import { text } from './narrow';
import { plural } from '../format';
/**
 * The alert channels every monitoring plugin offers, in the one shape they
 * all answer and accept: email recipients, a Slack and a Discord URL, a
 * signed HTTPS webhook and a PagerDuty routing key.
 *
 * The URLs and the routing key are credentials, so every answer masks them to
 * the host and the last four characters. A form shows the masked value as it
 * was read and sends it back unchanged, and the plugin reads a masked value as
 * "keep the one stored". Clearing a field removes that channel.
 *
 * Email works on every instance. A plugin may refuse a new or changed chat,
 * webhook or PagerDuty channel with 402, and some plugins say beforehand
 * whether they would, through `licensed` on their own read.
 */

export interface AlertChannels {
	email?: string[];
	slack_url?: string;
	discord_url?: string;
	webhook_url?: string;
	/** Whether the stored webhook signs its deliveries. Answers only. */
	webhook_signed?: boolean;
	pagerduty_routing_key?: string;
}

/** The members a form writes, beside the email list. */
export const CHANNEL_KEYS = ['slack_url', 'discord_url', 'webhook_url', 'pagerduty_routing_key'] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

/** Whether a setting names anywhere to send. */
export function hasChannels(c: AlertChannels | null | undefined): boolean {
	return !!c && ((c.email?.length ?? 0) > 0 || CHANNEL_KEYS.some((k) => !!c[k]));
}

/** The emails a form field holds, one per comma or line. */
export function parseEmails(raw: string): string[] {
	return raw
		.split(/[\n,]/)
		.map((e) => e.trim())
		.filter(Boolean);
}

/** A channels object as a plugin answered it, with every member typed. */
export function toChannels(raw: unknown): AlertChannels {
	const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const out: AlertChannels = {};
	const email = Array.isArray(r.email) ? r.email.filter((e): e is string => typeof e === 'string' && !!e) : [];
	if (email.length) out.email = email;
	for (const k of CHANNEL_KEYS) {
		const v = text(r[k]);
		if (v) out[k] = v;
	}
	if (r.webhook_signed === true) out.webhook_signed = true;
	return out;
}

/**
 * The channels a form posted under `prefix`, with every empty member left
 * out. The result carries only what a write sends, never `webhook_signed`.
 */
export function channelsFrom(form: FormData, prefix: string): AlertChannels {
	const out: AlertChannels = {};
	const email = parseEmails(String(form.get(`${prefix}email`) ?? ''));
	if (email.length) out.email = email;
	for (const k of CHANNEL_KEYS) {
		const v = String(form.get(`${prefix}${k}`) ?? '').trim();
		if (v) out[k] = v;
	}
	return out;
}

/** The one-line summary a list row shows for a setting. */
export function channelSummary(c: AlertChannels | null | undefined): string {
	if (!c || !hasChannels(c)) return 'No channels';
	const parts: string[] = [];
	const n = c.email?.length ?? 0;
	if (n) parts.push(`${n} ${plural(n, 'email')}`);
	if (c.slack_url) parts.push('Slack');
	if (c.discord_url) parts.push('Discord');
	if (c.webhook_url) parts.push('Webhook');
	if (c.pagerduty_routing_key) parts.push('PagerDuty');
	return parts.join(', ');
}
