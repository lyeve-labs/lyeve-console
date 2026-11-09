// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));

import RealtimePage from './+page.svelte';
import type { SocketMetrics, StreamMetrics } from '$lib/api/realtime';

afterEach(cleanup);

/**
 * The rendered text with its wrapping collapsed.
 *
 * A sentence that wraps in the source carries the newline and the indentation
 * into textContent, so a phrase spanning the wrap never matches.
 */
function said(container: HTMLElement): string {
	return (container.textContent ?? '').replace(/\s+/g, ' ');
}

function stream(over: Partial<StreamMetrics> = {}): StreamMetrics {
	return {
		total_connections: 12,
		active_connections: 3,
		events_dispatched: 400,
		reconnections: 1,
		since: '2026-09-22T10:00:00Z',
		...over,
	};
}

function socket(over: Partial<SocketMetrics> = {}): SocketMetrics {
	return { ...stream(), broadcasts_sent: 5, idle_connections: 0, ...over };
}

const props = (over: Record<string, unknown> = {}) => ({
	data: {
		stream: stream(),
		socket: socket(),
		platform: null,
		gate: { state: 'ok' },
		superAdmin: false,
		licensed: true,
		...over,
	} as never,
});

describe('Realtime gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(RealtimePage, { props: props({ gate: { state: 'locked', upgradeUrl: '' } }) });
		expect(said(container)).toContain('Not enabled on this engine');
		expect(said(container)).not.toContain('Server-sent events');
	});

	it('says the plugin is absent rather than showing zeros', () => {
		const { container } = render(RealtimePage, {
			props: props({ gate: { state: 'absent' }, stream: null, socket: null }),
		});
		expect(said(container)).toContain('not included in this build');
	});

	it('says a failed read is not a report that nobody is connected', () => {
		const { container } = render(RealtimePage, {
			props: props({
				gate: { state: 'error', message: 'Could not load realtime metrics.' },
				stream: null,
				socket: null,
			}),
		});
		expect(said(container)).toContain('Could not load realtime metrics.');
	});
});

describe('Realtime transports', () => {
	it('reads an unused transport as unused rather than as a fault', () => {
		const { container } = render(RealtimePage, {
			props: props({ socket: socket({ total_connections: 0, events_dispatched: 0 }) }),
		});
		expect(said(container)).toContain('No connections over this transport yet.');
	});

	it('states the window a cumulative total covers', () => {
		// "12 accepted" alone cannot be read: it is a busy minute or a quiet
		// month depending on how long the counter has run.
		const { container } = render(RealtimePage, { props: props() });
		expect(said(container)).toMatch(/Accepted in \d+[smhd]/);
	});

	it('keeps the two transports apart rather than adding them', () => {
		const { container } = render(RealtimePage, { props: props() });
		expect(said(container)).toContain('Server-sent events');
		expect(said(container)).toContain('WebSocket');
	});

	it('says nothing is connected when neither transport was used', () => {
		const { container } = render(RealtimePage, {
			props: props({
				stream: stream({ total_connections: 0, events_dispatched: 0 }),
				socket: socket({ total_connections: 0, events_dispatched: 0 }),
			}),
		});
		expect(said(container)).toContain('No connections yet');
	});
});

describe('a transport that did not answer', () => {
	// The load reads each transport on its own and keeps the reason, so one
	// that failed is never drawn as a transport nobody uses.
	it('says the read failed rather than that nobody uses it', () => {
		const { container } = render(RealtimePage, {
			props: props({ socket: null, socketGate: { state: 'unavailable' } }),
		});
		const text = said(container);
		expect(text).toContain('is unavailable');
		expect(text).not.toContain('No connections over this transport yet.');
		expect(text).not.toContain('No connections yet');
	});

	it('keeps the other transport drawn', () => {
		const { container } = render(RealtimePage, {
			props: props({ socket: null, socketGate: { state: 'unavailable' } }),
		});
		expect(said(container)).toMatch(/Accepted in \d+[smhd]/);
	});
});

describe('Realtime tenant roster', () => {
	it('is not drawn for a tenant admin', () => {
		const { container } = render(RealtimePage, { props: props() });
		expect(said(container)).not.toContain('Connections by tenant');
	});

	it('orders tenants by what they hold open', () => {
		const { container } = render(RealtimePage, {
			props: props({
				superAdmin: true,
				platform: stream({ connections_by_tenant: { small: 1, big: 9 } }),
			}),
		});
		const text = said(container);
		expect(text).toContain('Connections by tenant');
		expect(text.indexOf('big')).toBeLessThan(text.indexOf('small'));
	});

	it('says the roster failed without implying the counters above did', () => {
		const { container } = render(RealtimePage, {
			props: props({
				superAdmin: true,
				platform: null,
				platformGate: {
					state: 'error',
					message: 'Could not load connections by tenant.',
				},
			}),
		});
		expect(said(container)).toContain('Could not load connections by tenant.');
		expect(said(container)).not.toContain('No open connections');
	});
});

describe('whose counters these are', () => {
	// The plugin counts connections per tenant and every activity counter
	// across the whole instance.
	it('labels the activity counters as the whole engine', () => {
		const { container } = render(RealtimePage, { props: props() });
		const text = said(container);
		for (const label of ['Events pushed, whole engine', 'Rejected, whole engine', 'Broadcasts, whole engine', 'Reconnections, whole engine']) {
			expect(text, label).toContain(label);
		}
	});

	// The tenant view hard-codes the idle count to zero.
	it('shows no idle count the plugin never measured', () => {
		const { container } = render(RealtimePage, {
			props: props({ socket: socket({ connections_by_state: { active: 3, idle: 0 } }) }),
		});
		expect(said(container)).not.toContain('Idle');
		expect(said(container)).not.toContain('idle 0');
		expect(said(container)).toContain('active 3');
	});

	it("reads a tenant that never connected as unused, whatever the engine pushed", () => {
		const { container } = render(RealtimePage, {
			props: props({ stream: stream({ total_connections: 0, active_connections: 0, events_dispatched: 900 }) }),
		});
		expect(said(container)).toContain('No connections over this transport yet.');
	});
});
