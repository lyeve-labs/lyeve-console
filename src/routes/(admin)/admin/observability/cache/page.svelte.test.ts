// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import CachePage from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		superAdmin: false,
		stats: null,
		providers: [{ name: 'memory-0', kind: 'memory', priority: 0, enabled: true }],
		providersRead: true,
		providersLicensed: false,
		inactive: [],
		gate: { state: 'ok' },
		...over,
	} as never,
	form: form as never,
});

describe('providers', () => {
	it('says an install without the license runs one provider and lists each one left out with its reason', () => {
		const { container } = render(CachePage, {
			props: props({ inactive: [{ name: 'redis-1', kind: 'redis', priority: 1, reason: 'provider_limit' }] }),
		});
		expect(screen.getByTestId('provider-tier').textContent).toContain('Only one provider runs on this engine');
		expect(said(container)).toContain('redis-1');
		expect(said(container)).toContain('Not running. Only one provider runs on this engine');
	});

	it('says every provider runs with failover when the install is licensed for it', () => {
		render(CachePage, { props: props({ providersLicensed: true }) });
		expect(screen.getByTestId('provider-tier').textContent).toContain('with failover');
	});

	it('names a networked provider the engine cannot run', () => {
		const { container } = render(CachePage, {
			props: props({ inactive: [{ name: 'redis-0', kind: 'redis', priority: 0, reason: 'networked_unavailable' }] }),
		});
		expect(said(container)).toContain('Networked cache providers are not enabled on this engine');
	});

	it('says a refused providers read with its gate', () => {
		const { container } = render(CachePage, {
			props: props({ providers: [], providersRead: false, providersGate: { state: 'forbidden' } }),
		});
		expect(said(container)).toContain('Your role cannot open the providers');
		expect(said(container)).not.toContain('No providers configured');
	});
});

describe('the gate', () => {
	it('says the plugin is absent rather than showing an empty page', () => {
		const { container } = render(CachePage, { props: props({ gate: { state: 'absent' }, providers: [], providersRead: false }) });
		expect(said(container)).toContain('The cache is not included in this build.');
		expect(said(container)).not.toContain('No providers configured');
	});
});
