// @vitest-environment jsdom
import { globSync, readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/svelte';
import { parse } from 'svelte/compiler';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ page: { data: {} as Record<string, unknown> } }));
vi.mock('$app/state', () => state);
vi.mock('$app/navigation', () => ({ onNavigate: () => {} }));
vi.mock('$app/paths', () => ({ asset: (path: string) => path }));

import Harness from './tab-title-harness.test.svelte';

/*
 * What each page's browser tab read when every page rendered PageTitle for
 * itself. A literal is the page's own part of the title. An expression is the
 * source the page computed it from, which a PageShell's documentTitle or title
 * must now repeat word for word.
 */
type Expected = string | { expr: string };

const TAB_TITLES: [string, Expected][] = [
	['(admin)/+error.svelte', { expr: "status === 404 ? 'Not found' : status === 401 ? 'Not signed in' : status === 402 || status === 403 ? 'No access' : status === 429 ? BUSY.title : status === 503 ? OUTAGE.title : 'Could not open this page'" }],
	['(admin)/admin/+page.svelte', 'Dashboard'],
	['(admin)/admin/admin-tokens/+page.svelte', 'Admin tokens'],
	['(admin)/admin/ai/prices/+page.svelte', 'AI prices'],
	['(admin)/admin/ai/prompts/+page.svelte', 'AI prompts'],
	['(admin)/admin/ai/prompts/[use_case]/+page.svelte', { expr: "p ? useCaseLabel(p.use_case) : 'Prompt'" }],
	['(admin)/admin/ai/providers/+page.svelte', 'AI providers'],
	['(admin)/admin/ai/providers/[id]/+page.svelte', { expr: "p?.name ?? 'Provider'" }],
	['(admin)/admin/ai/settings/+page.svelte', 'AI settings'],
	['(admin)/admin/ai/transcripts/+page.svelte', 'AI transcripts'],
	['(admin)/admin/ai/transcripts/[id]/+page.svelte', 'Transcript'],
	['(admin)/admin/analytics-destinations/+page.svelte', 'Analytics destinations'],
	['(admin)/admin/analytics/+page.svelte', 'API analytics'],
	['(admin)/admin/api-access/+page.svelte', 'API access'],
	['(admin)/admin/api-keys/+page.svelte', 'API keys'],
	['(admin)/admin/api-labs/+page.svelte', 'API labs'],
	['(admin)/admin/api-reference/+page.svelte', 'API reference'],
	['(admin)/admin/audit-log/+page.svelte', 'Audit log'],
	['(admin)/admin/audit-log/retention/+page.svelte', 'Retention and holds - Audit log'],
	['(admin)/admin/audit-log/sinks/+page.svelte', 'Audit streaming'],
	['(admin)/admin/content/+page.svelte', 'Content'],
	['(admin)/admin/content/[schema]/+page.svelte', { expr: "data.schemaDef.display_name || data.activeSchema" }],
	['(admin)/admin/content/[schema]/[id]/+page.svelte', { expr: "heading" }],
	['(admin)/admin/content/[schema]/new/+page.svelte', 'New entry'],
	['(admin)/admin/data-export/+page.svelte', 'Data export'],
	['(admin)/admin/events/+page.svelte', 'Events'],
	['(admin)/admin/experiments/+page.svelte', 'Experiments'],
	['(admin)/admin/experiments/[id]/+page.svelte', { expr: "exp.name" }],
	['(admin)/admin/flows/+page.svelte', 'Flows'],
	['(admin)/admin/flows/[id]/+page.svelte', { expr: "`${data.flow?.name ?? 'Flow'} - Flows`" }],
	['(admin)/admin/flows/datasources/+page.svelte', 'Datasources - Flows'],
	['(admin)/admin/flows/variables/+page.svelte', 'Variables - Flows'],
	['(admin)/admin/gdpr/+page.svelte', 'Privacy requests'],
	['(admin)/admin/imports/+page.svelte', 'Imports'],
	['(admin)/admin/jobs/+page.svelte', 'Scheduled jobs'],
	['(admin)/admin/logs/+page.svelte', 'Logs'],
	['(admin)/admin/logs/alerts/+page.svelte', 'Volume alerts'],
	['(admin)/admin/media/+page.svelte', 'Media library'],
	['(admin)/admin/observability/+page.svelte', 'Observability'],
	['(admin)/admin/observability/cache/+page.svelte', 'Cache'],
	['(admin)/admin/observability/captures/+page.svelte', 'Request capture'],
	['(admin)/admin/observability/errors/+page.svelte', 'Errors'],
	['(admin)/admin/observability/errors/alerts/+page.svelte', 'Spike alerts'],
	['(admin)/admin/observability/idempotency/+page.svelte', 'Idempotency'],
	['(admin)/admin/observability/profiler/+page.svelte', 'Profiler'],
	['(admin)/admin/observability/queries/+page.svelte', 'Slow queries'],
	['(admin)/admin/observability/synthetic/+page.svelte', 'Synthetic monitoring'],
	['(admin)/admin/observability/telemetry/+page.svelte', 'Telemetry'],
	['(admin)/admin/pages/[slug]/+page.svelte', { expr: "data.customPage.title" }],
	['(admin)/admin/plugins/+page.svelte', 'Plugins'],
	['(admin)/admin/plugins/[name]/+page.svelte', { expr: "`${title} - Plugins`" }],
	['(admin)/admin/realtime/+page.svelte', 'Realtime'],
	['(admin)/admin/releases/+page.svelte', 'Releases'],
	['(admin)/admin/releases/[id]/+page.svelte', { expr: "release?.name ?? 'Release'" }],
	['(admin)/admin/reviews/+page.svelte', 'Reviews'],
	['(admin)/admin/schema/+page.svelte', 'Schema builder'],
	['(admin)/admin/search/+page.svelte', 'Search'],
	['(admin)/admin/settings/+page.svelte', 'Settings'],
	['(admin)/admin/settings/account/+page.svelte', 'Account and appearance'],
	['(admin)/admin/settings/captcha/+page.svelte', 'Captcha'],
	['(admin)/admin/settings/config-sync/+page.svelte', 'Config sync'],
	['(admin)/admin/settings/configuration/+page.svelte', 'Configuration'],
	['(admin)/admin/settings/connected-editors/+page.svelte', 'Builder connections'],
	['(admin)/admin/settings/customization/+page.svelte', 'Customization'],
	['(admin)/admin/settings/customization/dashboard/+page.svelte', 'Dashboard - Customization'],
	['(admin)/admin/settings/customization/pages/[slug]/+page.svelte', { expr: "`${page.title || 'Page'} - Customization`" }],
	['(admin)/admin/settings/devices/+page.svelte', 'Trusted devices'],
	['(admin)/admin/settings/email/+page.svelte', 'Email providers'],
	['(admin)/admin/settings/email/templates/+page.svelte', 'Email templates - Settings'],
	['(admin)/admin/settings/email/triggers/+page.svelte', 'Email triggers - Settings'],
	['(admin)/admin/settings/graphql/+page.svelte', 'GraphQL - Settings'],
	['(admin)/admin/settings/grpc/+page.svelte', 'gRPC'],
	['(admin)/admin/settings/license/+page.svelte', 'License'],
	['(admin)/admin/settings/localization/+page.svelte', 'Locales'],
	['(admin)/admin/settings/message-broker/+page.svelte', 'Message broker'],
	['(admin)/admin/settings/mfa/+page.svelte', 'Two-factor authentication'],
	['(admin)/admin/settings/oauth/+page.svelte', 'OAuth providers'],
	['(admin)/admin/settings/permissions/+page.svelte', 'Row-level permissions'],
	['(admin)/admin/settings/pii/+page.svelte', 'PII masking'],
	['(admin)/admin/settings/rate-limits/+page.svelte', 'Rate limits'],
	['(admin)/admin/settings/rate-limits/tenant/+page.svelte', 'Tenant rate limits'],
	['(admin)/admin/settings/recommendations/+page.svelte', 'Recommendations'],
	['(admin)/admin/settings/residency/+page.svelte', 'Data residency'],
	['(admin)/admin/settings/saml/+page.svelte', 'SAML SSO'],
	['(admin)/admin/settings/scim/+page.svelte', 'SCIM provisioning'],
	['(admin)/admin/settings/security/+page.svelte', 'Security'],
	['(admin)/admin/settings/storage/+page.svelte', 'Storage'],
	['(admin)/admin/tenants/+page.svelte', 'Tenants'],
	['(admin)/admin/tenants/[id]/+page.svelte', { expr: "tenant.name" }],
	['(admin)/admin/tenants/costs/+page.svelte', 'Tenant costs'],
	['(admin)/admin/tenants/usage/+page.svelte', 'Quotas and usage'],
	['(admin)/admin/users/+page.svelte', 'Users'],
	['(admin)/admin/webhooks/+page.svelte', 'Webhooks'],
	['(admin)/admin/webhooks/incoming/+page.svelte', 'Incoming webhooks'],
	['+error.svelte', { expr: "status === 404 ? 'Not found' : status === 401 ? 'Not signed in' : status === 402 || status === 403 ? 'No access' : status === 429 ? BUSY.title : status === 503 ? OUTAGE.title : 'Could not open this page'" }],
	['admin/device/+page.svelte', 'Approve a device'],
	['auth/magic-link/verify/+page.svelte', 'Sign in with your link'],
	['forgot-password/+page.svelte', 'Reset your password'],
	['login/+page.svelte', 'Sign in'],
	['login/magic-link/+page.svelte', 'Email a sign-in link'],
	['reset-password/+page.svelte', 'Choose a new password'],
	['setup/+page.svelte', 'Set up'],
];

