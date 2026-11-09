// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));

import GrpcPage from './+page.svelte';
import type { GrpcStatus } from '$lib/api/grpc';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function status(over: Partial<GrpcStatus> = {}): GrpcStatus {
	return {
		degraded: false,
		listening: true,
		address: '127.0.0.1:3003',
		health_address: '127.0.0.1:3004',
		reflection: false,
		services: [
			{ name: 'lyeve.core.v1.ContentService', serving: true, status: 'SERVING' },
			{ name: 'lyeve.core.v1.FlowService', serving: true, status: 'SERVING' },
		],
		transcoded_routes: ['GET /api/schemas', 'POST /api/content/{schema}'],
		...over,
	};
}

const props = (over: Record<string, unknown> = {}) => ({
	data: {
		status: status(),
		gate: { state: 'ok' },
		licensed: true,
		permitted: true,
		...over,
	} as never,
});

describe('the gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(GrpcPage, {
			props: props({ gate: { state: 'locked', upgradeUrl: '' }, status: null }),
		});
		expect(said(container)).toContain('Not enabled on this engine');
	});

	it('explains the refusal to an admin who may not read it', () => {
		const { container } = render(GrpcPage, { props: props({ permitted: false, status: null }) });
		expect(said(container)).toContain('Only a super admin can see the gRPC status');
	});

	it('reports a failed read as a failure, not as a healthy listener', () => {
		const { container } = render(GrpcPage, {
			props: props({ gate: { state: 'error', message: 'The gRPC status could not be read.' }, status: null }),
		});
		expect(said(container)).toContain('could not be read');
		expect(said(container)).not.toContain('Serving');
	});
});

describe('why nothing is listening', () => {
	// The two reasons send an operator to completely different places.
	it('names a disabled plugin rather than blaming the port', () => {
		const { container } = render(GrpcPage, {
			props: props({ status: status({ degraded: true, listening: false, address: '' }) }),
		});
		const text = said(container);
		expect(text).toContain('The gRPC plugin is not enabled on this engine, so no listener was started.');
	});

	it('points at the start-up log when it is enabled and still down', () => {
		const { container } = render(GrpcPage, {
			props: props({ status: status({ listening: false, address: '' }) }),
		});
		expect(said(container)).toContain('bind failure');
	});
});

describe('the services', () => {
	// The defect this page exists to surface: a service that answers calls
	// while a health check says it does not exist.
	it('calls out a service the health protocol was never told about', () => {
		const { container } = render(GrpcPage, {
			props: props({
				status: status({
					services: [
						{ name: 'lyeve.core.v1.ContentService', serving: true, status: 'SERVING' },
						{ name: 'lyeve.core.v1.FlowService', serving: false, status: 'SERVICE_UNKNOWN' },
					],
				}),
			}),
		});
		const text = said(container);
		expect(text).toContain('1 service is registered on the server but missing from the health service');
		expect(text).toContain('not reported to health checks');
	});

	it('says nothing of the sort when every service is declared', () => {
		const { container } = render(GrpcPage, { props: props() });
		expect(said(container)).not.toContain('missing from the health service');
	});
});

describe('the listeners', () => {
	// The right default, and the reason a client elsewhere cannot connect.
	it('says when the listener is loopback only', () => {
		const { container } = render(GrpcPage, { props: props() });
		expect(said(container)).toContain('nothing outside this host can reach it');
	});

	it('says nothing of the sort on a routable address', () => {
		const { container } = render(GrpcPage, {
			props: props({ status: status({ address: '0.0.0.0:3003', health_address: '0.0.0.0:3004' }) }),
		});
		expect(said(container)).not.toContain('outside this host');
	});

	it('explains what reflection being on exposes', () => {
		const { container } = render(GrpcPage, {
			props: props({ status: status({ reflection: true }) }),
		});
		expect(said(container)).toContain('list every service and message');
	});

	it('offers the REST paths for a caller with no gRPC client', () => {
		const { container } = render(GrpcPage, { props: props() });
		expect(said(container)).toContain('GET /api/schemas');
	});
});
