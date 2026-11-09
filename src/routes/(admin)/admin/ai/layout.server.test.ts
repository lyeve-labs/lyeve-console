import { describe, expect, it } from 'vitest';
import { load } from './+layout.server';
import { fixtureSettings } from '$lib/components/ai/test-support/fixtures';
import { json, loadEvent, refused } from '$lib/components/ai/test-support/events';

describe('admin/ai layout load', () => {
	it('reads the tenant switch and says who is a super admin', async () => {
		const { event } = loadEvent({ '/api/admin/ai/settings': () => json(fixtureSettings) }, { roles: ['admin'] });
		expect(await load(event)).toEqual({ aiSettings: fixtureSettings, aiLayoutGate: { state: 'ok' }, isSuperAdmin: false });
	});

	it('reads a 404 on the settings route as a plugin that is not mounted', async () => {
		const { event } = loadEvent({ '/api/admin/ai/settings': () => refused(404, 'not found') });
		expect(await load(event)).toMatchObject({ aiSettings: null, aiLayoutGate: { state: 'absent' }, isSuperAdmin: true });
	});

	it('locks on a 402', async () => {
		const { event } = loadEvent({ '/api/admin/ai/settings': () => refused(402, 'payment_required') });
		expect(await load(event)).toMatchObject({ aiLayoutGate: { state: 'locked' } });
	});
});
