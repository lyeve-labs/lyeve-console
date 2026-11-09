// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './+page.svelte';

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin') } }));

afterEach(cleanup);

function data(overrides: Record<string, unknown> = {}) {
	return {
		schemas: { ok: true, value: [{ name: 'post', display_name: 'Post', fields: [] }] },
		isAdmin: true,
		superAdmin: true,
		offers: { schema: true, content: true, analytics: true, jobs: true, logs: true, webhooks: true, audit: true },
		entries: [],
		entryTotal: 0,
		requests: null,
		jobs: null,
		errorsLogged: null,
		webhooks: null,
		window: '24h',
		entriesByStatus: null,
		attention: [],
		traffic: null,
		endpoints: null,
		deadLetters: [],
		audit: [],
		errors: [],
		license: null,
		...overrides,
	} as never;
}

const empty = data({ schemas: { ok: true, value: [] }, entryTotal: null });

/** Every tile read and answered, with nothing wrong. */
const quiet = {
	controlFailures: 0,
	requests: { total: 10, errorRate: 0, p95: 5 },
	jobs: { enabled: 1, failed: [] },
	errorsLogged: 0,
	webhooks: { total: 1, unhealthy: 0, pendingDlq: 0 },
};

/*
 * The migration control sits in the shell header on every screen and posts to
 * this page's action. A reader whose JavaScript never ran arrives here with the
 * outcome, so a refusal has to be readable here and nowhere else.
 */
describe('admin dashboard', () => {
	it('announces a migration the engine refused', () => {
		render(DashboardPage, { props: { data: empty, form: { error: 'migration 059 failed' } } });

		expect(screen.getByText('migration 059 failed')).toBeTruthy();
	});

	it('says nothing when nothing failed', () => {
		render(DashboardPage, { props: { data: empty, form: null } });

		expect(screen.queryByText('migration 059 failed')).toBeNull();
		expect(screen.getByText('Dashboard')).toBeTruthy();
	});
});

/*
 * A tile that could not be read says so. Printing zero for an endpoint that
 * answered 404 would tell an operator the instance is quiet when what is
 * true is that nothing was measured.
 */
