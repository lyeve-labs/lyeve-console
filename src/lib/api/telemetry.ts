/**
 * The telemetry plugin's admin routes.
 *
 * The scrape route answers Prometheus text exposition, not JSON, so it is
 * read with `fetch` and the session's headers rather than the client, and
 * parsed here into families the page can filter and tabulate. What comes
 * back depends on who asks: a super admin gets the whole gathered registry,
 * a tenant admin only the samples carrying its own tenant label, in the
 * families they came from. The page does not narrow anything itself. The
 * split is the engine's.
 *
 * The exporter list and the manual export describe the instance's export
 * configuration, which no tenant owns, so both are super admin routes and
 * the page never asks for them on a tenant admin's behalf.
 */
import { ApiError, type HttpClient } from '@lyeve-labs/client';

const METRICS_URL = '/api/admin/telemetry/metrics';
const EXPORTERS_URL = '/api/admin/telemetry/exporters';

/** How many exporters one read asks for. The plugin ships five backends. */
const EXPORTER_PAGE = 50;

export interface MetricSample {
	labels: Record<string, string>;
	value: number;
}

export interface MetricFamily {
	name: string;
	help: string;
	type: string;
	samples: MetricSample[];
}

/** One exporter's health as GET /api/admin/telemetry/exporters lists it. */
export interface ExporterHealth {
	name: string;
	healthy: boolean;
	last_export?: string;
	last_error?: string;
	exports: number;
	failures: number;
}

interface ExporterPage {
	data?: ExporterHealth[] | null;
	total_count?: number;
	limit?: number;
	offset?: number;
}

/** What POST .../exporters/{name}/export answers with. */
export interface ExportResult {
	status?: string;
	message?: string;
}

/** How long the scrape may take, the same bound the JSON client sets. */
const METRICS_TIMEOUT_MS = 15_000;

/**
 * Reads the exposition as the session. A tenant admin's answer is already
 * filtered to that tenant's series. `headers` are the session's headers,
 * bearer and CSRF token both, because the JSON client cannot read plain
 * text and this read has to carry the same session every other read does.
 *
 * A refusal throws an ApiError with the body the engine sent, so a 402
 * keeps its upgrade link and a 403 reads as the role it is. A scrape that
 * takes too long throws a TimeoutError, which reads as the engine not
 * answering.
 */
export async function readMetricsText(fetchFn: typeof fetch, headers: Record<string, string>): Promise<string> {
	const res = await fetchFn(METRICS_URL, {
		signal: AbortSignal.timeout(METRICS_TIMEOUT_MS),
		headers: { ...headers, Accept: 'text/plain' },
	});
	if (!res.ok) {
		const text = await res.text();
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			body = undefined;
		}
		const said = (body as { error?: unknown } | undefined)?.error;
		throw new ApiError(res.status, typeof said === 'string' ? said : 'metrics read refused', body);
	}
	return res.text();
}

/** The exporters, in the order the plugin lists them. Super admin only. */
export async function listExporters(client: HttpClient): Promise<ExporterHealth[]> {
	const page = await client.get<ExporterPage | null>(`${EXPORTERS_URL}?offset=0&limit=${EXPORTER_PAGE}`);
	return Array.isArray(page?.data) ? page.data : [];
}

/** A one-shot export for one backend. 429 inside the per-exporter cooldown. */
export function triggerExport(client: HttpClient, name: string): Promise<ExportResult> {
	return client.post<ExportResult>(`${EXPORTERS_URL}/${encodeURIComponent(name)}/export`, undefined);
}

const DESTINATION_URL = '/api/admin/telemetry/destination';

/**
 * Where this tenant's own series are pushed, besides the instance's
 * exporters. Header values usually carry the collector's key, so the read
 * names the headers and never their values. A save that leaves the headers
 * out keeps the stored ones, but only while the URL keeps its scheme and host:
 * the plugin will not carry a key to a host the caller just chose, and
 * answers 422 with the code below instead. Every other refusal of the body
 * is a 422 too, so the code is what tells them apart.
 */
export type DestinationKind = 'otlp' | 'pushgateway';

export const DESTINATION_HEADERS_REQUIRED = 'telemetry.headers_required';

export const DESTINATION_KINDS: readonly { value: DestinationKind; label: string }[] = [
	{ value: 'otlp', label: 'OTLP' },
	{ value: 'pushgateway', label: 'Pushgateway' },
];

export interface DestinationHealth {
	healthy: boolean;
	last_export?: string;
	last_failure?: string;
	last_error?: string;
	exports: number;
	failures: number;
}

export interface TenantDestination {
	kind: DestinationKind;
	url: string;
	header_names: string[];
	health: DestinationHealth | null;
}

export interface DestinationRead {
	destination: TenantDestination | null;
	/** Whether this instance may save or change a destination. Removing one is always allowed. */
	licensed: boolean;
}

export interface SaveDestination {
	kind: DestinationKind;
	url: string;
	/** Absent keeps the stored headers. An empty object clears them. */
	headers?: Record<string, string>;
}