type Node = { type?: string; name?: string; start: number; end: number; [key: string]: unknown };
type Attr = { type: string; name: string; start: number; end: number; value: true | Node | Node[] };

function components(file: string): { name: string; attrs: Map<string, string> }[] {
	const src = readFileSync(`src/routes/${file}`, 'utf8');
	const found: { name: string; attrs: Map<string, string> }[] = [];
	const walk = (node: unknown): void => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) return node.forEach(walk);
		const n = node as Node;
		if (n.type === 'Component' && (n.name === 'PageShell' || n.name === 'PageTitle')) {
			const attrs = new Map<string, string>();
			for (const a of n.attributes as Attr[]) {
				if (a.type !== 'Attribute' || a.value === true) continue;
				const parts = Array.isArray(a.value) ? a.value : [a.value];
				const one = parts.length === 1 ? parts[0] : null;
				attrs.set(
					a.name,
					one?.type === 'Text'
						? JSON.stringify(one.data)
						: one?.type === 'ExpressionTag'
							? src.slice((one.expression as Node).start, (one.expression as Node).end).replace(/\s+/g, ' ')
							: src.slice(a.start, a.end),
				);
			}
			found.push({ name: n.name, attrs });
		}
		for (const [key, value] of Object.entries(n)) if (key !== 'parent') walk(value);
	};
	walk((parse(src, { modern: true }) as unknown as { fragment: unknown }).fragment);
	return found;
}

