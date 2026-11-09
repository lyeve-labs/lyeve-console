import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@lyeve-labs/client';
import {
	FLOW_NOTE,
	FORM_EVENT,
	flowNotes,
	flowOptions,
	flowProblem,
	formSchemaOptions,
	readFlowTargets,
	submissionsState,
	type FlowTargets,
} from './form-destinations';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const formEvent = { kind: 'system', name: FORM_EVENT };

function row(i: number, over: Record<string, unknown> = {}) {
	return { id: `f${i}`, slug: `flow-${i}`, name: `Flow ${i}`, status: 'active', version: 1, trigger_type: 'trigger.event', trigger_event: formEvent, ...over };
}

function engine(pages: unknown[][], total: number) {
	const paths: string[] = [];
	const fetch = vi.fn(async (url: string) => {
		const path = String(url);
		paths.push(path);
		const offset = Number(new URL(path, 'http://x').searchParams.get('offset') ?? 0);
		return json({ data: pages[offset / 200] ?? [], total });
	});
	return { client: createClient(fetch as unknown as typeof globalThis.fetch), paths };
}

describe('readFlowTargets', () => {
	it('reads whether a form can start each flow from the list alone', async () => {
		const { client, paths } = engine(
			[
				[
					row(1, { slug: 'contact' }),
					row(2, { slug: 'on-save', trigger_event: { kind: 'content', name: 'content.created', schema: 'posts' } }),
					row(3, { slug: 'hook', trigger_type: 'trigger.http', trigger_event: null }),
				],
			],
			3,
		);
		const out = await readFlowTargets(client);
		expect(out.flows.map((f) => [f.slug, f.formTrigger])).toEqual([
			['contact', true],
			['on-save', false],
			['hook', false],
		]);
		expect(out).toMatchObject({ complete: true, eventKnown: true });
		expect(paths).toHaveLength(1);
	});

	it('says when the flow plugin is too old to name each trigger event', async () => {
		const { trigger_event: _, ...old } = row(1);
		const { client } = engine([[old]], 1);
		expect((await readFlowTargets(client)).eventKnown).toBe(false);
	});

	it('pages past the first 200 flows, and marks a list cut at the cap as incomplete', async () => {
		const first = Array.from({ length: 200 }, (_, i) => row(i));
		const second = [row(200, { slug: 'late' })];
		const all = await readFlowTargets(engine([first, second], 201).client);
		expect(all.complete).toBe(true);
		expect(flowProblem('late', all)).toBeNull();

		const cut = await readFlowTargets(engine([first, second], 201).client, 200);
		expect(cut.complete).toBe(false);
		// A slug past the cap may exist, so it is never warned as gone.
		expect(flowProblem('late', cut)).toBeNull();
	});
});

describe('flow options and notes', () => {
	const targets: FlowTargets = {
		complete: true,
		eventKnown: true,
		flows: [
			{ slug: 'notify', name: 'Notify', status: 'active', formTrigger: true },
			{ slug: 'paused', name: 'Paused', status: 'disabled', formTrigger: true },
			{ slug: 'stuck', name: 'Stuck', status: 'blocked', formTrigger: true },
			{ slug: 'nightly', name: 'Nightly', status: 'active', formTrigger: false },
		],
	};

	it('offers the flows a form can start, then the allowed slugs that are not among them', () => {
		expect(flowOptions(targets, ['notify', 'nightly', 'gone'])).toEqual([
			{ value: 'notify', label: 'Notify' },
			{ value: 'paused', label: 'Paused' },
			{ value: 'stuck', label: 'Stuck' },
			{ value: 'nightly', label: 'Nightly' },
			{ value: 'gone', label: 'gone' },
		]);
	});

	it('warns only beside allowed flows a form cannot start', () => {
		expect(flowNotes(targets, ['notify', 'paused', 'nightly', 'gone'])).toEqual([
			{ slug: 'paused', label: 'Paused', note: FLOW_NOTE.inactive },
			{ slug: 'nightly', label: 'Nightly', note: FLOW_NOTE.trigger },
			{ slug: 'gone', label: 'gone', note: FLOW_NOTE.missing },
		]);
		expect(flowNotes(targets, [])).toEqual([]);
	});

	it('does not warn about a slug missing from an incomplete list', () => {
		expect(flowNotes({ ...targets, complete: false }, ['gone'])).toEqual([]);
	});
});

describe('formSchemaOptions', () => {
	it('lists the forms preset type first', () => {
		expect(
			formSchemaOptions([
				{ name: 'contact_messages', label: 'Contact messages' },
				{ name: 'form_submissions', label: 'Form submissions' },
				{ name: 'leads', label: 'Leads' },
			]).map((s) => s.name),
		).toEqual(['form_submissions', 'contact_messages', 'leads']);
	});
});

describe('submissionsState', () => {
	it.each([
		[[], 'absent'],
		[[{ name: 'form_submissions', label: 'Form submissions', publicDelivery: false }], 'private'],
		[[{ name: 'form_submissions', label: 'Form submissions', publicDelivery: true }], 'public'],
	])('reads where the submissions type stands', (rows, state) => {
		expect(submissionsState(rows)).toBe(state);
	});
});
