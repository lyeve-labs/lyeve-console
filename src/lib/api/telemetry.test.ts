import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import {
	familiesMatching,
	formatMetricValue,
	labelText,
	listExporters,
	parseExposition,
	readMetricsText,
	triggerExport,
} from './telemetry';

const EXPOSITION = `# HELP lyeve_db_pool_max_connections Maximum open connections.
# TYPE lyeve_db_pool_max_connections gauge
lyeve_db_pool_max_connections 25
# HELP lyeve_requests_total Requests served.
# TYPE lyeve_requests_total counter
lyeve_requests_total{code="2xx",method="GET",plugin="core",tenant="acme"} 1204
lyeve_requests_total{code="2xx",method="GET",plugin="core",tenant="globex"} 77
# HELP lyeve_request_duration_seconds Request latency.
# TYPE lyeve_request_duration_seconds histogram
lyeve_request_duration_seconds_bucket{le="0.005",tenant="acme"} 980
lyeve_request_duration_seconds_bucket{le="+Inf",tenant="acme"} 1204
lyeve_request_duration_seconds_sum{tenant="acme"} 3.25
lyeve_request_duration_seconds_count{tenant="acme"} 1204
# HELP lyeve_build_info Build information.
# TYPE lyeve_build_info gauge
lyeve_build_info{dialect="postgres",version="1.4.0"} 1
odd_value NaN
escaped{msg="a \\"quoted\\" \\\\ value"} 1
`;

describe('parseExposition', () => {
	it('groups samples under the family the TYPE line names, in registry order', () => {
		const families = parseExposition(EXPOSITION);
		expect(families.map((f) => f.name)).toEqual([
			'lyeve_db_pool_max_connections',
			'lyeve_requests_total',
			'lyeve_request_duration_seconds',
			'lyeve_build_info',
			'odd_value',
			'escaped',
		]);
		const requests = families[1];
		expect(requests.type).toBe('counter');
		expect(requests.help).toBe('Requests served.');
		expect(requests.samples).toHaveLength(2);
		expect(requests.samples[0].labels).toEqual({ code: '2xx', method: 'GET', plugin: 'core', tenant: 'acme' });
		expect(requests.samples[0].value).toBe(1204);
	});

	// A histogram is one family: its bucket, sum and count series are written
	// under the family name and the page lists them as one card.
	it('folds a histogram into one family and keeps which series each row is', () => {
		const hist = parseExposition(EXPOSITION).find((f) => f.name === 'lyeve_request_duration_seconds');
		expect(hist?.type).toBe('histogram');
		expect(hist?.samples.map((s) => s.labels.__series)).toEqual(['bucket', 'bucket', 'sum', 'count']);
		expect(hist?.samples[1].labels.le).toBe('+Inf');
		expect(hist?.samples[2].value).toBeCloseTo(3.25);
	});

	it('reads the special values and undoes the label escapes', () => {
		const families = parseExposition(EXPOSITION);
		expect(Number.isNaN(families.find((f) => f.name === 'odd_value')?.samples[0].value)).toBe(true);
		expect(families.find((f) => f.name === 'escaped')?.samples[0].labels.msg).toBe('a "quoted" \\ value');
		expect(parseExposition('x +Inf\ny -Inf\n').map((f) => f.samples[0].value)).toEqual([
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
		]);
	});

	it('keeps a declared family with no sample, and answers empty text as no family', () => {
		const families = parseExposition('# HELP empty Nothing yet.\n# TYPE empty gauge\n');
		expect(families).toEqual([{ name: 'empty', help: 'Nothing yet.', type: 'gauge', samples: [] }]);
		expect(parseExposition('')).toEqual([]);
		expect(parseExposition('\n\n# a comment\n')).toEqual([]);
	});
});

