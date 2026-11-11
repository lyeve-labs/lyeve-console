import type { HttpClient } from '@lyeve-labs/client';
import { section, type Section } from '$lib/api/gate';
import { NO_VALUE, formatBytes, formatCount } from '$lib/format';
import type { Params, RecommendationWarning } from '$lib/api/runtime-words';

/**
 * The engine's runtime and scaling settings, as served under
 * /api/admin/runtime. Every shape the routes send or take is declared here,
 * so a change to the contract is one edit.
 */
const ROOT = '/api/admin/runtime';

/**
 * Where a value in force came from. The panel words each one, and a source
 * it does not know is shown without a line rather than guessed.
 */
export type SettingSource = 'environment' | 'file' | 'console' | 'container' | 'machine' | 'default' | 'running';

/** One setting as the engine runs it. */
export interface RuntimeSetting {
	/** A number for the counts and sizes, a string for the pooler, null where none is in force. */
	value: unknown;
	/** The CPU or memory setting's mode, absent for the others. */
	mode?: CpuChoice['mode'] | MemoryChoice['mode'];
	/** The share of the memory limit in ratio and automatic mode. */
	ratio?: number;
	source: SettingSource | string;
	/** The environment variable or configuration file key that set it. */
	variable?: string;
	/** The deployment holds the value, so a write for it is refused. */
	pinned: boolean;
	/** It follows the container or the machine while the engine runs. */
	live: boolean;
	/** It takes effect only when the engine starts. */
	start_only: boolean;
}

/**
 * One fact about the machine or the database. Unknown carries a reason code,
 * never a zero. The route's English reason is left out, because the panel
 * words the code itself.
 */
export interface RuntimeFact {
	value: unknown;
	known: boolean;
	source?: string;
	reason_code?: string;
	/** The grant the database account lacks, on `missing_grant`. */
	grant?: string;
}

export interface RuntimeReplicas {
	count: number;
	/** False when no roster reports the count, so it reads as one. */
	known: boolean;
	attached: boolean;
	/** How many replicas run the latest revision. */
	applied: number;
}

export interface RuntimeSettingsMap {
	cpu?: RuntimeSetting;
	memory?: RuntimeSetting;
	gc_percent?: RuntimeSetting;
	database_max_connections?: RuntimeSetting;
	replica_max_connections?: RuntimeSetting;
	backpressure?: RuntimeSetting;
	pooler?: RuntimeSetting;
}

/** What GET and PUT /api/admin/runtime/settings return. */
export interface RuntimeSettingsAnswer {
	/** False on an engine that offers no runtime settings at all. */
	available: boolean;
	/** Whether the install's license lets the writes and the recommendations through. */
	licensed: boolean;
	/** False when a write lasts only until the engine restarts. */
	stored: boolean;
	revision: number;
	settings: RuntimeSettingsMap;
	facts: Record<string, RuntimeFact>;
	replicas: RuntimeReplicas;
	/** Set on a PUT answer when the new pool takes more than a third of the database's connections. */
	warning?: string;
}

export type CpuChoice = { mode: 'automatic' } | { mode: 'fixed'; threads: number };

export type MemoryChoice =
	| { mode: 'automatic' }
	| { mode: 'ratio'; ratio: number }
	| { mode: 'bytes'; bytes: number }
	| { mode: 'none' };

/** What a rule read to reach its value. Absent when it read nothing. */
export interface RecommendationRuleInputs {
	replicas?: number;
	connection_limit?: number;
	share?: number;
	database_cores?: number;
	database_cores_typed?: boolean;
	cpu_limit?: number;
	limit?: number;
	limit_source?: string;
}

/** One recommended value with the rule that produced it and the code that says why. */
export interface Recommended<T> {
	value: T;
	rule: string;
	reason_code?: string;
	/** The numbers the code's sentence states, empty when it states none. */
	params?: Params;
	inputs?: RecommendationRuleInputs;
}

/** The four values a preset or a recommendation fills, in the shapes the PUT takes. The pool is absent on an engine with no database. */
export interface PresetValues {
	cpu?: Recommended<CpuChoice>;
	memory?: Recommended<MemoryChoice>;
	gc_percent?: Recommended<number>;
	database_max_connections?: Recommended<number>;
}

export type PresetKey = 'one_server' | 'several_replicas';

