import { describe, expect, it } from 'vitest';
import {
	inUse,
	tenantLoad,
	uptimeSince,
	type StreamMetrics,
} from './realtime';

function metrics(over: Partial<StreamMetrics> = {}): StreamMetrics {
	return {
		total_connections: 0,
		active_connections: 0,
		events_dispatched: 0,
		reconnections: 0,
		since: '2026-09-22T10:00:00Z',
		...over,
	};
}

describe('tenantLoad', () => {
	it('is empty for a missing map rather than throwing', () => {
		expect(tenantLoad(null)).toEqual([]);
		expect(tenantLoad(undefined)).toEqual([]);
	});

	it('drops a tenant with nothing open', () => {
		expect(tenantLoad({ a: 0, b: 3 }).map((t) => t.tenant)).toEqual(['b']);
	});

	it('orders by connections so the table does not reshuffle between reads', () => {
		// The map arrives unordered, so drawing it straight gives a different
		// row order on every poll.
		expect(tenantLoad({ small: 1, big: 9, mid: 4 }).map((t) => t.tenant)).toEqual([
			'big',
			'mid',
			'small',
		]);
	});

	it('breaks a tie by name, so equal tenants hold their place', () => {
		expect(tenantLoad({ b: 2, a: 2 }).map((t) => t.tenant)).toEqual(['a', 'b']);
	});

	it('states each tenant share of what is open', () => {
		const [first] = tenantLoad({ a: 3, b: 1 });
		expect(first.share).toBeCloseTo(0.75);
	});
});

describe('uptimeSince', () => {
	const now = new Date('2026-09-22T12:00:00Z');

	it('reports the window a cumulative counter covers', () => {
		// Ten thousand events is a busy minute or a quiet month, so a total
		// with no window behind it says nothing.
		expect(uptimeSince('2026-09-22T11:59:30Z', now)).toBe('30s');
		expect(uptimeSince('2026-09-22T11:30:00Z', now)).toBe('30m');
		expect(uptimeSince('2026-09-22T09:30:00Z', now)).toBe('2h 30m');
		expect(uptimeSince('2026-09-20T10:00:00Z', now)).toBe('2d 2h');
	});

	it('does not render NaN for a timestamp it cannot parse', () => {
		expect(uptimeSince('not a date', now)).toBe('an unknown time');
	});

	it('floors at zero for a clock that is behind', () => {
		expect(uptimeSince('2026-09-22T12:05:00Z', now)).toBe('0s');
	});
});

describe('inUse', () => {
	// An instance that pushes over one transport should read as "nobody uses
	// this one" on the other, not as a wall of zeros that looks like a fault.
	it('is false for a transport nothing has touched', () => {
		expect(inUse(metrics())).toBe(false);
		expect(inUse(null)).toBe(false);
	});

	it('is true once something connected, even if all of them closed', () => {
		expect(inUse(metrics({ total_connections: 4, active_connections: 0 }))).toBe(true);
	});

	// The plugin counts pushed events across every tenant, so they cannot
	// say this tenant uses the transport.
	it('is false when only another tenant pushed events', () => {
		expect(inUse(metrics({ events_dispatched: 11 }))).toBe(false);
	});
});
