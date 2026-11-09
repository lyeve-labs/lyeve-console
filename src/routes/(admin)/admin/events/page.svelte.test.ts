// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '@sveltejs/kit';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));
const forms = vi.hoisted(() => ({ submits: [] as SubmitFunction[] }));
vi.mock('$app/forms', () => ({
	enhance: (_form: HTMLFormElement, submit: SubmitFunction) => {
		forms.submits.push(submit);
		return { destroy: () => {} };
	},
}));
const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

import EventsPage from './+page.svelte';
import type { EventRow, ReplayRun } from '$lib/api/events';

afterEach(cleanup);
beforeEach(() => {
	forms.submits = [];
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
});

function said(container: HTMLElement): string {
	return (container.textContent ?? '').replace(/\s+/g, ' ');
}

function row(over: Partial<EventRow> = {}): EventRow {
	return {
		id: 'e1',
		source: 'content',
		topic: 'content.created',
		schema_name: 'article',
		event_type: 'created',
		published_at: '2026-09-22T10:00:00Z',
		tenant_id: 't1',
		...over,
	};
}

function run(over: Partial<ReplayRun> = {}): ReplayRun {
	return {
		run_id: 'r1',
		status: 'completed',
		handler: 'webhook',
		since: '2026-09-22T09:00:00Z',
		dry_run: false,
		tenant_id: 't1',
		total_events: 4,
		replayed: 4,
		skipped: 0,
		failed: 0,
		started_at: '2026-09-22T10:00:00Z',
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		events: [row()],
		total: 1,
		limit: 50,
		offset: 0,
		gate: { state: 'ok' },
		licensed: true,
		...over,
		runs: Array.isArray(over.runs)
			? { ok: true, value: { rows: over.runs, total: over.runs.length } }
			: (over.runs ?? { ok: true, value: { rows: [], total: 0 } }),
	} as never,
	form: form as never,
});

describe('Events gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(EventsPage, { props: props({ gate: { state: 'locked', upgradeUrl: '' } }) });
		expect(said(container)).toContain('Not enabled on this engine');
		expect(said(container)).not.toContain('Published');
	});

	it('says the plugin is absent rather than that nothing was published', () => {
		const { container } = render(EventsPage, {
			props: props({ gate: { state: 'absent' }, events: [] }),
		});
		expect(said(container)).toContain('not included in this build');
	});
});

describe('Events replay', () => {
	// A replay publishes every event in the window again to every listener and
	// nothing undoes that, so the destructive option is never the default.
	it('rehearses by default', () => {
		const { container } = render(EventsPage, { props: props() });
		expect(said(container)).toContain('Rehearse');
		expect(container.querySelector('input[name="dry_run"]')).toHaveProperty('value', 'true');
	});

	it('warns that a real replay cannot be taken back', () => {
		const { container } = render(EventsPage, { props: props() });
		expect(said(container)).toContain('This cannot be undone.');
	});

	it('says plainly that a rehearsal posted nothing', () => {
		const { container } = render(EventsPage, {
			props: props({}, { started: 'r9', dryRun: true }),
		});
		expect(said(container)).toContain('Rehearsal started. It publishes nothing');
	});

	// The plugin publishes a replay through the same path as a live change,
	// so every listener hears it. The handler is only the run's name, which
	// decides what a later run under it skips.
	it('says a replay reaches every listener and the handler is a run name', () => {
		const { container, getByLabelText } = render(EventsPage, { props: props() });
		const text = said(container);
		expect(text).toContain('again to everything that listens');
		expect(text).toContain('A later run under the same name skips the events that name already replayed.');
		expect(text).not.toMatch(/to its handler|to a handler|Every handler/);
		expect(getByLabelText('Run name').getAttribute('name')).toBe('handler');
	});

	it('names a run that was given no name as the shared one', () => {
		const { container } = render(EventsPage, { props: props({ runs: [run({ handler: '' })] }) });
		const cell = container.querySelector('tbody tr td:nth-child(2)');
		expect(cell?.textContent?.trim()).toBe('Shared name');
	});

	it('marks a rehearsal in the run list so its counts are not misread', () => {
		const { container } = render(EventsPage, {
			props: props({ runs: [run({ dry_run: true, replayed: 400 })] }),
		});
		expect(said(container)).toContain('rehearsal');
		expect(said(container)).toContain('nothing was posted');
	});

	it('states progress against the total rather than the replayed count alone', () => {
		const { container } = render(EventsPage, {
			props: props({ runs: [run({ status: 'running', replayed: 1, skipped: 1, total_events: 4 })] }),
		});
		expect(said(container)).toContain('50% of 4');
	});
});