/** What GET /api/admin/runtime/recommendations returns. */
export interface RecommendationsAnswer {
	facts: Record<string, RuntimeFact>;
	presets: Partial<Record<PresetKey, PresetValues>>;
	recommended: PresetValues;
	/** Cautions, each a code and the numbers its sentence states. Empty when there are none. */
	warnings: RecommendationWarning[];
}

/** What PUT /api/admin/runtime/settings takes. A key left out is not changed. */
export interface RuntimeSettingsBody {
	revision: number;
	cpu?: CpuChoice;
	memory?: MemoryChoice;
	gc_percent?: number;
	database_max_connections?: number;
}

/** The values typed to refine the recommendations, each a positive whole number. */
export interface RecommendationInputs {
	replicas?: number;
	database_cores?: number;
}

/** The bounds the engine enforces, so the form can refuse before the round trip. */
export const MEMORY_PERCENT = { min: 50, max: 95 } as const;
export const MEMORY_MB_MIN = 64;
export const GC_PERCENT_MIN = -1;
export const POOL_CONNECTIONS = { min: 5, max: 10000 } as const;

const MIB = 1024 * 1024;

/** A soft limit at or above this is no limit: the engine sends the largest int64. */
const NO_LIMIT = 2 ** 62;

/** The facts the panel shows, in order, with how each value reads. */
export const FACTS: { key: string; label: string; kind: 'count' | 'cores' | 'bytes' | 'flag' }[] = [
	{ key: 'cpu_limit', label: 'CPU limit', kind: 'cores' },
	{ key: 'host_cores', label: 'Host cores', kind: 'count' },
	{ key: 'memory_limit', label: 'Memory limit', kind: 'bytes' },
	{ key: 'host_memory', label: 'Host memory', kind: 'bytes' },
	{ key: 'connection_limit', label: 'Database connection limit', kind: 'count' },
	{ key: 'connections_open', label: 'Database connections open', kind: 'count' },
	{ key: 'database_cores', label: 'Database cores', kind: 'count' },
	{ key: 'shared_cache', label: 'Shared cache', kind: 'flag' },
];

const SOURCE_LABELS: Record<string, string> = {
	file: 'Configuration file',
	console: 'Console setting',
	container: 'Container limit',
	machine: 'This machine',
	default: 'Default',
	running: 'Changed on the running engine',
};

/** The line under a value saying where it came from, or empty for a source the panel does not know. */
export function sourceLabel(s: RuntimeSetting | undefined): string {
	if (!s) return '';
	if (s.source === 'environment') return s.variable ? `Environment variable ${s.variable}` : 'Environment variable';
	if (s.source === 'file' && s.variable) return `Configuration file key ${s.variable}`;
	return SOURCE_LABELS[s.source] ?? '';
}

/** The hint on a field the deployment holds, saying where to change it by source. */
export function pinnedText(variable: string | undefined, source?: string): string {
	if (source === 'file') {
		return variable
			? `Set by ${variable} in the configuration file. Change it there, then restart the engine.`
			: 'Set in the configuration file. Change it there, then restart the engine.';
	}
	return variable
		? `Set by ${variable}. Change it where the engine is deployed, then restart the engine.`
		: 'Set where the engine is deployed. Change it there, then restart the engine.';
}

/** The hint on a value that takes effect only at start, with where it came from. */
export function startOnlyText(s: RuntimeSetting | undefined): string {
	if (s?.source === 'environment' && s.variable) return `Set by ${s.variable}. Applies when the engine starts.`;
	if (s?.source === 'file' && s.variable) return `Set by ${s.variable} in the configuration file. Applies when the engine starts.`;
	const from = sourceLabel(s);
	return from ? `${from}. Applies when the engine starts.` : 'Applies when the engine starts.';
}

/** A finite number, or null. */
export const numberOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const num = numberOf;

/** A memory size in bytes, or "None" for the value that means no limit. */
export function formatMemory(v: unknown): string {
	const n = num(v);
	if (n === null) return NO_VALUE;
	if (n >= NO_LIMIT) return 'None';
	return formatBytes(n);
}

/** The connection pooler's values as a reader sees them. Another value is a name and shows as sent. */
const POOLERS: Record<string, string> = { none: 'None', pgbouncer: 'PgBouncer', proxysql: 'ProxySQL' };

