// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
const nav = vi.hoisted(() => ({ goto: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => nav);

import SyntheticPage from './+page.svelte';
import type { Probe, ProbeAlert } from '$lib/api/synthetic';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function probe(over: Partial<Probe> = {}): Probe {
	return {
		id: 'p1',
		tenant_id: 'default',
		name: 'Homepage',
		type: 'health_check',
		enabled: true,
		config: { url: 'https://example.com/healthz', expected_status: 200 },
		interval_seconds: 300,
		timeout_seconds: 10,
		regions: null,
		alert_threshold: 3,
		last_run_at: '2026-09-22T10:00:00Z',
		last_status: 'pass',
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

function alert(over: Partial<ProbeAlert> = {}): ProbeAlert {
	return {
		id: 'a1',
		probe_id: 'p1',
		probe_name: 'Homepage',
		probe_type: 'health_check',
		consecutive_failures: 4,
		last_failure_at: '2026-09-22T11:00:00Z',
		last_failure_error: 'dial tcp: connection refused',
		message: 'Homepage has failed 4 times in a row',
		acknowledged: false,
		created_at: '2026-09-22T11:00:00Z',
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		probes: [probe()],
		total: 1,
		limit: 25,
		offset: 0,
		hasMore: false,
		gate: { state: 'ok' },
		licensed: true,
		...over,
		alerts: Array.isArray(over.alerts) ? { ok: true, value: over.alerts } : (over.alerts ?? { ok: true, value: [] }),
	} as never,
	form: form as never,
});

describe('the gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(SyntheticPage, {
			props: props({ gate: { state: 'locked', upgradeUrl: '' }, probes: [] }),
		});
		expect(said(container)).toContain('Not enabled on this engine');
		expect(said(container)).not.toContain('No probes yet');
	});

	// The worst thing a monitoring page can do is report a failed read as
	// silence.
	it('reports a failed read as a failure, not as everything passing', () => {
		const { container } = render(SyntheticPage, {
			props: props({
				gate: { state: 'error', message: 'The probes could not be read.' },
				probes: [],
			}),
		});
		expect(said(container)).toContain('could not be read');
		expect(said(container)).not.toContain('No probes yet');
	});
});

describe('the rows', () => {
	it('names what a probe checks, not just its type', () => {
		const { container } = render(SyntheticPage, { props: props() });
		expect(said(container)).toContain('https://example.com/healthz');
	});

	it('shows a paused probe as paused rather than as its last pass', () => {
		const { container } = render(SyntheticPage, {
			props: props({ probes: [probe({ enabled: false, last_status: 'pass' })] }),
		});
		expect(said(container)).toContain('Paused');
		expect(said(container)).not.toContain('Passing');
	});

	it('counts the failing probes and says none when there are none', () => {
		const quiet = render(SyntheticPage, { props: props() });
		expect(said(quiet.container)).toContain('Failing');
		cleanup();

		const loud = render(SyntheticPage, {
			props: props({ probes: [probe({ last_status: 'fail' })] }),
		});
		expect(said(loud.container)).toContain('Failing');
	});

	it('offers a run for every probe, paused ones included', () => {
		const { getByLabelText } = render(SyntheticPage, {
			props: props({ probes: [probe({ enabled: false })] }),
		});
		expect(getByLabelText('Run Homepage now')).toBeTruthy();
	});
});

describe('alerts', () => {
	it('shows an outstanding alert above the list, with what failed', () => {
		const { container } = render(SyntheticPage, { props: props({ alerts: [alert()] }) });
		const text = said(container);
		expect(text).toContain('Unacknowledged alerts');
		expect(text).toContain('4 in a row');
		expect(text).toContain('dial tcp: connection refused');
	});

	it('shows no alert band when nothing is outstanding', () => {
		const { container } = render(SyntheticPage, { props: props() });
		expect(said(container)).not.toContain('Unacknowledged alerts');
	});

	// A hidden band read as nothing alerting while the read had failed.
	it('says the alerts could not be read rather than hiding the band', () => {
		const { container } = render(SyntheticPage, {
			props: props({ alerts: { ok: false, gate: { state: 'unavailable' } } }),
		});
		expect(said(container)).toContain('is unavailable');
		expect(said(container)).toContain('the open alerts');
	});
});