/** The source a tab title is computed from, in the form components() reports it. */
function sourceOf(expected: Expected): string {
	return typeof expected === 'string' ? JSON.stringify(expected) : expected.expr;
}

/**
 * One way a template can render: how many tab titles it writes, capped at
 * two, and whether it draws anything at all. A page that only redirects, or
 * a branch left empty, draws nothing and needs no title.
 */
type Path = { titles: number; content: boolean };

const key = (p: Path) => `${p.titles}:${p.content}`;

function dedupe(paths: Path[]): Path[] {
	return [...new Map(paths.map((p) => [key(p), p])).values()];
}

/** Every way a run of sibling nodes can render, branch by branch. */
function sequence(nodes: unknown[]): Path[] {
	let paths: Path[] = [{ titles: 0, content: false }];
	for (const node of nodes) {
		const next: Path[] = [];
		for (const a of paths) {
			for (const b of ways(node as Node)) {
				next.push({ titles: Math.min(2, a.titles + b.titles), content: a.content || b.content });
			}
		}
		paths = dedupe(next);
	}
	return paths;
}

const nodesOf = (fragment: unknown): unknown[] => ((fragment as { nodes?: unknown[] } | null)?.nodes ?? []);

function ways(node: Node): Path[] {
	switch (node.type) {
		case 'Text':
			return [{ titles: 0, content: String(node.data).trim() !== '' }];
		case 'Comment':
		case 'SnippetBlock':
		case 'ConstTag':
		case 'DebugTag':
		case 'SvelteHead':
		case 'SvelteWindow':
		case 'SvelteDocument':
		case 'SvelteBody':
		case 'TitleElement':
			// Rendered elsewhere or not at all: a snippet renders where it is
			// called, and the head and the window draw nothing on the page.
			return [{ titles: 0, content: false }];
		case 'IfBlock':
			return dedupe([...sequence(nodesOf(node.consequent)), ...sequence(nodesOf(node.alternate))]);
		case 'EachBlock':
			return dedupe([...sequence(nodesOf(node.body)), ...sequence(nodesOf(node.fallback))]);
		case 'AwaitBlock':
			return dedupe([
				...sequence(nodesOf(node.pending)),
				...sequence(nodesOf(node.then)),
				...sequence(nodesOf(node.catch)),
			]);
		default: {
			const own: Path =
				node.type === 'Component' && (node.name === 'PageShell' || node.name === 'PageTitle')
					? { titles: 1, content: node.name === 'PageShell' }
					: { titles: 0, content: true };
			return sequence(nodesOf(node.fragment)).map((p) => ({
				titles: Math.min(2, own.titles + p.titles),
				content: own.content || p.content,
			}));
		}
	}
}

