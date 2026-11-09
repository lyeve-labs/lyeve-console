import { describe, expect, it } from 'vitest';
import { OUTAGE, couldNotLoad, outageFor } from './outage';

describe('the shared failure sentences', () => {
	it('words a partial outage with the tail of the page outage', () => {
		expect(outageFor('webhooks did not load')).toBe('The engine is unavailable, so webhooks did not load. Try again in a moment.');
		expect(OUTAGE.body.endsWith('Try again in a moment.')).toBe(true);
	});

	it('tells the reader to reload only where no Try again control sits', () => {
		expect(couldNotLoad('webhooks')).toBe('Could not load webhooks.');
		expect(couldNotLoad('webhooks', { reload: true })).toBe('Could not load webhooks. Reload the page to try again.');
	});
});
