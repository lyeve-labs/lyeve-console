/**
 * The pii-mask plugin's admin routes.
 *
 * The presets are compiled in and read-only: a tenant may replace one by
 * writing a rule with the same name, and may not edit the preset itself, so a
 * typo cannot break email masking for every response at once. A tenant's own
 * rules are read and written here. The access log is who looked at unmasked
 * data and when.
 *
 * A tenant admin sees its own tenant's access log. A super admin sees every
 * tenant's, which the plugin decides, not this page.
 */
import type { HttpClient } from '@lyeve-labs/client';

const RULES_URL = '/api/admin/pii/rules';
const ACCESS_LOG_URL = '/api/admin/pii/access-log';

/** One redaction rule as the plugin publishes it. */
export interface RedactionRule {
	name: string;
	description?: string;
	pattern: string;
	replacement: string;
	priority: number;
}

/** One of this tenant's own rules. */
export interface CustomRule {
	id: string;
	tenant_id?: string;
	name: string;
	description?: string;
	pattern: string;
	replacement: string;
	priority: number;
	enabled: boolean;
	created_at?: string;
	updated_at?: string;
}

/** What a rule looks like before it has been saved. */
export interface RuleDraft {
	name: string;
	description?: string;
	pattern: string;
	replacement: string;
	priority: number;
	enabled: boolean;
}

/** What GET /api/admin/pii/rules answers. */
export interface RuleCatalog {
	presets: RedactionRule[];
	custom?: CustomRule[] | null;
	limits?: { max_pattern_length: number; max_enabled_rules: number };
	mask_tags: Record<string, string>;
}

/** What the dry run answers. It stores nothing. */
export type RuleTestResult =
	| { valid: false; error: string }
	| { valid: true; matches: string[]; count: number; masked: string };

/** One look at unmasked data. */
export interface AccessEntry {
	id: string;
	viewer_user_id: string;
	viewer_role?: string;
	pii_type: string;
	record_type?: string;
	record_id?: string | null;
	accessed_at: string;
	tenant_id?: string;
}

interface Page<T> {
	data?: T[] | null;
	total_count?: number;
}

export async function getRules(client: HttpClient): Promise<RuleCatalog> {
	return client.get<RuleCatalog>(RULES_URL);
}

export async function createRule(client: HttpClient, draft: RuleDraft): Promise<CustomRule> {
	return client.post<CustomRule>(RULES_URL, draft);
}

export async function updateRule(
	client: HttpClient,
	id: string,
	draft: RuleDraft,
): Promise<CustomRule> {
	return client.put<CustomRule>(`${RULES_URL}/${encodeURIComponent(id)}`, draft);
}

export async function deleteRule(client: HttpClient, id: string): Promise<void> {
	await client.delete<void>(`${RULES_URL}/${encodeURIComponent(id)}`);
}

/**
 * Run a pattern against a sample without storing anything.
 *
 * A redaction rule is invisible when it is right and silent when it is wrong,
 * so there has to be somewhere to find out which it is before it runs over real
 * traffic. This is that place, and it is why the feature is one people will
 * turn on.
 */
export async function testRule(
	client: HttpClient,
	pattern: string,
	replacement: string,
	sample: string,
): Promise<RuleTestResult> {
	return client.post<RuleTestResult>(`${RULES_URL}/test`, { pattern, replacement, sample });
}

/**
 * The presets a tenant has replaced, by name.
 *
 * A custom rule whose name matches a preset takes its place, so the preset list
 * has to say which of its rows are no longer running or it reads as a promise
 * the engine is not keeping.
 */
export function overriddenPresets(custom: CustomRule[]): Set<string> {
	return new Set(custom.map((r) => r.name.toUpperCase()));
}

export async function listAccessLog(
	client: HttpClient,
	limit: number,
	offset: number,
): Promise<Page<AccessEntry>> {
	return client.get<Page<AccessEntry>>(`${ACCESS_LOG_URL}?limit=${limit}&offset=${offset}`);
}

/**
 * The rules in the order they are applied.
 *
 * Priority decides which rule wins where two patterns overlap, and lower runs
 * first. The route answers them in whatever order the preset table holds, so
 * a page that drew them straight would suggest the wrong precedence.
 */
export function inApplyOrder(rules: RedactionRule[]): RedactionRule[] {
	return [...rules].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

/**
 * How often each kind of data was looked at.
 *
 * The log is one row per look, so a page listing rows alone answers "when"
 * and never "what is being read most".
 */
export function byType(entries: AccessEntry[]): { type: string; looks: number }[] {
	const counts = new Map<string, number>();
	for (const e of entries) counts.set(e.pii_type, (counts.get(e.pii_type) ?? 0) + 1);
	return [...counts.entries()]
		.map(([type, looks]) => ({ type, looks }))
		.sort((a, b) => b.looks - a.looks || a.type.localeCompare(b.type));
}

/**
 * A pattern short enough for a table cell.
 *
 * A redaction regex is long by nature, and one that wraps pushes every other
 * column off the row.
 */
export function shortPattern(pattern: string, max = 48): string {
	return pattern.length > max ? `${pattern.slice(0, Math.max(0, max - 3))}...` : pattern;
}
