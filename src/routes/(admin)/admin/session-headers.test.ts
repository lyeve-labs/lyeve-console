import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { UNNAMED } from '$lib/plugins';

/**
 * Every page load reads the engine as the session that opened the page, with
 * the bearer and the CSRF token the session headers carry. A load that built
 * its own client could drop either without a sound, so each one is asked
 * here, with every plugin running and a super admin reading.
 */
const loads = import.meta.glob<{ load: (event: never) => unknown }>('./**/+page.server.ts');

const PAGES = [
	'.',
	'analytics',
	'api-keys',
	'api-labs',
	'api-labs/grpc',
	'api-reference',
	'audit-log',
	'content',
	'content/[schema]',
	'content/[schema]/[id]',
	'content/[schema]/new',
	'flows',
	'flows/[id]',
	'flows/datasources',
	'flows/variables',
	'imports',
	'imports/templates',
	'jobs',
	'logs',
	'media',
	'observability',
	'observability/cache',
	'observability/cache/rules',
	'observability/cache/stored',
	'observability/captures',
	'observability/captures/rules',
	'observability/captures/sets',
	'observability/goroutines',
	'observability/profiler',
	'observability/profiler/capture',
	'observability/profiler/memory',
	'observability/telemetry',
	'observability/telemetry/export',
	'plugins',
	'plugins/[name]',
	'reviews',
	'reviews/definitions',
	'schema',
	'search',
	'search/settings',
	'search/synonyms',
	'settings/connected-editors',
	'settings/connected-editors/builder',
	'settings/customization',
	'settings/customization/dashboard',
	'settings/customization/menu',
	'settings/customization/pages',
	'settings/graphql',
	'settings/graphql/persisted',
	'settings/oauth',
	'settings/permissions',
	'settings/pii',
	'settings/pii/reads',
	'settings/rate-limits',
	'settings/rate-limits/live',
	'settings/rate-limits/tenant',
	'settings/rate-limits/tenant/refusals',
	'tenants',
	'tenants/costs',
	'tenants/costs/budgets',
	'tenants/costs/prices',
	'users',
	'webhooks',
	'webhooks/incoming',
];

const SESSION: Record<string, string> = { '__Host-sys_session': 'sess-tok', '__Host-csrf': 'csrf-tok' };

function cookies(): Cookies {
	return { get: vi.fn((name: string) => SESSION[name]) } as unknown as Cookies;
}

async function engineCalls(page: string) {
	const key = page === '.' ? './+page.server.ts' : `./${page}/+page.server.ts`;
	const mod = await loads[key]();
	const calls: Headers[] = [];
	const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
		calls.push(new Headers(init?.headers));
		return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
	});
	await Promise.resolve()
		.then(() =>
			mod.load({
				fetch,
				cookies: cookies(),
				url: new URL(`http://localhost/admin/${page}`),
				params: { schema: 'posts', id: 'e1', name: 'cache' },
				parent: async () => ({ plugins: UNNAMED, user: { id: 'u1', roles: ['super_admin'] } }),
				depends: vi.fn(),
			} as never),
		)
		// The answers are empty lists, which some pages read as a shape they
		// refuse. What matters here is what the reads carried.
		.catch(() => undefined);
	return calls;
}

describe('page loads read as the session', () => {
	// The menu tab's load builds its choices from the nav, whose icon imports
	// take longer than one case's budget to load on a cold worker.
	beforeAll(() => import('$lib/nav'), 60_000);

	it.each(PAGES)('%s sends the session headers on every read', async (page) => {
		const calls = await engineCalls(page);
		expect(calls.length).toBeGreaterThan(0);
		for (const headers of calls) {
			expect(headers.get('authorization')).toBe('Bearer sess-tok');
			expect(headers.get('x-csrf-token')).toBe('csrf-tok');
		}
	});
});