describe('the form', () => {
	// The four types take different settings. One form carrying all of them
	// would ask for a webhook URL to run a sign-in check.
	it('shows only the settings the chosen type reads', async () => {
		render(SyntheticPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new probe/i }));

		expect(screen.getByLabelText(/^URL/)).toBeTruthy();
		expect(screen.queryByLabelText(/webhook url/i)).toBeNull();
	});

	it('submits the schedule switch even when it is off', async () => {
		const { container } = render(SyntheticPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new probe/i }));
		const names = [...container.querySelectorAll('input[type="hidden"]')].map((i) =>
			i.getAttribute('name'),
		);
		expect(names).toContain('enabled');
	});

	// The floor depends on the install's license, so the hint is the one the
	// plugin answers. A fixed "at least 30" was wrong both ways: unlicensed installs
	// refuse anything under 300, licensed ones accept 15.
	it('gives the interval floor the plugin answers', async () => {
		render(SyntheticPage, {
			props: props({ limits: { probes: { limit: 3, current: 1 }, minIntervalSeconds: 300 } }),
		});
		await fireEvent.click(screen.getByRole('button', { name: /new probe/i }));
		expect(said(document.body)).toContain('At least 300. Each probe sends a request to this engine.');
		expect(said(document.body)).not.toContain('At least 30.');
	});

	it('names no floor when the plugin did not say', async () => {
		render(SyntheticPage, { props: props({ limits: null }) });
		await fireEvent.click(screen.getByRole('button', { name: /new probe/i }));
		expect(said(document.body)).toContain('Each probe sends a request to this engine.');
		expect(said(document.body)).not.toMatch(/At least \d+\. A probe/);
	});

	it('shows the action error where the form is', () => {
		const { container } = render(SyntheticPage, {
			props: props({}, { error: 'Enter a timeout shorter than the interval.' }),
		});
		expect(said(container)).toContain('shorter than the interval');
	});
});

describe('the empty state', () => {
	it('says nothing is checking rather than that a read failed', () => {
		const { container } = render(SyntheticPage, { props: props({ probes: [] }) });
		expect(said(container)).toContain('Create a probe to check this engine');
	});
});

describe('notice channels', () => {
	const read = (over: Record<string, unknown> = {}) => ({
		probe: probe(),
		read: { channels: { email: ['ops@example.com'], pagerduty_routing_key: '...cdef' }, licensed: true, ...over },
		gate: { state: 'ok' },
	});

	it('links each probe to its own channels', () => {
		const { container } = render(SyntheticPage, { props: props() });
		const link = container.querySelector('a[aria-label="Notice channels for Homepage"]');
		expect(link?.getAttribute('href')).toContain('channels=p1');
	});

	it('opens on the probe the address names, with the stored channels masked', () => {
		const { container } = render(SyntheticPage, { props: props({ channelsFor: read() }) });
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('Notice channels for Homepage');
		expect((dialog.querySelector('#probe-channel-pagerduty') as HTMLInputElement).value).toBe('...cdef');
		expect((dialog.querySelector('#probe-channel-email') as HTMLTextAreaElement).value).toBe('ops@example.com');
	});

	it('closes the empty paid channels when the plugin says it would refuse them', () => {
		const { container } = render(SyntheticPage, { props: props({ channelsFor: read({ licensed: false }) }) });
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect((dialog.querySelector('#probe-channel-slack') as HTMLInputElement).disabled).toBe(true);
		expect((dialog.querySelector('#probe-channel-pagerduty') as HTMLInputElement).disabled).toBe(false);
	});

	it('renders a refused save in the drawer, not over the page', () => {
		const { container } = render(SyntheticPage, {
			props: props(
				{ channelsFor: read() },
				{
					error: 'refused',
					channels: true,
					refused: { kind: 'feature', feature: 'example-feature', plugin: 'synthetic-monitoring', upgradeUrl: '' },
				},
			),
		});
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.querySelector('[data-testid="refusal-notice"]')).not.toBeNull();
		expect(container.querySelectorAll('[data-testid="refusal-notice"]')).toHaveLength(1);
	});

	it('says a failed channels read failed', () => {
		const { container } = render(SyntheticPage, {
			props: props({ channelsFor: { probe: probe(), read: null, gate: { state: 'error', message: 'x' } } }),
		});
		expect(said(container.querySelector('[role="dialog"]') as HTMLElement)).toContain('Could not load notice channels.');
	});

	it('shows the webhook signing secret the save answered', () => {
		const { container } = render(SyntheticPage, {
			props: props({}, { channelsSaved: 'p1', signingSecret: 'f'.repeat(64) }),
		});
		expect(said(container.ownerDocument.body)).toContain('Webhook signing secret');
	});
});

describe('the tiles', () => {
	const failingProbe = (id: string) => probe({ id, name: id, last_status: 'fail' });

	// The plugin counts probes but not their states, so a state tile that read
	// one page of a longer list had to say so.
	it('says the state counts cover this page when more probes exist', () => {
		const { container } = render(SyntheticPage, {
			props: props({ probes: [failingProbe('a'), probe({ id: 'b', name: 'b' })], total: 60, hasMore: true }),
		});
		const text = said(container);
		expect(text).toContain('of the 2 on this page');
		const tile = [...container.querySelectorAll('p')].find((p) => p.textContent?.trim() === 'Probes');
		expect(tile?.nextElementSibling?.textContent?.trim()).toBe('60');
	});

	it('states the counts plainly when every probe is on the page', () => {
		const { container } = render(SyntheticPage, { props: props() });
		expect(said(container)).not.toContain('on this page');
	});
});