describe('familiesMatching', () => {
	const families = parseExposition(EXPOSITION);

	it('keeps everything on an empty query', () => {
		expect(familiesMatching(families, '  ')).toBe(families);
	});

	it('matches the name, the help and a label value, case folded', () => {
		expect(familiesMatching(families, 'POOL').map((f) => f.name)).toEqual(['lyeve_db_pool_max_connections']);
		expect(familiesMatching(families, 'latency').map((f) => f.name)).toEqual(['lyeve_request_duration_seconds']);
		expect(familiesMatching(families, 'globex').map((f) => f.name)).toEqual(['lyeve_requests_total']);
		expect(familiesMatching(families, 'nothing-here')).toEqual([]);
	});
});

describe('the row text', () => {
	it('writes labels as the format does and hides the series marker', () => {
		expect(labelText({ code: '2xx', tenant: 'acme', __series: 'bucket' })).toBe('{code="2xx",tenant="acme"}');
		expect(labelText({})).toBe('');
	});

	it('formats a value as the table shows it', () => {
		expect(formatMetricValue(1204)).toBe('1204');
		expect(formatMetricValue(3.25)).toBe('3.25');
		expect(formatMetricValue(0.000123456)).toBe('0.0001');
		expect(formatMetricValue(Number.NaN)).toBe('NaN');
		expect(formatMetricValue(Number.POSITIVE_INFINITY)).toBe('+Inf');
	});
});

// One exporter's health as the plugin encodes it. Its times are Go time
// values, which JSON writes as the zero time rather than leaving them out.
const PUSHGATEWAY = {
	name: 'pushgateway',
	healthy: true,
	last_export: '2026-10-14T09:00:00Z',
	last_failure: '0001-01-01T00:00:00Z',
	exports: 3,
	failures: 0,
};

const SESSION = { Authorization: 'Bearer tok', 'X-CSRF-Token': 'csrf-tok' };

describe('the routes', () => {
	it('scrapes the metrics route with the session headers and a text accept', async () => {
		const fetchFn = vi.fn(async () => new Response('x 1\n', { status: 200 })) as unknown as typeof fetch;
		expect(await readMetricsText(fetchFn, SESSION)).toBe('x 1\n');
		expect(fetchFn).toHaveBeenCalledWith(
			'/api/admin/telemetry/metrics',
			expect.objectContaining({
				headers: { Authorization: 'Bearer tok', 'X-CSRF-Token': 'csrf-tok', Accept: 'text/plain' },
			}),
		);
	});

	it('bounds the scrape so an engine that never answers reads as an outage', async () => {
		const fetchFn = vi.fn(async () => new Response('x 1\n', { status: 200 })) as unknown as typeof fetch;
		await readMetricsText(fetchFn, SESSION);
		const init = vi.mocked(fetchFn).mock.calls[0][1];
		expect(init?.signal).toBeInstanceOf(AbortSignal);
	});

	it('lets a refused scrape reach the caller with its status, message and body', async () => {
		const refusal = { error: 'instance-wide metrics need super_admin', code: 'forbidden' };
		const fetchFn = vi.fn(async () => new Response(JSON.stringify(refusal), { status: 403 })) as unknown as typeof fetch;
		await expect(readMetricsText(fetchFn, SESSION)).rejects.toMatchObject({
			status: 403,
			message: 'instance-wide metrics need super_admin',
			body: refusal,
		});
	});

	it('lists the exporters off the paginated answer and posts a manual export by name', async () => {
		const client = {
			get: vi.fn(async () => ({ data: [PUSHGATEWAY], limit: 50, offset: 0, total_count: 1 })),
			post: vi.fn(async () => ({ status: 'ok', message: 'export triggered for pushgateway' })),
		} as unknown as HttpClient;
		expect(await listExporters(client)).toEqual([PUSHGATEWAY]);
		expect(client.get).toHaveBeenCalledWith('/api/admin/telemetry/exporters?offset=0&limit=50');
		await triggerExport(client, 'push/gateway');
		expect(client.post).toHaveBeenCalledWith('/api/admin/telemetry/exporters/push%2Fgateway/export', undefined);
	});

	it('answers an engine with no exporter as an empty list', async () => {
		const client = { get: vi.fn(async () => ({ data: [], limit: 50, offset: 0, total_count: 0 })) } as unknown as HttpClient;
		expect(await listExporters(client)).toEqual([]);
	});
});