describe('dashboard tiles', () => {
	it('says unknown, not zero, for a read that failed', () => {
		const { container } = render(DashboardPage, { props: { data: data(), form: null } });

		const text = container.textContent ?? '';
		expect(text).toContain('analytics unavailable');
		expect(text).toContain('jobs unavailable');
		expect(text).toContain('webhooks unavailable');
		expect((text.match(/unknown/g) ?? []).length).toBeGreaterThanOrEqual(4);
	});

	it('states the numbers when the reads succeed', () => {
		const { container } = render(DashboardPage, {
			props: {
				data: data({
					entryTotal: 1234,
					requests: { total: 5000, errorRate: 0.062, p95: 181.4 },
					jobs: { enabled: 7, failed: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }] },
					errorsLogged: 9,
					webhooks: { total: 3, unhealthy: 1, pendingDlq: 4 },
					license: { plan: 'example', state: 'grace' },
				}),
				form: null,
			},
		});

		const text = container.textContent ?? '';
		expect(text).toContain('1,234');
		expect(text).toContain('5,000');
		expect(text).toContain('6.2% failed');
		expect(text).toContain('of 7 enabled');
		expect(text).toContain('of 3, 4 dead-lettered');
		expect(text).toContain('Grace period');
		expect(text).not.toContain('unknown');
	});

	it('draws no tile and no list for a plugin that does not run', () => {
		const none = { schema: false, content: false, analytics: false, jobs: false, logs: false, webhooks: false, audit: false };
		const { container } = render(DashboardPage, { props: { data: data({ schemas: null, offers: none }), form: null } });

		const text = container.textContent ?? '';
		for (const gone of ['Content types', 'Entries', 'Requests, 24h', 'Failed jobs', 'Errors logged', 'Webhooks failing', 'What changed', 'No content types yet']) {
			expect(text, gone).not.toContain(gone);
		}
	});

	it('shows the license tile only when the load sends a license', () => {
		const licensed = render(DashboardPage, {
			props: { data: data({ license: { plan: 'Example', state: 'active' } }), form: null },
		});
		const tile = licensed.container.querySelector('a[href="/admin/settings/license"]');
		expect(tile?.textContent?.replace(/\s+/g, ' ')).toContain('Example');
		expect(tile?.textContent).toContain('Active');
		cleanup();

		const { container } = render(DashboardPage, { props: { data: data(), form: null } });
		expect(container.querySelector('a[href="/admin/settings/license"]')).toBeNull();
		expect(container.textContent).not.toContain('License');
	});

	// The entry list and counts are admin routes, so an editor is shown no
	// count rather than a refusal drawn as nothing.
	it('shows an editor only what the engine would let them read', () => {
		const { container } = render(DashboardPage, {
			props: { data: data({ isAdmin: false, superAdmin: false, entryTotal: null, entries: null }), form: null },
		});

		const text = container.textContent ?? '';
		expect(text).toContain('Content types');
		expect(text).not.toContain('Entries');
		expect(text).not.toContain('Requests, 24h');
		expect(text).not.toContain('Recent audit entries');
		expect(text).not.toContain('Recent entries');
		expect(text).not.toContain('unknown');
	});

	it('shows no jobs tile to an admin, whom the scheduler does not answer', () => {
		const { container } = render(DashboardPage, {
			props: { data: data({ superAdmin: false }), form: null },
		});

		expect(container.textContent).not.toContain('Failed jobs');
		expect(container.querySelector('a[href="/admin/jobs"]')).toBeNull();
	});

	it('keeps the dashboard and says unknown when the schemas could not be read', () => {
		const { container } = render(DashboardPage, {
			props: { data: data({ schemas: { ok: false, gate: { state: 'unavailable' } } }), form: null },
		});

		const text = container.textContent ?? '';
		expect(text).not.toContain('No content types yet');
		expect(text).toContain('Right now');
		expect(text).toContain('content types unavailable');
	});

	it('offers the first schema only to a role that may make one', () => {
		const admin = render(DashboardPage, { props: { data: empty, form: null } });
		expect(admin.container.textContent).toContain('No content types yet');
		expect(admin.container.querySelector('a[href="/admin/schema"]')).not.toBeNull();
		cleanup();

		const { container } = render(DashboardPage, {
			props: { data: data({ schemas: { ok: true, value: [] }, isAdmin: false, superAdmin: false }), form: null },
		});
		expect(container.textContent).toContain('Ask an administrator to create one.');
		expect(container.querySelector('a[href="/admin/schema"]')).toBeNull();
	});

	it('says each list could not be read rather than that it is empty', () => {
		const { container } = render(DashboardPage, {
			props: { data: data({ entries: null, audit: null, deadLetters: null, errors: null }), form: null },
		});

		const text = container.textContent ?? '';
		expect(text).toContain('Could not load recent entries. Reload the page to try again.');
		expect(text).toContain('Could not load the audit log. Reload the page to try again.');
		expect(text).toContain('Could not load the dead letter queue. Reload the page to try again.');
		expect(text).toContain('Could not load the log. Reload the page to try again.');
		expect(text).not.toContain('No entries yet.');
		expect(text).not.toContain('No deliveries are waiting');
	});

	it('says each list is empty when its read answered with nothing', () => {
		const { container } = render(DashboardPage, { props: { data: data(), form: null } });

		const text = container.textContent ?? '';
		expect(text).toContain('No entries yet.');
		expect(text).toContain('No audit entries yet.');
		expect(text).toContain('No deliveries are waiting in the dead letter queue.');
		expect(text).toContain('No errors logged in the last 24 hours.');
	});

	it('links each recent entry to its editor', () => {
		const { container } = render(DashboardPage, {
			props: {
				data: data({
					entries: [{ id: 'e1', schema: 'post', title: 'Hello', slug: 'hello', status: 'published', updated_at: '2026-09-13T00:00:00Z' }],
				}),
				form: null,
			},
		});

		const link = container.querySelector('a[href="/admin/content/post/e1"]');
		expect(link?.textContent).toContain('Hello');
	});
});

