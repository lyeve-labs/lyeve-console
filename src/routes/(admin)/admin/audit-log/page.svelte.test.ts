// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '@sveltejs/kit';
import type { Entitlements } from '$lib/entitlements';

vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/admin/audit-log') },
}));

/*
 * The submit function is the unit under test for the prune gate: enhance awaits
 * it before it sends anything, so canceling inside it is what stops the
 * request. Capturing it here drives that directly rather than through the DOM's
 * submit plumbing.
 */
const forms = vi.hoisted(() => ({ submits: [] as SubmitFunction[] }));
vi.mock('$app/forms', () => ({
	enhance: (_el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.submits.push(fn);
		return { destroy: () => {} };
	},
}));

/*
 * The prune dialog is opened through the kit's dialog manager, which renders
 * through a container the layout mounts and this test does not. The call is
 * captured instead: what it was asked to show, and what the page does with the
 * answer.
 */
const kit = vi.hoisted(() => ({ openDialog: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	openDialog: kit.openDialog,
}));

import AuditLogPage from './+page.svelte';

beforeEach(() => {
	forms.submits = [];
	kit.openDialog.mockReset();
	kit.openDialog.mockResolvedValue(false);
});

afterEach(cleanup);

const entitlements: Entitlements = {
	plan: 'example',
	state: 'active',
	features: ['audit'],
	tenant_quota: 1,
};

function entries(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `e${from + i}`,
		action: 'create.content',
		resource_type: 'content',
		resource_id: 'r1',
		user_id: 'u1',
		ip: '10.0.0.1',
		user_agent: 'agent',
		created_at: '2026-01-01T00:00:00Z',
	}));
}

function data(overrides: Record<string, unknown> = {}) {
	const merged: Record<string, unknown> = {
		entitlements,
		user: { id: 'u1', roles: ['super_admin'] },
		entries: entries(50),
		total: 13043,
		offset: 0,
		limit: 50,
		isSuperAdmin: true,
		filter: { q: '', action: '', from: '', to: '' },
		actions: ['create.content'],
		...overrides,
	};
	// The load hands the rows over as a read that answered, unless a case
	// passes the failed read itself.
	if (Array.isArray(merged.entries)) merged.entries = { ok: true, value: merged.entries };
	return merged;
}

function pager(container: HTMLElement, label: string): HTMLAnchorElement | undefined {
	// The kit's pager draws its steps as an arrow and names them in aria-label,
	// so a step is found by its accessible name and not by the text it carries.
	return [...container.querySelectorAll('a')].find(
		(a) => a.textContent?.includes(label) || a.getAttribute('aria-label')?.includes(label)
	);
}

// The pager has to work from the server-rendered document. Driven from a click
// handler it is inert until the page hydrates, which on a slow page is long
// enough for a person to click it and see nothing happen.
describe('Audit log pagination', () => {
	it('offers the next page as a link carrying the advanced offset', () => {
		const { container } = render(AuditLogPage, {
			props: { data: data() as never, form: null as never },
		});

		expect(pager(container, 'Next')?.getAttribute('href')).toBe(
			'/admin/audit-log?offset=50',
		);
	});

	it('links back to the previous page once past the first', () => {
		const { container } = render(AuditLogPage, {
			props: { data: data({ offset: 100 }) as never, form: null as never },
		});

		expect(pager(container, 'Prev')?.getAttribute('href')).toBe(
			'/admin/audit-log?offset=50',
		);
	});

	it('offers no way forward from the last page', () => {
		// The kit's pager keeps both steps on screen and marks the one that
		// leads nowhere, rather than removing it: a control that disappears
		// moves the one beside it under the finger already reaching for it.
		const { container } = render(AuditLogPage, {
			props: {
				data: data({ offset: 13000, entries: entries(43, 13000) }) as never,
				form: null as never,
			},
		});

		const next = container.querySelector('[aria-label="Next page"]') as HTMLButtonElement;
		expect(next.tagName).toBe('BUTTON');
		expect(next.disabled).toBe(true);
	});
});

/*
 * Prune destroys the audit history, which is the record that would show what
 * happened. It is one small control in the header, and the cut-off is asked
 * for inside the confirmation so the question and the date are one step.
 */
