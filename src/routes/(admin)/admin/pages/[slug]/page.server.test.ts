import { describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({ getCustomPage: vi.fn() }));
vi.mock('#lib/api/customization.ts', () => api);
vi.mock('#lib/server/authz.ts', () => ({ authedClient: vi.fn(() => ({})) }));
vi.mock('#lib/server/custom-blocks.ts', () => ({ resolveBlocks: vi.fn(async () => []) }));

import { load } from './+page.server';

function open() {
	return Promise.resolve(
		load({
			params: { slug: 'team' },
			parent: async () => ({ customization: { entitled: true } }),
		} as never),
	).catch((err: unknown) => err);
}

describe('custom page load', () => {
	it('answers 404 for a page the engine does not have', async () => {
		api.getCustomPage.mockRejectedValueOnce(new ApiError(404, 'not found'));
		const thrown = await open();
		expect(isHttpError(thrown) && thrown.status).toBe(404);
	});

	it('reports an outage as an outage, never as a page that is not there', async () => {
		api.getCustomPage.mockRejectedValueOnce(new ApiError(503, 'unavailable'));
		const thrown = await open();
		expect(isHttpError(thrown) && thrown.status).toBe(503);
	});

	it('renders the page the engine answered with', async () => {
		api.getCustomPage.mockResolvedValueOnce({ slug: 'team', title: 'Team', blocks: [] });
		const data = (await open()) as { customPage: { title: string } };
		expect(data.customPage.title).toBe('Team');
	});
});
