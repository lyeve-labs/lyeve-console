import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@lyeve-labs/client';
import { FLOW_NOTE, FLOW_UNCHECKED, FORM_EVENT, flowOptions, flowProblem, formSchemaOptions, readFlowTargets, type FlowTarget } from './form-destinations';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const formTrigger = { type: 'trigger.event', config: { kind: 'system', name: FORM_EVENT } };

function engine(routes: Record<string, unknown>) {
	const paths: string[] = [];
	const fetch = vi.fn(async (url: string) => {
		const path = String(url);
		paths.push(path);
		const hit = routes[path.split('?')[0]];
		return hit === undefined ? json({ error: 'not found' }, 404) : json(hit);
	});
	return { client: createClient(fetch as unknown as typeof globalThis.fetch), paths };
}

describe('readFlowTargets', () => {
	it('reads the trigger of each event flow from its published version, or its draft before one', async () => {
		const { client, paths } = engine({
			'/api/admin/flows': {
				data: [
					{ id: 'f1', slug: 'contact', name: 'Contact', status: 'active', version: 2, trigger_type: 'trigger.event' },
					{ id: 'f2', slug: 'draft-one', name: 'Draft', status: 'draft', version: 0, trigger_type: 'trigger.event' },
					{ id: 'f3', slug: 'on-save', name: 'On save', status: 'active', version: 1, trigger_type: 'trigger.event' },
					{ id: 'f4', slug: 'hook', name: 'Hook', status: 'active', version: 1, trigger_type: 'trigger.http' },
				],
				total: 4,
			},
			'/api/admin/flows/f1/versions/2': { definition: { trigger: formTrigger } },
			'/api/admin/flows/f2': { id: 'f2', draft: { trigger: formTrigger } },
			'/api/admin/flows/f3/versions/1': { definition: { trigger: { type: 'trigger.event', config: { kind: 'content', schema: 'posts' } } } },
		});
		const flows = await readFlowTargets(client);
		expect(flows.map((f) => [f.slug, f.formTrigger])).toEqual([
			['contact', true],
			['draft-one', true],
			['on-save', false],
			['hook', false],
		]);
		expect(paths.some((p) => p.startsWith('/api/admin/flows/f4'))).toBe(false);
	});

	it('keeps the list when one trigger read fails, and marks only that flow unknown', async () => {
		const { client } = engine({
			'/api/admin/flows': {
				data: [
					{ id: 'f1', slug: 'contact', name: 'Contact', status: 'active', version: 1, trigger_type: 'trigger.event' },
					{ id: 'f2', slug: 'broken', name: 'Broken', status: 'active', version: 1, trigger_type: 'trigger.event' },
				],
				total: 2,
			},
			'/api/admin/flows/f1/versions/1': { definition: { trigger: formTrigger } },
		});
		const flows = await readFlowTargets(client);
		expect(flows.map((f) => [f.slug, f.formTrigger])).toEqual([
			['contact', true],
			['broken', null],
		]);
		expect(flowProblem('broken', flows)).toBeNull();
	});

	it('reads at most eight triggers at a time', async () => {
		const rows = Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, slug: `flow-${i}`, name: `Flow ${i}`, status: 'active', version: 1, trigger_type: 'trigger.event' }));
		let inFlight = 0;
		let most = 0;
		const fetch = vi.fn(async (url: string) => {
			if (String(url).startsWith('/api/admin/flows?')) return json({ data: rows, total: rows.length });
			inFlight++;
			most = Math.max(most, inFlight);
			await new Promise((r) => setTimeout(r, 2));
			inFlight--;
			return json({ definition: { trigger: formTrigger } });
		});
		const flows = await readFlowTargets(createClient(fetch as unknown as typeof globalThis.fetch));
		expect(flows.every((f) => f.formTrigger)).toBe(true);
		expect(fetch).toHaveBeenCalledTimes(31);
		expect(most).toBe(8);
	});
});

describe('flowOptions', () => {
	const flows: FlowTarget[] = [
		{ id: '1', slug: 'notify', name: 'Notify', status: 'active', formTrigger: true },
		{ id: '2', slug: 'paused', name: 'Paused', status: 'disabled', formTrigger: true },
		{ id: '3', slug: 'stuck', name: 'Stuck', status: 'blocked', formTrigger: true },
		{ id: '4', slug: 'nightly', name: 'Nightly', status: 'active', formTrigger: false },
		{ id: '5', slug: 'unread', name: 'Unread', status: 'active', formTrigger: null },
		{ id: '6', slug: 'other-unread', name: 'Other unread', status: 'active', formTrigger: null },
	];

	it('offers the flows a form can start and names the problem beside each allowed slug a form cannot start', () => {
		expect(flowOptions(flows, ['notify', 'nightly', 'gone', 'unread'])).toEqual([
			{ value: 'notify', label: 'Notify', description: undefined },
			{ value: 'paused', label: 'Paused', description: FLOW_NOTE.inactive },
			{ value: 'stuck', label: 'Stuck', description: FLOW_NOTE.blocked },
			{ value: 'unread', label: 'Unread', description: FLOW_UNCHECKED },
			{ value: 'nightly', label: 'Nightly', description: FLOW_NOTE.trigger },
			{ value: 'gone', label: 'gone', description: FLOW_NOTE.missing },
		]);
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
