// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import GrpcLab from './+page.svelte';
import type { LabResult } from '$lib/api/labs';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function result(over: Partial<LabResult> = {}): LabResult {
	return {
		method: 'GET',
		path: '/api/v1/content/articles',
		status: 200,
		statusText: 'OK',
		durationMs: 42,
		body: '{\n  "data": []\n}',
		json: true,
		headers: { 'content-type': 'application/json' },
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		user: { roles: ['super_admin'] },
		grpc: { listening: true, routes: ['GET /api/schemas'], gate: { state: 'ok' } },
		...over,
	} as never,
	form: form as never,
});

describe('gRPC', () => {
	// Those paths are on the plugin's own listener. The engine runs the call
	// inside the plugin rather than reaching across to it, so the tab sends.
	it('offers the transcoded routes and a way to run one', () => {
		const { container } = render(GrpcLab, { props: props() });
		const text = said(container);
		expect(text).toContain('checks your token as it does for any caller');
		expect(container.querySelector('form[action="?/grpc"]')).not.toBeNull();
	});

	it('will not run until a route is chosen', () => {
		render(GrpcLab, { props: props() });
		expect(screen.getByRole('button', { name: /run/i })).toHaveProperty('disabled', true);
	});

	it('shows the transcoded handler status, not the engine call status', () => {
		const { container } = render(GrpcLab, {
			props: props(
				{},
				{
					grpc: result({ path: '/api/content/post', status: 404, body: '{"error":"schema not found"}' }),
					grpcRoute: 'GET /api/content/{schema}',
				},
			),
		});
		const text = said(container);
		expect(text).toContain('404');
		expect(text).toContain('schema not found');
	});

	it('says the plugin is absent rather than showing an empty list', () => {
		const { container } = render(GrpcLab, {
			props: props({ grpc: { listening: false, routes: [], gate: { state: 'absent' } } }),
		});
		expect(said(container)).toContain('turned off on this engine');
	});

	// The engine can still refuse the status read to a super admin, and the
	// reader is not told the plugin is missing.
	it('says the role is why when the engine refuses the status read', () => {
		const { container } = render(GrpcLab, {
			props: props({ grpc: { listening: false, routes: [], gate: { state: 'forbidden' } } }),
		});
		expect(said(container)).toContain('Your role cannot open the gRPC listener.');
		expect(said(container)).not.toContain('turned off on this engine');
	});

	it('offers a retry when the status could not be read', () => {
		const { container } = render(GrpcLab, {
			props: props({ grpc: { listening: false, routes: [], gate: { state: 'unavailable' } } }),
		});
		expect(said(container)).toContain('the gRPC listener did not load');
		expect(said(container)).not.toContain('turned off on this engine');
		expect(said(container)).toContain('Try again');
	});

	it('separates a missing plugin from one that is present and down', () => {
		const { container } = render(GrpcLab, {
			props: props({ grpc: { listening: false, routes: [], gate: { state: 'ok' } } }),
		});
		expect(said(container)).toContain('installed, but its listener is not running');
	});

	// There is no sandbox on any lab, so every tab says so.
	it('keeps the no-sandbox warning', () => {
		const { container } = render(GrpcLab, { props: props() });
		expect(said(container)).toContain('a write changes data and a delete removes it');
	});
});
