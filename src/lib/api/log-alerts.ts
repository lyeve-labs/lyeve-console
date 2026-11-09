/**
 * The logging plugin's volume alert rules: a rule fires when the entries it
 * watches over its window pass `max_count`, at most once per cooldown, and
 * goes to the live tail, the log and the rule's own channels.
 *
 * Every rule carries an `id`, and each is written on its own:
 * `POST /api/admin/logging/alerts` adds one and names it, and
 * `PUT` and `DELETE /api/admin/logging/alerts/{id}` replace and remove one.
 * The id is also how a masked channel sent back finds the value it stands
 * for. `PUT /api/admin/logging/alerts` still replaces the whole document, and
 * the page uses it only for the cooldown, which belongs to no rule.
 *
 * A super admin reads and writes every rule. A tenant admin reads only the
 * rules scoped to their tenant, with each email shortened, and writes none.
 */
import type { HttpClient } from '@lyeve-labs/client';
import { CHANNEL_KEYS, toChannels, type AlertChannels } from './alert-channels';
import { str } from './narrow';

const LOG_ALERTS_URL = '/api/admin/logging/alerts';

/** The levels a rule can watch. Empty watches every level. */
export const LOG_ALERT_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

export interface LogAlertRule {
	id: string;
	/** Empty for every level. */
	level: string;
	tenant_id: string;
	plugin: string;
	max_count: number;
	/** A duration such as `5m` or `1h`. */
	window: string;
	enabled: boolean;
	channels: AlertChannels;
	/** Answered once, by the write that set a new webhook URL on this rule. */
	webhook_signing_secret?: string;
}

export interface LogAlertConfig {
	thresholds: LogAlertRule[];
	cooldown: string;
	/** Whether the plugin would take a new chat, webhook or PagerDuty channel. */
	licensed: boolean;
}

function toRule(raw: unknown): LogAlertRule {
	const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const secret = str(r.webhook_signing_secret);
	return {
		id: str(r.id),
		level: str(r.level),
		tenant_id: str(r.tenant_id),
		plugin: str(r.plugin),
		max_count: typeof r.max_count === 'number' ? r.max_count : 0,
		window: str(r.window),
		enabled: r.enabled === true,
		channels: toChannels(r.channels),
		...(secret ? { webhook_signing_secret: secret } : {}),
	};
}

export function toLogAlertConfig(raw: unknown): LogAlertConfig {
	const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	return {
		thresholds: Array.isArray(r.thresholds) ? r.thresholds.map(toRule) : [],
		cooldown: str(r.cooldown),
		licensed: r.licensed === true,
	};
}

/** A rule as a write sends it: no answer-only members, the empty ones left out. */
function ruleBody(rule: LogAlertRule): Record<string, unknown> {
	const out: Record<string, unknown> = {
		level: rule.level,
		max_count: rule.max_count,
		window: rule.window,
		enabled: rule.enabled,
	};
	if (rule.id) out.id = rule.id;
	if (rule.tenant_id) out.tenant_id = rule.tenant_id;
	if (rule.plugin) out.plugin = rule.plugin;
	const channels: AlertChannels = {};
	if (rule.channels.email?.length) channels.email = rule.channels.email;
	for (const k of CHANNEL_KEYS) if (rule.channels[k]) channels[k] = rule.channels[k];
	out.channels = channels;
	return out;
}

export async function getLogAlerts(client: HttpClient): Promise<LogAlertConfig> {
	return toLogAlertConfig(await client.get<unknown>(LOG_ALERTS_URL));
}

export async function putLogAlerts(
	client: HttpClient,
	config: { thresholds: LogAlertRule[]; cooldown: string },
): Promise<LogAlertConfig> {
	return toLogAlertConfig(
		await client.put<unknown>(LOG_ALERTS_URL, {
			thresholds: config.thresholds.map(ruleBody),
			...(config.cooldown ? { cooldown: config.cooldown } : {}),
		}),
	);
}

/** The answer of a single-rule write: the rule, and whether a paid channel would be taken. */
export interface LogAlertRuleAnswer {
	rule: LogAlertRule;
	licensed: boolean;
}

function toRuleAnswer(raw: unknown): LogAlertRuleAnswer {
	const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	return { rule: toRule(r), licensed: r.licensed === true };
}

function ruleURL(id: string): string {
	return `${LOG_ALERTS_URL}/${encodeURIComponent(id)}`;
}

/** Adds one rule. The plugin names it, so the body carries no id. */
export async function createLogAlertRule(client: HttpClient, rule: LogAlertRule): Promise<LogAlertRuleAnswer> {
	return toRuleAnswer(await client.post<unknown>(LOG_ALERTS_URL, ruleBody({ ...rule, id: '' })));
}

/** Replaces the rule `id` names. A masked channel sent back keeps what that rule stores. */
export async function updateLogAlertRule(
	client: HttpClient,
	id: string,
	rule: LogAlertRule,
): Promise<LogAlertRuleAnswer> {
	return toRuleAnswer(await client.put<unknown>(ruleURL(id), ruleBody({ ...rule, id })));
}

export async function deleteLogAlertRule(client: HttpClient, id: string): Promise<void> {
	await client.delete(ruleURL(id));
}

/** The code of the 404 for a rule that is gone or that the caller may not read. */
export const LOG_RULE_NOT_FOUND = 'logging.rule_not_found';

/** A duration the plugin parses: a whole number and m, h or d. */
export function isWindow(value: string): boolean {
	return /^\d+[mhd]$/.test(value.trim());
}

/** What a rule watches, in a few words. */
export function ruleScope(rule: LogAlertRule): string {
	const parts = [rule.level ? `${rule.level} entries` : 'All entries'];
	if (rule.tenant_id) parts.push(`tenant ${rule.tenant_id}`);
	if (rule.plugin) parts.push(`plugin ${rule.plugin}`);
	return parts.join(', ');
}