/*
 * The window is chosen by link, so it survives a reload and needs no script.
 * The tiles and the chart say which window they were measured over, because
 * a number with no period is not a rate.
 */
describe('dashboard window', () => {
	it('offers the three windows and marks the current one', () => {
		const { container } = render(DashboardPage, {
			props: { data: data({ window: '7d' }), form: null },
		});

		const links = [...container.querySelectorAll('a[href^="/admin?window="]')];
		expect(links.map((a) => a.getAttribute('href'))).toEqual([
			'/admin?window=6h',
			'/admin?window=24h',
			'/admin?window=7d',
		]);
		expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, null, 'page']);
		expect(container.textContent).toContain('Requests, 7d');
	});

	// The labels are two and three characters, so the segments drew 35 to 42px
	// wide and their touch hit areas shared the gaps between them.
	it('gives each window segment the control width under a finger', () => {
		const { container } = render(DashboardPage, {
			props: { data: data({ window: '7d' }), form: null },
		});
		for (const link of container.querySelectorAll('a[href^="/admin?window="]')) {
			expect(link.className).toContain('coarse:min-w-control');
		}
	});

	it('does not offer a window to an editor, whose tiles are not windowed', () => {
		const { container } = render(DashboardPage, {
			props: { data: data({ isAdmin: false }), form: null },
		});

		expect(container.querySelector('a[href^="/admin?window="]')).toBeNull();
	});
});

/*
 * The tiles say how many. The list says which, and links to the screen that
 * fixes each one, so an operator does not read a red number and then go
 * looking for its cause.
 */
describe('needs attention', () => {
	it('says so when nothing does', () => {
		const { container } = render(DashboardPage, { props: { data: data(quiet), form: null } });

		expect(container.textContent).toContain('Nothing needs attention in the last 24 hours.');
	});

	it('does not call the engine quiet when the security report could not be read', () => {
		const { container } = render(DashboardPage, { props: { data: data({ ...quiet, controlFailures: null }), form: null } });

		expect(container.textContent).toContain('No problems in the tiles that loaded.');
	});

	it('does not call the engine quiet when a tile could not be read', () => {
		const { container } = render(DashboardPage, { props: { data: data({ ...quiet, jobs: null }), form: null } });

		const text = container.textContent ?? '';
		expect(text).not.toContain('Nothing needs attention in the last 24 hours.');
		expect(text).toContain('No problems in the tiles that loaded.');
	});

	it('lists each item with its link', () => {
		const { container } = render(DashboardPage, {
			props: {
				data: data({
					attention: [
						{ tone: 'danger', text: 'Job nightly failed on its last run.', href: '/admin/jobs?edit=j1', action: 'Open job' },
						{ tone: 'warn', text: '2 webhooks are unhealthy.', href: '/admin/webhooks', action: 'Webhooks' },
					],
				}),
				form: null,
			},
		});

		const text = container.textContent ?? '';
		expect(text).toContain('Job nightly failed on its last run.');
		expect(container.querySelector('a[href="/admin/jobs?edit=j1"]')?.textContent).toContain('Open job');
		expect(container.querySelector('a[href="/admin/webhooks"]')).not.toBeNull();
		expect(text).not.toContain('Nothing needs attention');
		expect(text).not.toContain('No problems in the tiles that loaded.');
	});

	it('is not shown to an editor', () => {
		const { container } = render(DashboardPage, {
			props: { data: data({ isAdmin: false }), form: null },
		});

		expect(container.textContent).not.toContain('Needs attention');
	});
});

