import { describe, it, expect, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import { featureChoices, withheldFrom, findUserByEmail } from './tenant-access';

describe('featureChoices', () => {
	it('offers what the engine serves and what is already withheld', () => {
		const known = ['ai', 'flow', 'reports', 'search', 'saml'];
		const licensed = ['flow', 'search', 'reports'];
		expect(featureChoices(known, licensed, ['ai', 'search'])).toEqual([
			{ name: 'ai', available: false },
			{ name: 'flow', available: true },
			{ name: 'reports', available: true },
			{ name: 'search', available: false },
		]);
	});
});

describe('withheldFrom', () => {
	it('withholds every offered name that was not ticked', () => {
		expect(withheldFrom(['search', 'ai', 'flow'], ['flow'])).toEqual(['ai', 'search']);
		expect(withheldFrom(['search'], ['search'])).toEqual([]);
	});
});

describe('findUserByEmail', () => {
	const user = (email: string) => ({ id: email, email, roles: [] });

	it('walks the pages and matches without case', async () => {
		const first = Array.from({ length: 200 }, (_, i) => user(`u${i}@example.com`));
		const get = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce([user('Wanted@Example.com')]);
		const found = await findUserByEmail({ get } as unknown as HttpClient, 'wanted@example.com');
		expect(found?.email).toBe('Wanted@Example.com');
		expect(get).toHaveBeenCalledTimes(2);
	});

	it('stops at a short page', async () => {
		const get = vi.fn().mockResolvedValue([user('a@example.com')]);
		expect(await findUserByEmail({ get } as unknown as HttpClient, 'b@example.com')).toBeNull();
		expect(get).toHaveBeenCalledTimes(1);
	});
});
