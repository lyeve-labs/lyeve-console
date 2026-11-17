import { describe, expect, it } from 'vitest';
import { FlowRefusal } from '#lib/api/flows.ts';
import { refusalFailure } from './flow-refusal';

type Failure = { status: number; data: { error: string; refusal?: unknown; locked?: boolean; errors?: unknown[] } };

describe('refusalFailure', () => {
	it('quotes the limit and the count of a ceiling refusal as the plugin sent them', () => {
		const result = refusalFailure(new FlowRefusal([], 7, 7)) as unknown as Failure;
		expect(result.status).toBe(402);
		expect(result.data.refusal).toEqual({ nodeIds: [], limit: 7, current: 7, upgradeUrl: '' });
		expect(result.data.error).toBe('7 of 7 flows are in use, the limit for this tenant. A license that allows more lifts the limit. You can also delete a flow to make room.');
	});

	it('carries the link a ceiling refusal names for more flows', () => {
		const link = 'https://shop.example.com/pricing?utm_campaign=flow.flows';
		const result = refusalFailure(new FlowRefusal([], 7, 7, link)) as unknown as Failure;
		expect(result.data.refusal).toEqual({ nodeIds: [], limit: 7, current: 7, upgradeUrl: link });
	});

	it('quotes the limit alone when the refusal carries no count', () => {
		const result = refusalFailure(new FlowRefusal([], 20)) as unknown as Failure;
		expect(result.data.error).toBe('This tenant is limited to 20 flows. A license that allows more lifts the limit. You can also delete a flow to make room.');
	});

	it('lists the nodes a definition refusal names and keeps their problems', () => {
		const errors = [
			{ node_id: 'trigger', path: '/config/path', message: 'not enabled here' },
			{ node_id: 'rows', path: '/type', message: 'not enabled here' },
		];
		const result = refusalFailure(new FlowRefusal(errors)) as unknown as Failure;
		expect(result.data.refusal).toEqual({ nodeIds: ['trigger', 'rows'], limit: null, current: null, upgradeUrl: '' });
		expect(result.data.error).toBe('2 elements use a feature that is not enabled on this instance: the trigger, rows.');
		expect(result.data.errors).toEqual(errors);
	});

	it('locks the page for a refusal that names no node and no limit', () => {
		const result = refusalFailure(new FlowRefusal([])) as unknown as Failure;
		expect(result.data.locked).toBe(true);
		expect(result.data.refusal).toBeUndefined();
	});
});