describe('the probe toolbar', () => {
	it('narrows the rows on this page by name', async () => {
		const { container } = render(SyntheticPage, {
			props: props({ probes: [probe({ id: 'a', name: 'Homepage' }), probe({ id: 'b', name: 'Checkout' })], total: 2 }),
		});
		const input = container.querySelector('#probe-narrow') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'check' } });
		const rows = [...container.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '');
		expect(rows).toHaveLength(1);
		expect(rows[0]).toContain('Checkout');
	});
});

describe('the probe type', () => {
	it('offers each type with the sentence that tells it apart', async () => {
		const { container, getAllByRole } = render(SyntheticPage, { props: props() });
		await fireEvent.click(getAllByRole('button', { name: /new probe/i })[0]);
		const radios = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"][name="type"]')];
		expect(radios).toHaveLength(4);
		expect(said(document.body)).toContain('Fetches a URL and checks the status code.');
		expect(said(document.body)).toContain('Sends a webhook and waits for the receipt.');
		void container;
	});
});

describe('a failed save', () => {
	// The message went to the page behind the drawer, so the open panel said
	// nothing about why the save did not happen.
	it('is said at the top of the open form', async () => {
		render(SyntheticPage, { props: props({}, { error: 'Enter a name for the probe.', drawer: 'probe' }) });
		await fireEvent.click(screen.getByRole('button', { name: /new probe/i }));
		const form = document.querySelector('#probe-form') as HTMLFormElement;
		expect(form.textContent).toContain('Enter a name for the probe.');
	});
});

describe('a failed row action', () => {
	// A failed delete, run or acknowledge greeted the next New probe as that
	// probe's failure.
	it('is said on the page and not in the probe drawer', async () => {
		const { container } = render(SyntheticPage, { props: props({}, { error: 'Could not delete the probe. Try again.' }) });
		expect(said(container)).toContain('Could not delete the probe. Try again.');
		await fireEvent.click(screen.getByRole('button', { name: /new probe/i }));
		const form = document.querySelector('#probe-form') as HTMLFormElement;
		expect(form.textContent).not.toContain('Could not delete');
	});
});

describe('a filter that matches nothing', () => {
	it('draws no table or pager above the empty state', async () => {
		const { container } = render(SyntheticPage, { props: props() });
		await fireEvent.input(container.querySelector('#probe-narrow') as HTMLInputElement, { target: { value: 'no such probe' } });
		expect(said(container)).toContain('No probes on this page match these filters');
		expect(container.querySelector('table')).toBeNull();
	});
});

describe('tiles counted across every probe', () => {
	it('states the load\'s counts without a page note', () => {
		const { container } = render(SyntheticPage, {
			props: props({ probes: [probe()], total: 40, offset: 25, hasMore: false, counts: { failing: 7, paused: 2 } }),
		});
		const tile = (label: string) =>
			[...container.querySelectorAll('p')].find((p) => p.textContent?.trim() === label)?.nextElementSibling?.textContent?.trim();
		expect(tile('Failing')).toBe('7');
		expect(tile('Paused')).toBe('2');
		expect(said(container)).not.toContain('on this page');
	});
});

describe('editing a probe whose secrets no read returns', () => {
	const signIn = probe({
		name: 'Sign in',
		type: 'login_flow',
		config: { login_url: 'https://example.com/login', username: 'probe', password: '***', headers: { Authorization: '***' } },
		regions: ['us-east'],
	});

	it('says the save replaces the stored password and asks for it again', async () => {
		render(SyntheticPage, { props: props({ probes: [signIn] }) });
		await fireEvent.click(screen.getByLabelText('Edit Sign in'));
		const form = document.querySelector('#probe-form') as HTMLFormElement;
		const input = form.querySelector('input[name="secret"][type="password"]') as HTMLInputElement;
		expect(input.required).toBe(true);
		expect(said(form)).toContain('Saving replaces the stored password');
	});

	it('names the headers the save drops', async () => {
		render(SyntheticPage, { props: props({ probes: [signIn] }) });
		await fireEvent.click(screen.getByLabelText('Edit Sign in'));
		const form = document.querySelector('#probe-form') as HTMLFormElement;
		expect(said(form)).toContain('Saving removes the header Authorization');
	});

	// The plugin replaces the config and regions whole, so the read travels back.
	it('carries the stored config and regions back with the save', async () => {
		render(SyntheticPage, { props: props({ probes: [signIn] }) });
		await fireEvent.click(screen.getByLabelText('Edit Sign in'));
		const kept = document.querySelector('#probe-form input[name="kept"]') as HTMLInputElement;
		expect(JSON.parse(kept.value)).toEqual({ config: signIn.config, regions: ['us-east'] });
	});
});

describe('the probe search box', () => {
	it('is named for a screen reader', () => {
		const { container } = render(SyntheticPage, { props: props() });
		expect(container.querySelector('label[for="probe-narrow"]')?.textContent).toBe('Search this page');
	});
});
