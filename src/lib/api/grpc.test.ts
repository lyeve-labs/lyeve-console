import { describe, expect, it } from 'vitest';
import {
	grpcHealth,
	healthTone,
	loopbackOnly,
	reflectionNote,
	serviceStatusLabel,
	serviceTone,
	undeclared,
	type GrpcStatus,
} from './grpc';

function status(over: Partial<GrpcStatus> = {}): GrpcStatus {
	return {
		degraded: false,
		listening: true,
		address: '127.0.0.1:3003',
		health_address: '127.0.0.1:3004',
		reflection: false,
		services: [
			{ name: 'lyeve.core.v1.ContentService', serving: true, status: 'SERVING' },
			{ name: 'lyeve.core.v1.SchemaService', serving: true, status: 'SERVING' },
		],
		transcoded_routes: ['GET /api/schemas'],
		...over,
	};
}

describe('the one line the page leads with', () => {
	// No listener was bound on purpose. Reporting it as a bind failure sends
	// somebody to look at ports that are fine.
	it('puts a disabled plugin ahead of not listening', () => {
		expect(grpcHealth(status({ degraded: true, listening: false }))).toBe('disabled');
		expect(healthTone('disabled')).toBe('warn');
	});

	// A listener that is up with a service not serving is what a health check
	// catches and a port check does not.
	it('separates partly serving from serving and from down', () => {
		const partial = status({
			services: [
				{ name: 'a', serving: true, status: 'SERVING' },
				{ name: 'b', serving: false, status: 'NOT_SERVING' },
			],
		});
		expect(grpcHealth(partial)).toBe('partial');
		expect(grpcHealth(status())).toBe('serving');
		expect(grpcHealth(status({ listening: false }))).toBe('down');
		expect(grpcHealth(null)).toBe('down');
	});

	it('uses the kit vocabulary for every level', () => {
		expect(healthTone('serving')).toBe('success');
		expect(healthTone('down')).toBe('danger');
		expect(healthTone('partial')).toBe('warn');
	});
});

describe('a service health was never told about', () => {
	// It answers calls while a client that health checks first is told it does
	// not exist. That is a registration gap, not an outage.
	it('finds the ones reporting SERVICE_UNKNOWN', () => {
		const gap = status({
			services: [
				{ name: 'a', serving: true, status: 'SERVING' },
				{ name: 'b', serving: false, status: 'SERVICE_UNKNOWN' },
			],
		});
		expect(undeclared(gap).map((s) => s.name)).toEqual(['b']);
		expect(undeclared(status())).toEqual([]);
		expect(undeclared(null)).toEqual([]);
	});

	it('explains each status without assuming the reader knows the spec', () => {
		expect(serviceStatusLabel('SERVICE_UNKNOWN')).toContain('not reported to health checks');
		expect(serviceStatusLabel('NOT_SERVING')).toBe('Refusing calls');
		expect(serviceStatusLabel('UNKNOWN')).toBe('Not started');
		expect(serviceStatusLabel('WHATEVER')).toBe('WHATEVER');
	});

	it('marks a registration gap apart from a refusal', () => {
		expect(serviceTone('SERVICE_UNKNOWN')).toBe('warn');
		expect(serviceTone('NOT_SERVING')).toBe('danger');
		expect(serviceTone('SERVING')).toBe('success');
		expect(serviceTone('UNKNOWN')).toBe('neutral');
	});
});

describe('where the listener can be reached from', () => {
	// The right default, and the reason a client on another machine cannot
	// connect. Saying so is a five minute fix instead of an afternoon.
	it('recognizes every spelling of loopback', () => {
		expect(loopbackOnly('127.0.0.1:3003')).toBe(true);
		expect(loopbackOnly('localhost:3003')).toBe(true);
		expect(loopbackOnly('[::1]:3003')).toBe(true);
	});

	it('does not call a routable address loopback', () => {
		expect(loopbackOnly('0.0.0.0:3003')).toBe(false);
		expect(loopbackOnly('10.0.1.4:3003')).toBe(false);
		expect(loopbackOnly(null)).toBe(false);
		expect(loopbackOnly('')).toBe(false);
	});
});

describe('reflection', () => {
	it('says what it means either way, and nothing when nothing is listening', () => {
		expect(reflectionNote(status({ reflection: true }))).toContain('list every service and message');
		expect(reflectionNote(status({ reflection: false }))).toContain('generated stubs');
		expect(reflectionNote(status({ listening: false }))).toBe('');
		expect(reflectionNote(null)).toBe('');
	});
});
