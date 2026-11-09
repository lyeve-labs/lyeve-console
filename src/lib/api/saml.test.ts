import { describe, expect, it } from 'vitest';
import {
	certHealth,
	certTone,
	daysUntil,
	expiryLabel,
	metadataPath,
	providerHealth,
	signInPath,
	type SamlProvider,
} from './saml';

const NOW = new Date('2026-09-23T12:00:00Z');

function provider(over: Partial<SamlProvider> = {}): SamlProvider {
	return {
		id: 'p1',
		tenant_id: 'default',
		name: 'Okta',
		entity_id: 'http://www.okta.com/exk1',
		sso_url: 'https://example.okta.com/sso',
		sp_cert_active: '-----BEGIN CERTIFICATE-----',
		name_id_format: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
		want_authn_signed: false,
		want_assertions_signed: true,
		want_response_signed: true,
		sign_authn_requests: true,
		encrypt_assertions: false,
		attributes_mapping: {},
		enabled: true,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		...over,
	};
}

describe('certificate health', () => {
	it('separates expired from expiring from fine', () => {
		expect(certHealth('2026-09-20T12:00:00Z', NOW)).toBe('expired');
		expect(certHealth('2026-10-10T12:00:00Z', NOW)).toBe('expiring');
		expect(certHealth('2027-09-23T12:00:00Z', NOW)).toBe('ok');
	});

	// The engine sends no date for a certificate it could not parse. Treating
	// that as an expiry would put every unreadable row in the count of things
	// somebody has to renew, which is the number the page exists to make true.
	it('reports unknown rather than expired when there is no date', () => {
		expect(certHealth(null, NOW)).toBe('unknown');
		expect(certHealth(undefined, NOW)).toBe('unknown');
		expect(certHealth('not a date', NOW)).toBe('unknown');
		expect(certTone('unknown')).toBe('neutral');
	});

	it('counts the boundary day as expiring, not as fine', () => {
		expect(certHealth('2026-10-23T12:00:00Z', NOW)).toBe('expiring');
		expect(certHealth('2026-10-24T12:00:00Z', NOW)).toBe('ok');
	});

	// tone names must be ones the kit actually renders. `warning` type-checks
	// nowhere and draws neutral, so a warning row would read as a healthy one.
	it('uses the kit vocabulary for every level', () => {
		expect(certTone('expired')).toBe('danger');
		expect(certTone('expiring')).toBe('warn');
		expect(certTone('ok')).toBe('success');
	});
});

describe('a row is as healthy as its sickest certificate', () => {
	it('takes the worse of the two', () => {
		const p = provider({
			sp_cert_expires_at: '2027-09-23T12:00:00Z',
			idp_cert_expires_at: '2026-10-01T12:00:00Z',
		});
		expect(providerHealth(p, NOW)).toBe('expiring');
	});

	it('lets an expired certificate outrank an expiring one', () => {
		const p = provider({
			sp_cert_expires_at: '2026-10-01T12:00:00Z',
			idp_cert_expires_at: '2026-09-01T12:00:00Z',
		});
		expect(providerHealth(p, NOW)).toBe('expired');
	});

	// The staged certificate is not in use, so a staged one expiring soon is
	// not a reason to call the provider unhealthy.
	it('ignores the staged certificate', () => {
		const p = provider({
			sp_cert_expires_at: '2027-09-23T12:00:00Z',
			idp_cert_expires_at: '2027-09-23T12:00:00Z',
			sp_cert_next: '-----BEGIN CERTIFICATE-----',
			sp_cert_next_expires_at: '2026-09-24T12:00:00Z',
		});
		expect(providerHealth(p, NOW)).toBe('ok');
	});
});

describe('expiry in words', () => {
	it('counts down, counts up once past, and says so when it does not know', () => {
		expect(expiryLabel('2026-10-03T12:00:00Z', NOW)).toBe('Expires in 10 days');
		expect(expiryLabel('2026-09-24T12:00:00Z', NOW)).toBe('Expires in 1 day');
		expect(expiryLabel('2026-09-23T18:00:00Z', NOW)).toBe('Expires today');
		expect(expiryLabel('2026-09-22T12:00:00Z', NOW)).toBe('Expired 1 day ago');
		expect(expiryLabel(null, NOW)).toBe('Expiry unknown');
	});

	it('counts whole days', () => {
		expect(daysUntil('2026-09-24T11:00:00Z', NOW)).toBe(0);
		expect(daysUntil('2026-09-24T13:00:00Z', NOW)).toBe(1);
	});
});

// A SAML provider is named by whoever configured it, so the name is a display
// name and holds spaces. Concatenating one into a path produces a URL the
// route never matches, which reads as "provider not found" at sign-in.
describe('provider names go into a URL encoded', () => {
	it('encodes a name with a space', () => {
		expect(metadataPath('Azure AD')).toBe('/api/admin/auth/saml/Azure%20AD/metadata');
		expect(signInPath('Azure AD')).toBe('/api/admin/auth/saml/Azure%20AD');
	});

	it('encodes a name that would otherwise add a path segment', () => {
		expect(signInPath('a/b')).toBe('/api/admin/auth/saml/a%2Fb');
	});
});