/** The ways a route file renders that write no tab title, or more than one. */
function untitled(file: string): string[] {
	const ast = parse(readFileSync(file, 'utf8'), { modern: true }) as unknown as { fragment: unknown };
	return sequence(nodesOf(ast.fragment))
		.filter((p) => p.titles > 1 || (p.content && p.titles === 0))
		.map((p) => (p.titles > 1 ? 'a branch writes two tab titles' : 'a branch draws the page with no tab title'));
}

afterEach(() => {
	cleanup();
	state.page.data = {};
});

describe('tab titles', () => {
	it.each(TAB_TITLES)('%s keeps its tab title', (file, expected) => {
		const found = components(file);
		const shells = found.filter((c) => c.name === 'PageShell');
		const titles = found.filter((c) => c.name === 'PageTitle');
		if (shells.length === 0) {
			// A page without a PageShell still writes its own title.
			expect(titles.map((t) => t.attrs.get('title'))).toEqual([sourceOf(expected)]);
			return;
		}
		// Two title elements would leave the tab to whichever the browser reads
		// first, so a page with a PageShell renders no PageTitle.
		expect(titles).toEqual([]);
		for (const shell of shells) {
			expect(shell.attrs.get('documentTitle') ?? shell.attrs.get('title')).toBe(sourceOf(expected));
		}
	});

	// A literal title renders through the root layout's format, so the tab is
	// read from the document rather than from the source.
	const literals = TAB_TITLES.filter(
		(row): row is [string, string] =>
			typeof row[1] === 'string' && components(row[0]).some((c) => c.name === 'PageShell'),
	);

	it.each(literals)('%s reads "%s" and then the product name', async (file, expected) => {
		const shell = components(file).find((c) => c.name === 'PageShell')!;
		const literal = (key: string) => {
			const raw = shell.attrs.get(key);
			return raw === undefined ? undefined : (JSON.parse(raw) as string);
		};
		render(Harness, { props: { title: literal('title') ?? '', documentTitle: literal('documentTitle') } });
		await tick();
		expect(document.title).toBe(`${expected} - LyEve Console`);
	});

	it('ends in the tenant name once the tenant has one', async () => {
		state.page.data = { brand: { name: 'Acme Studio', logo_url: '', accent: '', favicon_url: '' } };
		render(Harness, { props: { title: 'Audit log', documentTitle: 'Audit streaming' } });
		await tick();
		expect(document.title).toBe('Audit streaming - Acme Studio');
	});

	// The table above holds the pages that existed when the tab moved to the
	// PageShell. This holds every page, including one added later, and reads
	// each branch: a page that draws a PageShell under one condition and
	// nothing titled under the other leaves the tab on the last page's title.
	const routeFiles = globSync('src/routes/**/{+page,+error}.svelte').sort();

	it('reads every page and error page', () => {
		expect(routeFiles.length).toBeGreaterThanOrEqual(TAB_TITLES.length);
	});

	it.each(routeFiles)('%s writes one tab title on every branch that draws the page', (file) => {
		expect(untitled(file)).toEqual([]);
	});

	it('finds a branch that draws the page with no tab title', () => {
		const body = (markup: string) => {
			const ast = parse(markup, { modern: true }) as unknown as { fragment: unknown };
			return sequence(nodesOf(ast.fragment)).filter((p) => p.titles > 1 || (p.content && p.titles === 0)).length;
		};
		expect(body('{#if a}<PageShell title="A">x</PageShell>{:else}<p>No access</p>{/if}')).toBe(1);
		expect(body('{#if a}<PageShell title="A">x</PageShell>{/if}')).toBe(0);
		expect(body('<PageTitle title="A" /><PageShell title="A">x</PageShell>')).toBe(1);
		expect(body('{#if a}<PageShell title="A">x</PageShell>{:else}<PageShell title="B">y</PageShell>{/if}')).toBe(0);
		expect(body('<PageTitle title="Sign in" /><AuthShell title="Sign in">x</AuthShell>')).toBe(0);
		expect(body('{#snippet row()}<p>x</p>{/snippet}<PageShell title="A">{@render row()}</PageShell>')).toBe(0);
	});

	it('leaves no file rendering both a PageShell and a PageTitle', () => {
		const both = globSync('src/**/*.svelte')
			.filter((file) => !file.endsWith('.test.svelte'))
			.filter((file) => {
				const src = readFileSync(file, 'utf8');
				return src.includes('<PageShell') && src.includes('<PageTitle');
			});
		expect(both).toEqual([]);
	});
});
