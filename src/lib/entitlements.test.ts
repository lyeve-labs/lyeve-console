import { describe, it, expect } from 'vitest';
import { hasLicenseModule, NO_ENTITLEMENTS } from './entitlements';
import type { Entitlements } from '#lib/entitlements.ts';

const example: Entitlements = {
	plan: 'example',
	state: 'active',
	features: ['search', 'audit'],
	tenant_quota: 0,
};

describe('hasLicenseModule', () => {
	it('is true only when the engine says the build links one', () => {
		expect(hasLicenseModule({ ...example, license_module: true })).toBe(true);
		expect(hasLicenseModule({ ...example, license_module: false })).toBe(false);
	});

	it('reads an engine that does not say, and entitlements nobody could read, as none', () => {
		expect(hasLicenseModule(example)).toBe(false);
		expect(hasLicenseModule(NO_ENTITLEMENTS)).toBe(false);
		expect(hasLicenseModule(null)).toBe(false);
	});
});

describe('constants', () => {
	it('NO_ENTITLEMENTS fails closed with no plan, no state and no features', () => {
		expect(NO_ENTITLEMENTS.plan).toBe('');
		expect(NO_ENTITLEMENTS.state).toBe('');
		expect(NO_ENTITLEMENTS.features).toEqual([]);
		expect(NO_ENTITLEMENTS.tenant_quota).toBe(0);
	});
});
