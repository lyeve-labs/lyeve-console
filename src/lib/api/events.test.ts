import { describe, expect, it } from 'vitest';
import {
	didFire,
	failedOnly,
	progressOf,
	type EventRow,
	type ReplayRun,
} from './events';

function run(over: Partial<ReplayRun> = {}): ReplayRun {
	return {
		run_id: 'r1',
		status: 'completed',
		handler: 'webhook',
		since: '2026-09-22T09:00:00Z',
		dry_run: false,
		tenant_id: 't1',
		total_events: 10,
		replayed: 10,
		skipped: 0,
		failed: 0,
		started_at: '2026-09-22T10:00:00Z',
		...over,
	};
}

function row(over: Partial<EventRow> = {}): EventRow {
	return {
		id: 'e1',
		source: 'content',
		topic: 'content.created',
		schema_name: 'article',
		event_type: 'created',
		published_at: '2026-09-22T10:00:00Z',
		tenant_id: 't1',
		...over,
	};
}

describe('progressOf', () => {
	// A run knows its total before it starts, so progress drawn from replayed
	// alone sits at zero for the whole of a long run.
	it('counts skipped and failed as progress, not just replayed', () => {
		expect(progressOf(run({ replayed: 2, skipped: 3, failed: 1, total_events: 12 }))).toBeCloseTo(0.5);
	});

	it('is zero for a run that has not started and has no total', () => {
		expect(progressOf(run({ status: 'pending', total_events: 0, replayed: 0 }))).toBe(0);
	});

	it('is complete for a finished run that matched nothing', () => {
		// A window with no events completes without replaying one, and a bar
		// stuck at zero reads as a hung run.
		expect(progressOf(run({ status: 'completed', total_events: 0, replayed: 0 }))).toBe(1);
	});

	it('never exceeds one when the counters overshoot the total', () => {
		expect(progressOf(run({ replayed: 20, total_events: 10 }))).toBe(1);
	});
});

describe('didFire', () => {
	// A rehearsal reports the same counters as a real run, so a listing that
	// does not separate them reads as though every rehearsal had fired.
	it('is false for a rehearsal however many it counted', () => {
		expect(didFire(run({ dry_run: true, replayed: 500 }))).toBe(false);
	});

	it('is false for a real run that matched nothing', () => {
		expect(didFire(run({ replayed: 0 }))).toBe(false);
	});

	it('is true only when a real run posted something', () => {
		expect(didFire(run({ replayed: 1 }))).toBe(true);
	});
});

describe('failedOnly', () => {
	it('keeps the rows carrying an error, which is why anyone replays', () => {
		const rows = [row(), row({ id: 'e2', error: 'handler timed out' })];
		expect(failedOnly(rows).map((r) => r.id)).toEqual(['e2']);
	});

	it('treats an empty error string as no error', () => {
		expect(failedOnly([row({ error: '' })])).toEqual([]);
	});
});
