import { describe, expect, it } from 'vitest';
import {
	deprovisionAction,
	deprovisionLabel,
	deprovisionTone,
	type ScimProvider,
} from './scim';

function provider(over: Partial<ScimProvider> = {}): ScimProvider {
	return {
		id: 'c1',
		name: 'Azure AD',
		enabled: true,
		tenant_id: 'default',
		attribute_map: {},
		deprovision_on_delete: true,
		deprovision_action: 'disable',
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

describe('what happens to a deprovisioned account', () => {
	// The two fields are stored independently, so the action survives the
	// switch being turned off. With the switch off the plugin deletes the
	// account on a directory delete, even when the stored action is disable.
	it('reads both fields, not just the action', () => {
		expect(deprovisionLabel(provider({ deprovision_on_delete: false, deprovision_action: 'disable' })))
			.toBe('Deleted');
		expect(deprovisionTone(provider({ deprovision_on_delete: false, deprovision_action: 'disable' })))
			.toBe('danger');
	});

	it('marks the irreversible option', () => {
		expect(deprovisionLabel(provider({ deprovision_action: 'delete' }))).toBe('Deleted');
		expect(deprovisionTone(provider({ deprovision_action: 'delete' }))).toBe('danger');
		expect(deprovisionLabel(provider({ deprovision_action: 'disable' }))).toBe('Disabled');
		expect(deprovisionTone(provider({ deprovision_action: 'disable' }))).toBe('warn');
	});

	// An unrecognized action reads as the reversible one rather than the
	// destructive one, because guessing wrong in that direction deletes people.
	it('treats anything it does not recognize as a disable', () => {
		expect(deprovisionLabel(provider({ deprovision_action: 'archive' }))).toBe('Disabled');
	});
});

describe('the action the form may send', () => {
	it('accepts the two the engine stores and refuses the rest', () => {
		expect(deprovisionAction('disable')).toBe('disable');
		expect(deprovisionAction('delete')).toBe('delete');
		expect(deprovisionAction('')).toBeNull();
		expect(deprovisionAction('archive')).toBeNull();
	});
});
