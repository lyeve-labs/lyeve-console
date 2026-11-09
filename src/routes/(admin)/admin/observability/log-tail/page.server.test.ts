import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

// The page reads nothing from the engine. The stream opens in the browser,
// so the load only says whether there is a tail to follow.
function loadEvent(roles = ['super_admin'], plugins: unknown = null) {
	return {
		parent: async () => ({ user: { id: 'u1', roles }, plugins }),
	} as never;
}

describe('live log tail load', () => {
	it('does not offer the tail while the logging plugin does not run', async () => {
		const plugins = { state: 'named', running: ['cron'], withheld: [] };
		const result = (await load(loadEvent(['super_admin'], plugins))) as Loaded;
		expect(result.logTail).toBe(false);
	});

	it('offers the tail while the logging plugin runs', async () => {
		const plugins = { state: 'named', running: ['logging'], withheld: [] };
		const result = (await load(loadEvent(['super_admin'], plugins))) as Loaded;
		expect(result.logTail).toBe(true);
	});
});

describe('live log tail load for a role below admin', () => {
	it('refuses it before anything else', async () => {
		await expect(load(loadEvent(['editor']))).rejects.toMatchObject({
			status: 403,
			body: { message: 'Only an admin or a super admin can open this page.' },
		});
	});
});