describe('Audit log prune', () => {
	function setup(overrides: Record<string, unknown> = {}) {
		return render(AuditLogPage, { props: { data: data(overrides) as never, form: null as never } });
	}

	it('sits in the header beside the exports, as a small secondary control', () => {
		const { getByRole, getAllByRole } = setup();
		const prune = getByRole('button', { name: /prune/i });
		const exportAll = getAllByRole('button', { name: /export/i })[0];
		expect(prune.className).toBe(exportAll.className);
		expect(prune.className).toContain('text-sm');
		// Retention is a tab of its own, so only the entries render here.
		expect([...document.querySelectorAll('h2')].map((h) => h.textContent?.trim())).toEqual(['Entries']);
	});

	it('is withheld from an admin who cannot prune', () => {
		const { queryByRole } = setup({ isSuperAdmin: false });
		expect(queryByRole('button', { name: /prune/i })).toBeNull();
	});

	it('opens a confirmation that holds the date, and sends nothing when declined', async () => {
		const { getByRole } = setup();
		const form = document.querySelector('form[action="?/prune"]') as HTMLFormElement;
		const submit = vi.spyOn(form, 'requestSubmit').mockImplementation(() => {});

		await fireEvent.click(getByRole('button', { name: /prune/i }));
		await tick();

		expect(kit.openDialog).toHaveBeenCalledTimes(1);
		const options = (kit.openDialog.mock.calls[0] as unknown[])[0] as { title: string; body: unknown; footer: unknown };
		expect(options.title).toContain('Prune');
		expect(options.body, 'the dialog carries no body for the date picker').toBeTypeOf('function');
		expect(options.footer).toBeTypeOf('function');
		expect(submit).not.toHaveBeenCalled();
	});

	it('sends nothing when the dialog agreed but no date was chosen', async () => {
		kit.openDialog.mockResolvedValue(true);
		const { getByRole } = setup();
		const form = document.querySelector('form[action="?/prune"]') as HTMLFormElement;
		const submit = vi.spyOn(form, 'requestSubmit').mockImplementation(() => {});

		await fireEvent.click(getByRole('button', { name: /prune/i }));
		await tick();
		await tick();

		expect(submit).not.toHaveBeenCalled();
	});

	it('leaves the export forms alone', () => {
		setup();
		// Only prune is enhanced, so only prune is gated.
		expect(forms.submits).toHaveLength(1);
	});
});

/*
 * The toolbar carries the search, the action filter and the date range as a
 * GET form, so a filtered view is an address.
 */
