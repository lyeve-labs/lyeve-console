import { ApiError } from '@lyeve-labs/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ refreshAll: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => nav);

import { renewingOnce } from './renew';

beforeEach(() => nav.refreshAll.mockReset().mockResolvedValue(undefined));

describe('renewingOnce', () => {
	it('answers what the first call answers and renews nothing', async () => {
		const call = vi.fn(async () => 'run');
		await expect(renewingOnce(call)).resolves.toBe('run');
		expect(call).toHaveBeenCalledTimes(1);
		expect(nav.refreshAll).not.toHaveBeenCalled();
	});

	it('reruns the loads and calls again after a thrown 401', async () => {
		const call = vi.fn().mockRejectedValueOnce(new ApiError(401, 'unauthorized', { error: 'unauthorized' })).mockResolvedValueOnce('run');
		await expect(renewingOnce(call)).resolves.toBe('run');
		expect(call).toHaveBeenCalledTimes(2);
		expect(nav.refreshAll).toHaveBeenCalledTimes(1);
	});

	it('reruns the loads and calls again after a 401 response', async () => {
		const ok = new Response('{}', { status: 201 });
		const call = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 401 })).mockResolvedValueOnce(ok);
		await expect(renewingOnce(call)).resolves.toBe(ok);
		expect(nav.refreshAll).toHaveBeenCalledTimes(1);
	});

	it('tries only once more, and hands back the second refusal', async () => {
		const refused = new ApiError(401, 'unauthorized', { error: 'unauthorized' });
		const call = vi.fn().mockRejectedValue(refused);
		await expect(renewingOnce(call)).rejects.toBe(refused);
		expect(call).toHaveBeenCalledTimes(2);
	});

	// A reader who chose Stay at the leave prompt cancels the navigation the
	// layout's load asked for. The call still runs once more, so its refusal
	// reaches the page instead of nothing.
	it('calls again when rerunning the loads fails', async () => {
		nav.refreshAll.mockRejectedValueOnce(new Error('navigation canceled'));
		const refused = new ApiError(401, 'unauthorized', { error: 'unauthorized' });
		const call = vi.fn().mockRejectedValue(refused);
		await expect(renewingOnce(call)).rejects.toBe(refused);
		expect(call).toHaveBeenCalledTimes(2);
	});

	it('leaves any other failure alone', async () => {
		const call = vi.fn().mockRejectedValue(new ApiError(403, 'forbidden', { error: 'forbidden' }));
		await expect(renewingOnce(call)).rejects.toMatchObject({ status: 403 });
		expect(call).toHaveBeenCalledTimes(1);
		expect(nav.refreshAll).not.toHaveBeenCalled();
	});
});