describe('starting a replay', () => {
	type Input = Parameters<SubmitFunction>[0];

	async function press(cancel = vi.fn()) {
		const after = await forms.submits[0]({ cancel } as unknown as Input);
		return { cancel, after };
	}

	async function fill(getByLabelText: (label: string) => HTMLElement, name: string) {
		await fireEvent.input(getByLabelText('Run name'), { target: { value: name } });
	}

	it('asks before a real replay and names the window and the run', async () => {
		const { getByLabelText, getByRole } = render(EventsPage, { props: props() });
		await fireEvent.click(getByRole('checkbox', { name: 'Rehearse without publishing' }));
		await fill(getByLabelText, 'backfill-oct');
		const { cancel } = await press();
		expect(kit.confirm).toHaveBeenCalledTimes(1);
		const [question] = kit.confirm.mock.calls[0] as unknown as [string];
		expect(question).toContain('backfill-oct');
		expect(question).toMatch(/^Replay every event since /);
		expect(cancel).toHaveBeenCalled();
	});

	it('names the shared run when no run name was given', async () => {
		const { getByRole } = render(EventsPage, { props: props() });
		await fireEvent.click(getByRole('checkbox', { name: 'Rehearse without publishing' }));
		await press();
		const [question] = kit.confirm.mock.calls[0] as unknown as [string];
		expect(question).toContain('the shared name');
	});

	it('rehearses without asking, because a rehearsal publishes nothing', async () => {
		render(EventsPage, { props: props() });
		const { cancel } = await press();
		expect(kit.confirm).not.toHaveBeenCalled();
		expect(cancel).not.toHaveBeenCalled();
	});

	// The run name decides which events a later run skips, so a rehearsal
	// followed by the real run has to go under the same name.
	it('keeps the run name once a run is answered', async () => {
		render(EventsPage, { props: props() });
		const { after } = await press();
		const update = vi.fn(async () => {});
		await (after as unknown as (o: { update: typeof update }) => Promise<void>)({ update });
		expect(update).toHaveBeenCalledWith({ reset: false });
	});
});

describe('Events log', () => {
	it('reads an empty log as a quiet instance', () => {
		const { container } = render(EventsPage, { props: props({ events: [], total: 0 }) });
		expect(said(container)).toContain('Events appear here when a plugin or a flow publishes one.');
	});

	it('marks an event that carries an error, which is why anyone replays', () => {
		const { container } = render(EventsPage, {
			props: props({ events: [row({ error: 'handler timed out' })] }),
		});
		expect(said(container)).toContain('error');
	});

	it('counts the failures separately from the total', () => {
		const { container } = render(EventsPage, {
			props: props({ events: [row(), row({ id: 'e2', error: 'boom' })], total: 2 }),
		});
		expect(said(container)).toContain('With errors');
	});
});

describe('figures that cover one page or failed', () => {
	// The engine counts no errors of its own, so the tile says it read one page.
	it('says the error count covers this page only', () => {
		const { container } = render(EventsPage, {
			props: props({ events: [row(), row({ id: 'e2', error: 'boom' })], total: 900 }),
		});
		expect(said(container)).toContain('of the 2 on this page');
	});

	it('counts every replay rather than the rows the panel shows', () => {
		const { container } = render(EventsPage, {
			props: props({ runs: { ok: true, value: { rows: [run()], total: 37 } } }),
		});
		const tile = [...container.querySelectorAll('p')].find((p) => p.textContent?.trim() === 'Replays');
		expect(tile?.nextElementSibling?.textContent?.trim()).toBe('37');
	});

	it('does not count zero replays when the run list failed', () => {
		const { container } = render(EventsPage, {
			props: props({ runs: { ok: false, gate: { state: 'unavailable' } } }),
		});
		const text = said(container);
		expect(text).toContain('is unavailable');
		const tile = [...container.querySelectorAll('p')].find((p) => p.textContent?.trim() === 'Replays');
		expect(tile?.nextElementSibling?.textContent?.trim()).not.toBe('0');
	});
});

describe('the search box', () => {
	it('is named for a screen reader', () => {
		const { container } = render(EventsPage, { props: props() });
		expect(container.querySelector('label[for="event-narrow"]')?.textContent).toBe('Search this page');
	});
});