/** A setting's value in force as the panel shows it. */
export function formatSetting(key: keyof RuntimeSettingsMap, s: RuntimeSetting | undefined): string {
	if (!s) return NO_VALUE;
	const v = s.value;
	if (key === 'memory') return formatMemory(v);
	if (key === 'gc_percent') {
		const n = num(v);
		if (n === null) return NO_VALUE;
		return n < 0 ? 'Off' : `${n}%`;
	}
	if (key === 'backpressure') {
		const n = num(v);
		if (v === null || v === false || n === 0) return 'Off';
		return n === null ? NO_VALUE : formatCount(n);
	}
	if (key === 'pooler' && typeof v === 'string' && v) return POOLERS[v] ?? v;
	if (typeof v === 'string') return v || NO_VALUE;
	return formatCount(num(v));
}

/** A fact's value as the panel shows it, or "Not available" when it could not be read. */
export function formatFact(kind: (typeof FACTS)[number]['kind'], f: RuntimeFact | undefined): string {
	if (!f || !f.known) return 'Not available';
	if (kind === 'flag') return f.value ? 'Yes' : 'No';
	if (kind === 'bytes') return formatMemory(f.value);
	const n = num(f.value);
	if (n === null) return NO_VALUE;
	return kind === 'cores' && !Number.isInteger(n) ? String(Math.round(n * 100) / 100) : formatCount(n);
}

export function formatCpuChoice(c: CpuChoice): string {
	return c.mode === 'fixed' ? `${formatCount(c.threads)} threads` : 'Automatic';
}

export function formatMemoryChoice(c: MemoryChoice): string {
	if (c.mode === 'ratio') return `${Math.round(c.ratio * 100)}% of the limit`;
	if (c.mode === 'bytes') return formatBytes(c.bytes);
	if (c.mode === 'none') return 'None';
	return 'Automatic';
}

const MEMORY_MODES: readonly MemoryChoice['mode'][] = ['automatic', 'ratio', 'bytes', 'none'];

/** The CPU form's opening mode, as the value in force reports it. */
export function cpuModeOf(s: RuntimeSetting | undefined): CpuChoice['mode'] {
	return s?.mode === 'fixed' ? 'fixed' : 'automatic';
}

/** The memory form's opening state, read from the value in force. */
export interface MemoryFields {
	mode: MemoryChoice['mode'];
	percent: number;
	mb: number;
}

/** The memory form's opening state: the mode and share in force, and the size when one is. */
export function memoryFields(s: RuntimeSetting | undefined): MemoryFields {
	const bytes = num(s?.value);
	const ratio = num(s?.ratio);
	const share = ratio !== null && ratio > 0 ? Math.round(ratio * 100) : 85;
	const percent = Math.min(MEMORY_PERCENT.max, Math.max(MEMORY_PERCENT.min, share));
	const mb = bytes !== null && bytes < NO_LIMIT ? Math.max(MEMORY_MB_MIN, Math.round(bytes / MIB)) : 1024;
	const mode = MEMORY_MODES.find((m) => m === s?.mode) ?? 'automatic';
	return { mode, percent, mb };
}

/** The memory form's state for a choice a preset fills in. */
export function memoryFieldsOf(c: MemoryChoice, current: MemoryFields): MemoryFields {
	if (c.mode === 'ratio') return { ...current, mode: 'ratio', percent: Math.round(c.ratio * 100) };
	if (c.mode === 'bytes') return { ...current, mode: 'bytes', mb: Math.max(MEMORY_MB_MIN, Math.round(c.bytes / MIB)) };
	return { ...current, mode: c.mode };
}

/** A query parameter as a positive whole number, or undefined. */
export function positiveInt(raw: string | null): number | undefined {
	if (!raw) return undefined;
	const n = Number(raw);
	return Number.isInteger(n) && n > 0 ? n : undefined;
}

export interface RuntimeRead {
	settings: Section<RuntimeSettingsAnswer>;
	/** Null when there is nothing to recommend: unlicensed, unavailable or unread. */
	recommendations: Section<RecommendationsAnswer> | null;
}

/**
 * What the panel gets for a reader who is not a super admin. Both runtime
 * reads are refused to every other role, so the load makes neither.
 */
export const RUNTIME_FORBIDDEN: RuntimeRead = { settings: { ok: false, gate: { state: 'forbidden' } }, recommendations: null };

/**
 * The settings, and the recommendations when the settings say the license
 * lets them through. The recommendations take the typed replica count and
 * database cores, so a reader can refine them.
 */