describe('Audit log toolbar', () => {
	it('puts the search at the leading edge and the filters after it', () => {
		const { container } = render(AuditLogPage, { props: { data: data() as never, form: null as never } });
		const bar = container.querySelector('[role="toolbar"]')!;
		const search = bar.querySelector('input[name="q"]')!;
		const action = bar.querySelector('#audit-action')!;
		expect(search.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(bar.querySelector('input[name="from"]')).toBeTruthy();
		expect(bar.querySelector('input[name="to"]')).toBeTruthy();
	});

	it('offers the actions on the page plus the one in force', () => {
		const { container } = render(AuditLogPage, {
			props: { data: data({ actions: ['content.delete', 'schema.create'] }) as never, form: null as never },
		});
		expect(container.textContent).toContain('All actions');
		expect(container.querySelector('[role="toolbar"]')?.textContent).toContain('All actions');
	});

	it('exports the filter in force and says how far an export goes', () => {
		const { container } = render(AuditLogPage, {
			props: {
				data: data({
					filter: { q: 'content', action: 'content.delete', from: '2026-01-01', to: '' },
					exportNote: 'Exports include the entries that match the dates, action and resource type, up to 100,000.',
				}) as never,
				form: null as never,
			},
		});
		const exportForm = container.querySelector('form[action="/admin/audit-log/export"]') as HTMLFormElement;
		const sent = new FormData(exportForm);
		expect(sent.get('action')).toBe('content.delete');
		expect(sent.get('from')).toBe('2026-01-01');
		expect(sent.get('q')).toBe('content');
		expect(sent.has('to')).toBe(false);
		expect(container.textContent).toContain('up to 100,000');
	});

	// A proxy in front of the console and the engine sends every /api/ path to
	// the engine, so the console's download routes have to live outside it.
	it('posts both exports to the console, never to an engine path', () => {
		const { container } = render(AuditLogPage, { props: { data: data() as never, form: null as never } });
		const actions = [...container.querySelectorAll('form[method="POST"]')]
			.map((f) => f.getAttribute('action') ?? '')
			.filter((a) => a.includes('export'));
		expect(actions).toEqual(['/admin/audit-log/export', '/admin/audit-log/export-all']);
		for (const action of actions) expect(action.startsWith('/api/')).toBe(false);
	});

	it('names the two date filters for a screen reader', () => {
		const { getByLabelText } = render(AuditLogPage, { props: { data: data() as never, form: null as never } });
		expect(getByLabelText('From').id).toBe('audit-from');
		expect(getByLabelText('To').id).toBe('audit-to');
	});

	it('carries the filter through the pager', () => {
		const { container } = render(AuditLogPage, {
			props: {
				data: data({ filter: { q: 'content', action: '', from: '2026-01-01', to: '' } }) as never,
				form: null as never,
			},
		});
		expect(pager(container, 'Next')?.getAttribute('href')).toBe('/admin/audit-log?q=content&from=2026-01-01&offset=50');
	});
});

/*
 * The table is over a thousand accessibility nodes under the page title. With
 * no heading between the top of the page and the end of the table, a screen
 * reader user has no way to skim it or to jump past it.
 */
describe('Audit log regions', () => {
	function headings(container: HTMLElement): string[] {
		return [...container.querySelectorAll('h2')].map((h) => h.textContent?.trim() ?? '');
	}

	it('heads each region with a real level two heading', () => {
		const { container } = render(AuditLogPage, {
			props: { data: data() as never, form: null as never },
		});

		expect(headings(container)).toEqual(['Entries']);
	});

	// The heading names the region, not the page. A second "Audit log" would be
	// one more thing to read past rather than a way through the page.
	it('never restates the page title', () => {
		const { container } = render(AuditLogPage, {
			props: { data: data() as never, form: null as never },
		});

		for (const heading of headings(container)) {
			expect(heading.toLowerCase()).not.toBe('audit log');
		}
	});

	it('heads the table even when the collection is empty', () => {
		const { container } = render(AuditLogPage, {
			props: { data: data({ entries: [], total: 0 }) as never, form: null as never },
		});

		expect(headings(container)).toContain('Entries');
	});
});

/*
 * A failed read says so. The first-run state would tell the reader that
 * nothing on this instance has ever been recorded, which is the one thing an
 * audit log must never claim without having read it.
 */
describe('Audit log failed read', () => {
	const failed = {
		entries: { ok: false, gate: { state: 'error', message: 'Could not load the audit log.' } },
		total: null,
		actions: [],
	};

	it('shows the failure in place of the first-run state', () => {
		const { container } = render(AuditLogPage, { props: { data: data(failed) as never, form: null as never } });

		expect(container.textContent).toContain('Could not load the audit log');
		expect(container.textContent).not.toContain('No audit entries yet');
		expect(container.querySelector('table')).toBeNull();
	});

	it('states no entry count it did not read', () => {
		const { container } = render(AuditLogPage, { props: { data: data(failed) as never, form: null as never } });

		expect(container.textContent).not.toContain('0 entries');
	});

	it('names the role refusal for an admin the engine refused', () => {
		const { container } = render(AuditLogPage, {
			props: { data: data({ ...failed, entries: { ok: false, gate: { state: 'forbidden' } } }) as never, form: null as never },
		});

		expect(container.textContent).toContain('Your role cannot open audit log');
	});
});

/*
 * The count and the rows are two answers. Once a past-end page has been
 * corrected, the rows can still come back empty under a count above zero,
 * and the first-run state would then contradict the count beside it.
 */
describe('Audit log empty page under a count', () => {
	it('says the page is empty, not the log, and links to the first page', () => {
		const { container } = render(AuditLogPage, {
			props: { data: data({ entries: [], total: 120, offset: 100 }) as never, form: null as never },
		});
		expect(container.textContent).not.toContain('No audit entries yet');
		expect(container.textContent).toContain('No entries on this page');
		expect(container.textContent).toContain('The audit log has 120 entries, but none are on this page. Go to the first page.');
		const first = [...container.querySelectorAll('a')].find((a) => a.textContent?.includes('Go to the first page'));
		expect(first?.getAttribute('href')).toBe('/admin/audit-log');
	});

	it('keeps the first-run state for a log that holds nothing', () => {
		const { container } = render(AuditLogPage, {
			props: { data: data({ entries: [], total: 0 }) as never, form: null as never },
		});
		expect(container.textContent).toContain('No audit entries yet');
	});
});
