import { describe, expect, it, vi } from 'vitest';
import {
	listCodes,
	listEvents,
	firstSeenWithin,
	severityTone,
	sourceLabel,
	stillFiring,
	triageOrder,
	unacknowledged,
	type ErrorAlert,
} from './error-tracking';

const NOW = new Date('2026-09-23T12:00:00Z');

function alert(over: Partial<ErrorAlert> = {}): ErrorAlert {
	return {
		id: 'a1',
		fingerprint: 'fp1',
		error_code_id: 'c1',
		source_file: 'internal/db/pool.go',
		source_line: 42,
		message_sample: 'connection refused',
		error_count: 100,
		first_seen: '2026-09-20T00:00:00Z',
		last_seen: '2026-09-23T11:58:00Z',
		acknowledged: false,
		acknowledged_by: '',
		created_at: '2026-09-20T00:00:00Z',
		...over,
	};
}

describe('what is worth looking at', () => {
	it('counts distinct failures, not events', () => {
		const rows = [alert(), alert({ id: 'a2', acknowledged: true })];
		expect(unacknowledged(rows)).toHaveLength(1);
	});

	// A new fingerprint is a new failure, which is different from an old one
	// getting louder.
	it('separates a new failure from an old one getting louder', () => {
		const old = alert({ first_seen: '2026-01-01T00:00:00Z', error_count: 900_000 });
		const fresh = alert({ id: 'a2', first_seen: '2026-09-23T06:00:00Z', error_count: 3 });
		expect(firstSeenWithin([old, fresh], 24, NOW).map((a) => a.id)).toEqual(['a2']);
	});

	// An acknowledged alert still firing is seen, not resolved.
	it('reports an acknowledged alert as still happening when it is', () => {
		expect(stillFiring(alert({ acknowledged: true }), 15, NOW)).toBe(true);
		expect(stillFiring(alert({ last_seen: '2026-09-23T09:00:00Z' }), 15, NOW)).toBe(false);
		expect(stillFiring(alert({ last_seen: 'not a date' }), 15, NOW)).toBe(false);
	});
});

describe('triage order', () => {
	// Ordering by count puts a loud old problem above a new one, which hides
	// an outage that started ten minutes ago.
	it('puts unacknowledged first, then what is still happening', () => {
		const loudOld = alert({ id: 'loud', acknowledged: true, error_count: 900_000, last_seen: '2026-09-23T11:59:00Z' });
		const quietNew = alert({ id: 'new', error_count: 2, last_seen: '2026-09-23T11:59:30Z' });
		const staleOpen = alert({ id: 'stale', error_count: 5, last_seen: '2026-09-20T00:00:00Z' });

		expect(triageOrder([loudOld, staleOpen, quietNew], NOW).map((a) => a.id)).toEqual([
			'new',
			'stale',
			'loud',
		]);
	});
});

describe('presentation', () => {
	it('cites a source the way a reader would', () => {
		expect(sourceLabel(alert())).toBe('internal/db/pool.go:42');
		expect(sourceLabel(alert({ source_line: 0 }))).toBe('internal/db/pool.go');
		expect(sourceLabel(alert({ source_file: '' }))).toBe('Source unknown');
	});

	it('marks the severities that mean somebody should act', () => {
		expect(severityTone('CRITICAL')).toBe('danger');
		expect(severityTone('ERROR')).toBe('danger');
		expect(severityTone('WARN')).toBe('warn');
		expect(severityTone('INFO')).toBe('brand');
		expect(severityTone('')).toBe('neutral');
	});
});

describe('the event list', () => {
	const client = (body: unknown) => ({ get: async () => body }) as never;

	it('reads the window the engine reads, in days', async () => {
		const page = await listEvents(client({ data: [], total_count: 0, hidden_older: 3, window_days: 30 }), 50);
		expect(page).toMatchObject({ hiddenOlder: 3, windowDays: 30 });
	});

	it('reads a null window as every event read', async () => {
		const page = await listEvents(client({ data: [], total_count: 0, hidden_older: 0, window_days: null }), 50);
		expect(page.windowDays).toBeNull();
	});
});

describe('the code catalog', () => {
	// The plugin serves 50 codes unless asked for more. An alert whose code
	// sat past the first page read as an unclassified failure.
	it('reads every page of the catalog', async () => {
		const codes = Array.from({ length: 620 }, (_, i) => ({ id: `c${i}` }));
		const get = vi.fn(async (url: string) => {
			const q = new URL(url, 'http://x').searchParams;
			const offset = Number(q.get('offset'));
			const limit = Number(q.get('limit'));
			return { data: codes.slice(offset, offset + limit), total_count: codes.length, limit, offset };
		});
		const out = await listCodes({ get } as never);
		expect(out.data).toHaveLength(620);
		expect(get).toHaveBeenCalledTimes(2);
		expect(get.mock.calls[0][0]).toContain('limit=500');
	});

	it('stops at a short page', async () => {
		const get = vi.fn(async () => ({ data: [{ id: 'c1' }], total_count: 1 }));
		const out = await listCodes({ get } as never);
		expect(out.data).toHaveLength(1);
		expect(get).toHaveBeenCalledTimes(1);
	});
});