export async function readRuntime(client: HttpClient, inputs: RecommendationInputs): Promise<RuntimeRead> {
	const settings = await section(
		client.get<RuntimeSettingsAnswer>(`${ROOT}/settings`),
		'Could not load runtime settings.',
	);
	if (!settings.ok || !settings.value.available || !settings.value.licensed) return { settings, recommendations: null };
	const query = new URLSearchParams();
	if (inputs.replicas) query.set('replicas', String(inputs.replicas));
	if (inputs.database_cores) query.set('database_cores', String(inputs.database_cores));
	const qs = query.toString();
	const recommendations = await section(
		client.get<RecommendationsAnswer>(`${ROOT}/recommendations${qs ? `?${qs}` : ''}`),
		'Could not load the recommendations.',
	);
	return { settings, recommendations };
}

export function putRuntimeSettings(client: HttpClient, body: RuntimeSettingsBody): Promise<RuntimeSettingsAnswer> {
	return client.put<RuntimeSettingsAnswer>(`${ROOT}/settings`, body);
}

const text = (data: FormData, key: string): string | null => {
	const v = data.get(key);
	return v === null ? null : String(v).trim();
};

/** A refusal of the form, with the posted field it belongs to when it belongs to one. */
export type RuntimeFormError = { error: string; field?: string };

/** A whole number within the bounds, or the one sentence that says what to enter in that field. */
function whole(data: FormData, field: string, min: number, max: number | undefined, message: string): { n: number } | RuntimeFormError {
	const raw = text(data, field) ?? '';
	const n = Number(raw);
	if (!raw || !Number.isInteger(n) || n < min || (max !== undefined && n > max)) return { error: message, field };
	return { n };
}

/**
 * What the form sends. Only a field the reader changed carries a name, so a
 * value they left alone keeps its source rather than becoming a console
 * setting.
 */
export function parseRuntimeForm(data: FormData): { body: RuntimeSettingsBody } | RuntimeFormError {
	const rawRevision = text(data, 'revision');
	const revision = Number(rawRevision);
	if (!rawRevision || !Number.isInteger(revision) || revision < 0) return { error: 'Could not save the settings. Reload the page and try again.' };
	const body: RuntimeSettingsBody = { revision };

	const cpuMode = text(data, 'cpu_mode');
	if (cpuMode === 'automatic') body.cpu = { mode: 'automatic' };
	else if (cpuMode === 'fixed') {
		const t = whole(data, 'cpu_threads', 1, undefined, 'Enter a whole number of threads, 1 or more.');
		if ('error' in t) return t;
		body.cpu = { mode: 'fixed', threads: t.n };
	}

	const memoryMode = text(data, 'memory_mode');
	if (memoryMode === 'automatic' || memoryMode === 'none') body.memory = { mode: memoryMode };
	else if (memoryMode === 'ratio') {
		const p = whole(data, 'memory_percent', MEMORY_PERCENT.min, MEMORY_PERCENT.max, `Enter a share between ${MEMORY_PERCENT.min} and ${MEMORY_PERCENT.max}.`);
		if ('error' in p) return p;
		body.memory = { mode: 'ratio', ratio: p.n / 100 };
	} else if (memoryMode === 'bytes') {
		const m = whole(data, 'memory_mb', MEMORY_MB_MIN, undefined, `Enter a size of at least ${MEMORY_MB_MIN} MB.`);
		if ('error' in m) return m;
		body.memory = { mode: 'bytes', bytes: m.n * MIB };
	}

	if (text(data, 'gc_percent') !== null) {
		const g = whole(data, 'gc_percent', GC_PERCENT_MIN, undefined, `Enter a GC target of ${GC_PERCENT_MIN} or more.`);
		if ('error' in g) return g;
		body.gc_percent = g.n;
	}

	if (text(data, 'database_max_connections') !== null) {
		const p = whole(
			data,
			'database_max_connections',
			POOL_CONNECTIONS.min,
			POOL_CONNECTIONS.max,
			`Enter between ${formatCount(POOL_CONNECTIONS.min)} and ${formatCount(POOL_CONNECTIONS.max)} connections.`,
		);
		if ('error' in p) return p;
		body.database_max_connections = p.n;
	}

	if (Object.keys(body).length === 1) return { error: 'Change a setting first.' };
	return { body };
}
