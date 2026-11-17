// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entitlements } from '#lib/entitlements.ts';
import type { Gate } from '#lib/api/gate.ts';
import JobsPage from './+page.svelte';

const state = vi.hoisted(() => ({ page: { url: new URL('http://localhost/admin/jobs') } }));
vi.mock('$app/state', () => state);
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
const nav = vi.hoisted(() => ({ goto: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => nav);

afterEach(cleanup);
beforeEach(() => {
	state.page.url = new URL('http://localhost/admin/jobs');
	nav.goto.mockClear();
});

const entitlements: Entitlements = { plan: 'example', state: 'active', features: ['cron'], tenant_quota: 1 };

const job = {
	id: 'j1',
	name: 'Nightly purge',
	description: 'Drops expired rows',
	schedule: '0 2 * * *',
	endpoint: 'https://example.test/purge',
	payload: { keep: 30 },
	enabled: false,
	last_run_at: null,
	last_status: null,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z',
};

function setup(extra: Record<string, unknown> = {}, form: Record<string, unknown> | null = null) {
	return render(JobsPage, {
		props: {
			data: { jobs: { ok: true, value: [job] }, limit: 50, offset: 0, q: '', status: '', hasMore: false, openNew: false, openJob: null, entitlements, ...extra },
			form,
		} as never,
	});
}

/*
 * A job is written in a drawer over its list, like every other row in the
 * admin, and the query can open the drawer.
 */
describe('the job drawer', () => {
	it('stays shut until asked for', () => {
		const { container } = setup();
		expect(container.querySelector('[role="dialog"]')).toBeNull();
	});

	it('opens empty from the header action and offers Create', async () => {
		const { container, getAllByRole } = setup();
		await fireEvent.click(getAllByRole('button', { name: /new job/i })[0]);
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('New job');
		expect((dialog.querySelector('#job-name') as HTMLInputElement).value).toBe('');
		expect(dialog.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Create');
	});

	it('opens on the row from its edit control, filled in, and offers Save', async () => {
		const { container, getByRole } = setup();
		await fireEvent.click(getByRole('button', { name: 'Edit Nightly purge' }));
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('Edit Nightly purge');
		expect((dialog.querySelector('#job-schedule') as HTMLInputElement).value).toBe('0 2 * * *');
		expect((dialog.querySelector('#job-payload') as HTMLTextAreaElement).value).toContain('"keep": 30');
		expect((dialog.querySelector('input[name="enabled"]') as HTMLInputElement).value).toBe('off');
		expect((dialog.querySelector('input[name="id"]') as HTMLInputElement).value).toBe('j1');
		expect(dialog.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Save');
	});

	it('opens on the job the address names', () => {
		state.page.url = new URL('http://localhost/admin/jobs?edit=j1');
		const { container } = setup({ openJob: job });
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('Edit Nightly purge');
	});

	it('opens empty when the address asks for a new job', () => {
		state.page.url = new URL('http://localhost/admin/jobs?new=1');
		const { container } = setup({ openNew: true });
		expect(container.querySelector('[role="dialog"]')?.textContent).toContain('New job');
	});

	it('keeps the page the reader had open when the drawer is put away', async () => {
		state.page.url = new URL('http://localhost/admin/jobs?offset=50&edit=j1');
		const { getByRole } = setup({ openJob: job, offset: 50 });
		await fireEvent.click(getByRole('button', { name: 'Cancel' }));
		expect(nav.goto).toHaveBeenCalledWith('/admin/jobs?offset=50', expect.objectContaining({ replace: true }));
	});

	it('posts each write with the page the reader had open, less the key that opened the drawer', () => {
		state.page.url = new URL('http://localhost/admin/jobs?offset=50&edit=j1');
		const { container } = setup({ openJob: job, offset: 50 });
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.querySelector('form')?.getAttribute('action')).toBe('?offset=50&/update');
		const remove = container.querySelector('form[action$="/delete"]') as HTMLFormElement;
		expect(remove.getAttribute('action')).toBe('?offset=50&/delete');
	});

	it('takes the query out of the address when the drawer is put away', async () => {
		state.page.url = new URL('http://localhost/admin/jobs?edit=j1');
		const { getByRole } = setup({ openJob: job });
		await fireEvent.click(getByRole('button', { name: 'Cancel' }));
		expect(nav.goto).toHaveBeenCalledWith('/admin/jobs', expect.objectContaining({ replace: true }));
	});
});

describe('the job list toolbar', () => {
	it('keeps the search on each status link and the pager', () => {
		const { container } = setup({ q: 'digest', status: 'enabled', hasMore: true });
		const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
		expect(hrefs).toContain('/admin/jobs?status=disabled&q=digest');
		expect(hrefs.some((h) => h.startsWith('/admin/jobs?status=enabled&q=digest&') && h.includes('offset=50'))).toBe(true);
	});

	it('offers to clear filters that match nothing, rather than offering a first job', () => {
		const { container } = setup({ jobs: { ok: true, value: [] }, q: 'nothing like it' });
		expect(container.textContent).toContain('No jobs match these filters');
		expect(container.textContent).not.toContain('No jobs yet');
		expect(container.querySelector('#job-search')).toBeTruthy();
		expect(container.querySelector('a[href="/admin/jobs"]')?.textContent?.trim()).toBe('Clear filters');
	});
});

describe('the job alert channels', () => {
	it('shows each stored channel masked, PagerDuty included, so a save keeps them', () => {
		const alerting = {
			...job,
			alerts: {
				email: ['ops@example.com'],
				slack_url: 'https://hooks.slack.com/...1a2b',
				pagerduty_routing_key: '...cdef',
				failure_threshold: 3,
			},
		};
		const { container } = setup({ jobs: { ok: true, value: [alerting] }, openJob: alerting });
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect((dialog.querySelector('#job-alert-slack') as HTMLInputElement).value).toBe('https://hooks.slack.com/...1a2b');
		const pd = dialog.querySelector('#job-alert-pagerduty') as HTMLInputElement;
		expect(pd.value).toBe('...cdef');
		expect(pd.name).toBe('alert_pagerduty_routing_key');
		expect(pd.disabled).toBe(false);
		expect((dialog.querySelector('input[name="alerts_stored"]') as HTMLInputElement).value).toBe('true');
	});
});

/*
 * The first-run state invites the reader to create the first job. Drawn over a
 * read that failed, it tells somebody whose engine is down that nothing is
 * scheduled.
 */
describe('the job list when it could not be read', () => {
	function failed(gate: Gate) {
		return setup({ jobs: { ok: false, gate } });
	}

	it('says the engine did not answer, with a way to try again, and offers no first job', () => {
		state.page.url = new URL('http://localhost/admin/jobs?offset=50');
		const { container, queryByRole, getByRole } = failed({ state: 'unavailable' });
		expect(container.textContent).toContain('Temporarily unavailable');
		expect(container.textContent).toContain('so scheduled jobs did not load. Try again in a moment.');
		expect(getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe('/admin/jobs?offset=50');
		expect(container.textContent).not.toContain('No jobs yet');
		expect(queryByRole('button', { name: /new job/i })).toBeNull();
	});

	it('names the role for a refusal and offers nothing to press', () => {
		const { container, queryByRole } = failed({ state: 'forbidden' });
		expect(container.textContent).toContain('Your role cannot open scheduled jobs. Ask a super admin if you need it.');
		expect(container.textContent).not.toContain('No jobs yet');
		expect(queryByRole('button', { name: /new job/i })).toBeNull();
		expect(queryByRole('link', { name: 'Try again' })).toBeNull();
	});

	it('states a failure in the page\'s words, with a way to try again', () => {
		const message = 'Could not load jobs.';
		const { container, getByRole, queryByRole } = failed({ state: 'error', message });
		expect(container.textContent).toContain(message);
		expect(getByRole('link', { name: 'Try again' })).toBeTruthy();
		expect(queryByRole('button', { name: /new job/i })).toBeNull();
	});

	it('draws neither the toolbar, the table nor the pager', () => {
		const answered = setup();
		expect(answered.container.querySelector('#job-search')).not.toBeNull();
		expect(answered.container.querySelector('table')).not.toBeNull();
		expect(answered.container.textContent).toContain('Jobs 1 to 1');
		cleanup();

		const { container } = failed({ state: 'unavailable' });
		expect(container.querySelector('#job-search')).toBeNull();
		expect(container.querySelector('table')).toBeNull();
		expect(container.textContent).not.toContain('Jobs 1 to');
	});

	it('keeps the first-run state for a list that answered empty', () => {
		const { container, getAllByRole } = setup({ jobs: { ok: true, value: [] } });
		expect(container.textContent).toContain('No jobs yet');
		expect(getAllByRole('button', { name: /new job/i })).toHaveLength(2);
		expect(container.textContent).not.toContain('Temporarily unavailable');
	});
});

describe('a failure from one form', () => {
	// A failed row delete read by the drawer greeted the next job as if its
	// own save had failed.
	it('keeps a failed delete out of the next job drawer', async () => {
		const { getByRole, container } = setup({}, { error: 'Could not delete the job. Try again.', action: 'delete' });
		expect(container.textContent).toContain('Could not delete the job. Try again.');
		await fireEvent.click(getByRole('button', { name: /New job/ }));
		const form = document.querySelector('#job-form') as HTMLFormElement;
		expect(form.textContent).not.toContain('Could not delete the job. Try again.');
	});

	it('says a failed save inside the open drawer', async () => {
		const rendered = setup();
		await fireEvent.click(rendered.getByRole('button', { name: /New job/ }));
		await rendered.rerender({ form: { error: 'Enter the payload as valid JSON.', action: 'create' } } as never);
		const form = document.querySelector('#job-form') as HTMLFormElement;
		expect(form.textContent).toContain('Enter the payload as valid JSON.');
	});

	it('keeps a failed create out of the edit drawer opened after it', async () => {
		const rendered = setup();
		await fireEvent.click(rendered.getByRole('button', { name: /New job/ }));
		await rendered.rerender({ form: { error: 'Enter the payload as valid JSON.', action: 'create' } } as never);
		await fireEvent.click(rendered.getByRole('button', { name: 'Cancel' }));
		await fireEvent.click(rendered.getByRole('button', { name: 'Edit Nightly purge' }));
		const form = document.querySelector('#job-form') as HTMLFormElement;
		expect(form.textContent).not.toContain('Enter the payload as valid JSON.');
	});

	it('keeps a drawer failure off the page behind another drawer', async () => {
		const rendered = setup();
		await fireEvent.click(rendered.getByRole('button', { name: /New job/ }));
		await rendered.rerender({ form: { error: 'Enter the payload as valid JSON.', action: 'create' } } as never);
		await fireEvent.click(rendered.getByRole('button', { name: 'Cancel' }));
		await fireEvent.click(rendered.getByRole('button', { name: 'Edit Nightly purge' }));
		expect(document.body.textContent).not.toContain('Enter the payload as valid JSON.');
	});

	it('keeps a failed update out of the next New job drawer', async () => {
		const rendered = setup();
		await fireEvent.click(rendered.getByRole('button', { name: 'Edit Nightly purge' }));
		await rendered.rerender({ form: { error: 'Schedule is not a cron expression.', action: 'update' } } as never);
		const form = () => document.querySelector('#job-form') as HTMLFormElement;
		expect(form().textContent).toContain('Schedule is not a cron expression.');
		await fireEvent.click(rendered.getByRole('button', { name: 'Cancel' }));
		await fireEvent.click(rendered.getAllByRole('button', { name: /New job/ })[0]);
		expect(form().textContent).not.toContain('Schedule is not a cron expression.');
	});
});

describe('a job with a payload', () => {
	it('says what clearing the payload sends', async () => {
		const { getByLabelText } = setup();
		await fireEvent.click(getByLabelText('Edit Nightly purge'));
		const form = document.querySelector('#job-form') as HTMLFormElement;
		expect(form.textContent).toContain('If you clear it, each run sends an empty JSON object.');
		expect((form.querySelector('input[name="had_payload"]') as HTMLInputElement).value).toBe('true');
	});
});

describe('a job link that opened nothing', () => {
	it('says the linked job was not found', () => {
		const { container } = setup({ openGate: { state: 'absent' } });
		expect(container.textContent).toContain('This job no longer exists.');
	});

	it('says the linked job could not be read, with a way to try again', () => {
		const { container, getByRole } = setup({ openGate: { state: 'unavailable' } });
		expect(container.textContent).toContain('so the linked job did not load');
		expect(getByRole('link', { name: /Try again/ })).toBeTruthy();
	});
});
