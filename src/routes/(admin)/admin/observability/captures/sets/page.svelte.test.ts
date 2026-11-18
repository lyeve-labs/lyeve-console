// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';

const forms = vi.hoisted(() => ({ submits: new Map<HTMLFormElement, unknown>() }));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, submit?: unknown) => {
		forms.submits.set(node, submit);
		return { destroy: () => forms.submits.delete(node) };
	},
}));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: vi.fn(async () => true),
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import SetsPage from './+page.svelte';

afterEach(cleanup);

type After = (o: { result: { type: string }; update: () => Promise<void> }) => Promise<void>;

/** Sends the form through its enhance handler, as a click would, and returns the result callback. */
async function send(form: HTMLFormElement): Promise<After> {
	const submit = forms.submits.get(form) as (o: { cancel: () => void; formData: FormData; formElement: HTMLFormElement }) => Promise<After>;
	const after = await submit({ cancel: vi.fn(), formData: new FormData(form), formElement: form });
	await tick();
	return after;
}

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const set = { id: 's1', name: 'Checkout', capture_ids: ['c1'], created_at: '2026-10-06T11:00:00Z' };

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		sets: [set],
		setsRead: true,
		setsGate: null,
		licensed: true,
		gate: { state: 'ok' },
		...over,
	} as never,
	form: form as never,
});

describe('replay results', () => {
	it('shows each capture diff of a batch replay', () => {
		const replay = {
			set_id: 's1',
			results: [
				{
					capture_id: 'c1',
					replay_id: 'x1',
					diff: {
						id1: 'c1',
						id2: 'x1',
						status_match: false,
						status_code1: 201,
						status_code2: 409,
						body_diff: '- {"id":1}\n+ {"error":"conflict"}',
						duration1_ms: 12,
						duration2_ms: 9,
					},
				},
				{ capture_id: 'gone', error: 'capture not found, it may have expired' },
			],
		};
		const { container } = render(SetsPage, { props: props({}, { replay }) });
		const results = screen.getByTestId('replay-results');
		expect(results.textContent).toContain('Replayed Checkout');
		expect(results.textContent).toContain('Status 201 then 409');
		expect(results.textContent).toContain('Changed');
		expect(results.textContent).toContain('{"error":"conflict"}');
		expect(results.textContent).toContain('it may have expired');
		expect(said(container)).toContain('0 of 2 returned the same response');
	});

	it('names each result by the method and path the replay answered', () => {
		const replay = {
			set_id: 's1',
			results: [
				{
					capture_id: 'off-page',
					method: 'PATCH',
					path: '/api/v1/content/orders/7',
					replay_id: 'x2',
					diff: { id1: 'off-page', id2: 'x2', status_match: true, status_code1: 200, status_code2: 200, duration1_ms: 4, duration2_ms: 5 },
				},
				{ capture_id: 'expired-one', error: 'capture not found, it may have expired' },
			],
		};
		render(SetsPage, { props: props({}, { replay }) });
		const results = screen.getByTestId('replay-results');
		expect(results.textContent).toContain('PATCH /api/v1/content/orders/7');
		expect(results.textContent).not.toContain('off-page');
		expect(results.textContent).toContain('expired-one');
	});

	it('asks to replay again with the writes when the set holds one', () => {
		const { container } = render(SetsPage, {
			props: props({}, { error: 'writes', needsWrites: 's1' }),
		});
		expect(said(container)).toContain('This set includes a write');
		expect(screen.getByRole('button', { name: 'Replay including writes' })).toBeTruthy();
	});
});

describe('no sets yet', () => {
	// The selection a set is made from is on the Captures tab now, so the
	// sentence links there rather than pointing below.
	it('sends the reader to the Captures tab to make one', () => {
		const { container } = render(SetsPage, { props: props({ sets: [] }) });
		expect(said(container)).toContain('Select captures on the Captures tab');
		expect(screen.getByRole('link', { name: 'Captures' }).getAttribute('href')).toBe('/admin/observability/captures');
	});
});

describe('the gate', () => {
	it('says the plugin is absent rather than showing an empty list', () => {
		const { container } = render(SetsPage, { props: props({ gate: { state: 'absent' }, sets: [], setsRead: false }) });
		expect(said(container)).toContain('not included in this build');
		expect(said(container)).not.toContain('No replay sets yet');
	});
});

describe('a failed delete', () => {
	it('says the set was not deleted', () => {
		const { container } = render(SetsPage, { props: props({}, { error: 'Could not delete the replay set. Try again.' }) });
		expect(said(container)).toContain('Could not delete the replay set. Try again.');
	});
});

describe('a failed side read', () => {
	it('says a refused sets read with its gate', () => {
		const { container } = render(SetsPage, {
			props: props({ sets: [], setsRead: false, setsGate: { state: 'forbidden' } }),
		});
		expect(said(container)).toContain('Your role cannot open the replay sets');
	});
});

describe('replaying a set', () => {
	it('spins only the button that was pressed when the set is offered twice', async () => {
		render(SetsPage, props({}, { error: 'writes', needsWrites: 's1' }));
		const withWrites = screen.getByRole('button', { name: 'Replay including writes' });
		const row = screen.getByRole('button', { name: 'Replay Checkout' });
		await send(withWrites.closest('form') as HTMLFormElement);
		expect(withWrites.getAttribute('aria-busy')).toBe('true');
		expect(row.getAttribute('aria-busy')).toBeNull();
	});

	it('stops waiting when applying the result throws', async () => {
		render(SetsPage, props());
		const form = document.querySelector('form[action="?/replaySet"]') as HTMLFormElement;
		const button = screen.getByRole('button', { name: 'Replay Checkout' });
		const after = await send(form);
		await after({ result: { type: 'error' }, update: async () => { throw new Error('navigation failed'); } }).catch(() => {});
		await tick();
		expect(button.getAttribute('aria-busy')).toBeNull();
	});

	it('shows Replay pending once the reader agreed, until the replay returns', async () => {
		render(SetsPage, props());
		const form = document.querySelector('form[action="?/replaySet"]') as HTMLFormElement;
		const button = screen.getByRole('button', { name: 'Replay Checkout' });
		const after = await send(form);
		expect(button.getAttribute('aria-busy')).toBe('true');
		await after({ result: { type: 'success' }, update: async () => {} });
		await tick();
		expect(button.getAttribute('aria-busy')).toBeNull();
	});
});