export async function readDestination(client: HttpClient): Promise<DestinationRead> {
	return client.get<DestinationRead>(DESTINATION_URL);
}

export async function saveDestination(client: HttpClient, body: SaveDestination): Promise<DestinationRead> {
	return client.put<DestinationRead>(DESTINATION_URL, body);
}

export async function removeDestination(client: HttpClient): Promise<void> {
	await client.delete(DESTINATION_URL);
}

/** Whether two destination URLs share a scheme and a host, port included. */
export function sameOrigin(a: string, b: string): boolean {
	try {
		const ua = new URL(a);
		const ub = new URL(b);
		return ua.protocol.toLowerCase() === ub.protocol.toLowerCase() && ua.host.toLowerCase() === ub.host.toLowerCase();
	} catch {
		return false;
	}
}

/** Headers the exporter sets itself, which a destination may not override. */
export const RESERVED_HEADERS = [
	'host',
	'content-type',
	'content-length',
	'content-encoding',
	'transfer-encoding',
	'connection',
];

/** An HTTP field name: a token. */
export function headerNameIsSound(name: string): boolean {
	return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name);
}

/**
 * A sample's value as the text format writes it. Prometheus spells the
 * special values as words, and Number() reads none of them.
 */
function sampleValue(raw: string): number {
	switch (raw) {
		case 'NaN':
			return Number.NaN;
		case '+Inf':
		case 'Inf':
			return Number.POSITIVE_INFINITY;
		case '-Inf':
			return Number.NEGATIVE_INFINITY;
		default:
			return Number(raw);
	}
}

/** Label text between braces, with the format's escapes undone. */
function parseLabels(raw: string): Record<string, string> {
	const labels: Record<string, string> = {};
	const re = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(raw)) !== null) {
		labels[m[1]] = m[2].replace(/\\(["\\n])/g, (_, c: string) => (c === 'n' ? '\n' : c));
	}
	return labels;
}

/**
 * The family a sample belongs to. A histogram's `_bucket`, `_sum` and
 * `_count` series and a summary's `_sum` and `_count` are written under the
 * family name, which is what the TYPE line names.
 */
function familyOf(sampleName: string, declared: Set<string>): string {
	if (declared.has(sampleName)) return sampleName;
	for (const suffix of ['_bucket', '_sum', '_count']) {
		if (sampleName.endsWith(suffix)) {
			const base = sampleName.slice(0, -suffix.length);
			if (declared.has(base)) return base;
		}
	}
	return sampleName;
}

/**
 * Prometheus text exposition into families, in the order the registry wrote
 * them. A family with a HELP or TYPE line and no sample is kept so the page
 * can say a series exists and is empty rather than absent, which is what a
 * tenant admin's filtered view otherwise looks like.
 */
export function parseExposition(text: string): MetricFamily[] {
	const families = new Map<string, MetricFamily>();
	const declared = new Set<string>();
	const family = (name: string): MetricFamily => {
		let f = families.get(name);
		if (!f) {
			f = { name, help: '', type: 'untyped', samples: [] };
			families.set(name, f);
		}
		return f;
	};

	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (!line) continue;
		if (line.startsWith('#')) {
			const meta = /^#\s+(HELP|TYPE)\s+(\S+)\s*(.*)$/.exec(line);
			if (!meta) continue;
			declared.add(meta[2]);
			const f = family(meta[2]);
			if (meta[1] === 'HELP') f.help = meta[3];
			else f.type = meta[3].trim() || 'untyped';
			continue;
		}
		const sample = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)(?:\s+\S+)?$/.exec(line);
		if (!sample) continue;
		const name = sample[1];
		const f = family(familyOf(name, declared));
		const labels = sample[2] ? parseLabels(sample[2].slice(1, -1)) : {};
		if (name !== f.name) labels.__series = name.slice(f.name.length + 1);
		f.samples.push({ labels, value: sampleValue(sample[3]) });
	}
	return [...families.values()];
}

/**
 * Families whose name, help or any label value carries the query, case
 * folded. An empty query keeps everything.
 */
export function familiesMatching(families: MetricFamily[], query: string): MetricFamily[] {
	const q = query.trim().toLowerCase();
	if (!q) return families;
	return families.filter(
		(f) =>
			f.name.toLowerCase().includes(q) ||
			f.help.toLowerCase().includes(q) ||
			f.samples.some((s) => Object.values(s.labels).some((v) => v.toLowerCase().includes(q))),
	);
}

/** A sample's labels as the format writes them, so a row reads as the series it is. */
export function labelText(labels: Record<string, string>): string {
	const parts = Object.entries(labels)
		.filter(([k]) => k !== '__series')
		.map(([k, v]) => `${k}="${v}"`);
	return parts.length ? `{${parts.join(',')}}` : '';
}

/** A metric value as the table shows it: integers whole, the rest to four places. */
export function formatMetricValue(v: number): string {
	if (Number.isNaN(v)) return 'NaN';
	if (!Number.isFinite(v)) return v > 0 ? '+Inf' : '-Inf';
	if (Number.isInteger(v)) return String(v);
	return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