describe('traffic', () => {
	it('draws the trend and the busiest endpoints when both were read', () => {
		const { container } = render(DashboardPage, {
			props: {
				data: data({
					traffic: [
						{ hour: '2026-09-13T10:00:00Z', requests: 10, errorRate: 0 },
						{ hour: '2026-09-13T11:00:00Z', requests: 0, errorRate: 0 },
					],
					endpoints: [{ key: '/api/v1/content', requests: 9, errorRate: 0.1, p95: 20 }],
				}),
				form: null,
			},
		});

		const text = container.textContent ?? '';
		expect(text).toContain('Requests per hour');
		expect(container.querySelectorAll('[data-requests]').length).toBe(2);
		expect(text).toContain('/api/v1/content');
		expect(text).toContain('10.0%');
	});

	it('says which read failed rather than hiding the section', () => {
		const { container } = render(DashboardPage, {
			props: {
				data: data({ traffic: null, endpoints: [] }),
				form: null,
			},
		});

		const text = container.textContent ?? '';
		expect(text).toContain('Could not load the trend. Reload the page to try again.');
		expect(text).toContain('No requests in this window.');
	});

	it('is absent when nothing about traffic could be read', () => {
		const { container } = render(DashboardPage, { props: { data: data(), form: null } });

		expect(container.textContent).not.toContain('Requests per hour');
	});
});

describe('the chosen home page', () => {
	it('says the chosen home page could not be read, with a way to try again', () => {
		render(DashboardPage, { props: { data: data({ homePage: null, homeBlocks: [], home: { slug: 'welcome', gate: { state: 'unavailable' } } }), form: null } });
		expect(document.body.textContent).toContain('so the home page did not load');
		expect(screen.getByRole('link', { name: /Try again/ }).getAttribute('href')).toBe('/admin');
	});

	it('says the chosen home page no longer exists when the engine has none by that name', () => {
		render(DashboardPage, { props: { data: data({ homePage: null, homeBlocks: [], home: { slug: 'welcome', gate: { state: 'absent' } } }), form: null } });
		expect(document.body.textContent).toContain('The home page set in Customization, welcome, no longer exists.');
	});

	it('says nothing when the tenant chose no home page', () => {
		render(DashboardPage, { props: { data: data({ homePage: null, homeBlocks: [], home: null }), form: null } });
		expect(document.body.textContent).not.toContain('home page');
	});
});

describe('the missing home page for each role', () => {
	const missing = { homePage: null, homeBlocks: [], home: { slug: 'welcome', gate: { state: 'absent' } } };

	it('tells an admin where to choose another', () => {
		render(DashboardPage, { props: { data: data({ ...missing, isAdmin: true }), form: null } });
		expect(document.body.textContent).toContain('Choose another one in Customization.');
	});

	// The plugin answers 404 for a page hidden from the reader's role as well
	// as for a missing one, so a reader outside its roles sees the dashboard
	// without it and is told nothing, not even its slug.
	it('says nothing to a reader for whom the page was not found', () => {
		render(DashboardPage, { props: { data: data({ ...missing, isAdmin: false, superAdmin: false }), form: null } });
		expect(document.body.textContent).not.toContain('home page');
		expect(document.body.textContent).not.toContain('welcome');
	});

	it('keeps Try again for a reader when the page could not be read', () => {
		const down = { ...missing, home: { slug: 'welcome', gate: { state: 'unavailable' } } };
		render(DashboardPage, { props: { data: data({ ...down, isAdmin: false, superAdmin: false }), form: null } });
		expect(document.body.textContent).toContain('so the home page did not load');
		expect(screen.getByRole('link', { name: /Try again/ })).toBeTruthy();
	});
});

describe('a composed dashboard that could not be read', () => {
	const unread = "Could not load this tenant's own dashboard. Showing the standard one.";

	it('says the stock dashboard stands in for it, with a way to try again', () => {
		render(DashboardPage, { props: { data: data({ layoutUnread: true }), form: null } });
		expect(document.body.textContent).toContain(unread);
		expect(screen.getByRole('link', { name: /Try again/ }).getAttribute('href')).toBe('/admin');
	});

	it('says nothing when the layout was read', () => {
		render(DashboardPage, { props: { data: data({ layoutUnread: false }), form: null } });
		expect(document.body.textContent).not.toContain(unread);
	});
});
