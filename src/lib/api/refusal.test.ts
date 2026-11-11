import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

import { capNoun, featureName, formRefusal, refusalOf, refusalText, refusalTitle, upgradeLabel, upgradeWords } from './refusal';

function refused(body: Record<string, unknown>, status = 402): ApiError {
	return new ApiError(status, String(body.error ?? 'refused'), body);
}

describe('refusalOf', () => {
	it('reads a cap refusal with the numbers the engine sent', () => {
		const r = refusalOf(refused({ error: 'cap_exceeded', cap: 'example.items', limit: 4, current: 4, upgrade_url: '' }));
		expect(r).toEqual({ kind: 'cap', cap: 'example.items', limit: 4, current: 4, upgradeUrl: '' });
	});

	it('keeps the link a cap refusal names for more', () => {
		const link = 'https://shop.example.com/pricing?utm_source=admin&utm_medium=product&utm_campaign=example.items';
		const r = refusalOf(refused({ error: 'cap_exceeded', cap: 'example.items', limit: 4, current: 4, upgrade_url: link }));
		expect(r).toMatchObject({ kind: 'cap', upgradeUrl: link });
	});

	it('reads a feature refusal by the capability name a license carries', () => {
		const r = refusalOf(refused({ error: 'payment_required', plugin: 'example', feature: 'feature:example_feature', upgrade_url: '' }));
		expect(r).toEqual({ kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' });
	});

	it('leaves every other failure alone', () => {
		expect(refusalOf(refused({ error: 'not found' }, 404))).toBeNull();
		expect(refusalOf(new Error('network'))).toBeNull();
		expect(refusalOf(undefined)).toBeNull();
	});

	it('keeps a number the engine did not send as unknown', () => {
		const r = refusalOf(refused({ error: 'cap_exceeded', cap: 'example.items', limit: 'four' }));
		expect(r).toMatchObject({ limit: null, current: null });
	});
});

describe('refusalText', () => {
	it('says the count against the ceiling in the words of the cap', () => {
		expect(refusalText({ kind: 'cap', cap: 'example.items', limit: 4, current: 4, upgradeUrl: '' })).toBe(
			"You're using 4 of 4 items. A license that allows more lifts the limit. Removing one also makes room.",
		);
	});

	it('says only the ceiling when the count is missing', () => {
		expect(refusalText({ kind: 'cap', cap: 'example.widget_slots', limit: 9, current: null, upgradeUrl: '' })).toContain(
			'You can have up to 9 widget slots.',
		);
	});

	it('states the seat count, then more seats with a license, then how to free one', () => {
		expect(refusalText({ kind: 'cap', cap: 'admin.seats', limit: 7, current: 7, upgradeUrl: '' })).toBe(
			"Every admin seat is taken. You're using 7 of 7, the most this engine allows. A license that allows more lifts the limit. Removing the admin role from an account also frees a seat. Editors and viewers take no seat.",
		);
	});

	it('names a license as the way forward before removing one', () => {
		const text = refusalText({ kind: 'cap', cap: 'example.items', limit: null, current: null, upgradeUrl: '' });
		expect(text).toBe('You\'ve reached the limit for items. A license that allows more lifts the limit. Removing one also makes room.');
		expect(text.indexOf('license')).toBeLessThan(text.indexOf('Removing'));
	});

	it('says a feature refusal without the capability it names', () => {
		const r = { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' } as const;
		expect(refusalText(r)).toBe('This is not enabled on this engine. Nothing was changed.');
		expect(refusalTitle(r)).toBe('Not enabled on this engine');
	});

	it('words a feature refusal that names no capability', () => {
		const r = { kind: 'feature', feature: '', plugin: '', upgradeUrl: '' } as const;
		expect(refusalText(r)).toBe('This is not enabled on this engine. Nothing was changed.');
		expect(refusalTitle(r)).toBe('Not enabled on this engine');
	});
});

describe('upgradeLabel', () => {
	it('names a link by what it opens', () => {
		expect(upgradeLabel('https://shop.example.com/pricing?plan=basic&utm_campaign=admin.seats')).toBe('View the plan');
		expect(upgradeLabel('https://shop.example.com/pricing?skus=example-pro&utm_campaign=example.items')).toBe('View the add-on');
		expect(upgradeLabel('https://shop.example.com/pricing?skus=example-pro,other-pro')).toBe('View the add-ons');
	});

	it('leaves a link that says neither to the caller', () => {
		expect(upgradeLabel('https://shop.example.com/pricing?utm_campaign=example.items')).toBeNull();
		expect(upgradeLabel('/admin/settings/license?plugin=example')).toBeNull();
		expect(upgradeLabel('')).toBeNull();
	});
});

describe('helpers', () => {
	it('turns a feature code into the capability name', () => {
		expect(featureName('feature:example_feature')).toBe('example-feature');
		expect(featureName('feature-b')).toBe('feature-b');
	});

	it('names a cap by its last segment', () => {
		expect(capNoun('example.items')).toBe('items');
		expect(capNoun('gadgets.spare-parts')).toBe('spare parts');
		expect(capNoun('widgets')).toBe('widgets');
		expect(capNoun('admin.seats')).toBe('admin seats');
		expect(capNoun('ai.providers')).toBe('AI providers');
		expect(capNoun('mcp.agents')).toBe('connected agents');
	});

	it('falls back to a neutral noun for a cap with no usable segment', () => {
		expect(capNoun('')).toBe('items');
		expect(capNoun('example.')).toBe('items');
		expect(capNoun('example._')).toBe('items');
	});

	it('reads only a refusal of its own shape from an action result', () => {
		const cap = { kind: 'cap', cap: 'example.items', limit: 4, current: 4, upgradeUrl: '' };
		expect(formRefusal({ error: 'x', refused: cap })).toEqual(cap);
		expect(formRefusal({ error: 'x', refusal: { nodeIds: [] } })).toBeNull();
		expect(formRefusal(null)).toBeNull();
	});
});

describe('upgradeWords', () => {
	it('names a link by what it opens before the label it was served with', () => {
		expect(upgradeWords({ href: 'https://shop.example.com/pricing?skus=a,b', label: 'License' })).toBe('View the add-ons');
	});

	it('keeps the served label for a link whose address says nothing', () => {
		expect(upgradeWords({ href: '/admin/settings/license', label: 'Open the license' })).toBe('Open the license');
	});

	it('falls back to the step the refusal asks for', () => {
		expect(upgradeWords({ href: '/admin/settings/license' })).toBe('How to enable it');
		expect(upgradeWords({ href: '/admin/settings/license' }, true)).toBe('How to raise the limit');
	});
});
