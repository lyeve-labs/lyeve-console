import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import {
	allowedIPsProblem,
	createAdminToken,
	curlExample,
	customExpiryBounds,
	customExpiryProblem,
	describeRefusal,
	droppedCount,
	endOfDayRFC3339,
	expiryDistance,
	expiryTone,
	groupGrants,
	isIPOrCIDR,
	listAdminTokenRequests,
	parseAllowedIPs,
	presetExpiry,
	replacedIds,
	requestStatusTone,
	resolveExpiry,
	revokeAdminToken,
	rotateAdminToken,
	tokenStatus,
	type AdminToken,
} from './admin-tokens';

const DAY = 24 * 60 * 60 * 1000;

function token(over: Partial<AdminToken> = {}): AdminToken {
	return {
		id: 't1',
		tenant_id: 'default',
		owner_user_id: 'u1',
		owner_email: 'a@b.test',
		name: 'ci',
		display_prefix: 'abcd1234',
		grants: ['schemas:read'],
		allowed_ips: [],
		expires_at: '2026-10-26T00:00:00Z',
		created_at: '2026-09-26T00:00:00Z',
		last_used_at: null,
		revoked_at: null,
		rotated_from: null,
		...over,
	};
}

describe('the admin token requests', () => {
	it('sends a create with the step-up beside the fields', async () => {
		const post = vi.fn().mockResolvedValue({ token: 'lyat_x' });
		const client = { post } as unknown as HttpClient;
		await createAdminToken(client, { name: 'ci', grants: ['schemas:read'], expires_at: 'x', allowed_ips: [], password: 'pw' });
		expect(post).toHaveBeenCalledWith('/api/admin/admin-tokens', {
			name: 'ci',
			grants: ['schemas:read'],
			expires_at: 'x',
			allowed_ips: [],
			password: 'pw',
		});
	});

	it('escapes the id in the rotate, revoke and log paths', async () => {
		const post = vi.fn().mockResolvedValue({});
		const del = vi.fn().mockResolvedValue(undefined);
		const get = vi.fn().mockResolvedValue({ data: [] });
		const client = { post, delete: del, get } as unknown as HttpClient;
		await rotateAdminToken(client, 'a/b', { expires_at: 'x', mfa_code: '123456' });
		await revokeAdminToken(client, 'a/b');
		await listAdminTokenRequests(client, 'a/b', 50, 100);
		expect(post.mock.calls[0][0]).toBe('/api/admin/admin-tokens/a%2Fb/rotate');
		expect(del).toHaveBeenCalledWith('/api/admin/admin-tokens/a%2Fb');
		expect(get).toHaveBeenCalledWith('/api/admin/admin-tokens/a%2Fb/requests?limit=50&offset=100');
	});
});

describe('the expiry', () => {
	const now = new Date('2026-09-26T10:00:00Z');

	it('counts a preset from now', () => {
		expect(presetExpiry(7, now)).toBe('2026-10-03T10:00:00.000Z');
	});

	it('bounds the picker from tomorrow to 89 days out, so the day end stays inside 90 days', () => {
		const today = new Date(2026, 8, 26, 15);
		expect(customExpiryBounds(today)).toEqual({ min: '2026-09-27', max: '2026-12-24' });
		const end = new Date(endOfDayRFC3339('2026-12-24'));
		expect(end.getTime() - today.getTime()).toBeLessThanOrEqual(90 * DAY);
	});

	it('ends a picked day at its last second in the local zone, with the offset written out', () => {
		const out = endOfDayRFC3339('2026-10-25');
		expect(out).toMatch(/^2026-10-25T23:59:59[+-]\d{2}:\d{2}$/);
		const at = new Date(out);
		expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual([2026, 9, 25, 23, 59]);
		expect(endOfDayRFC3339('')).toBe('');
		expect(endOfDayRFC3339('25/10/2026')).toBe('');
	});

	it('names what is wrong with a picked day', () => {
		const today = new Date(2026, 8, 26);
		expect(customExpiryProblem('', today)).toContain('Choose the day');
		expect(customExpiryProblem('2026-09-26', today)).toContain('after today');
		expect(customExpiryProblem('2026-12-25', today)).toContain('at most 90 days');
		expect(customExpiryProblem('2026-12-24', today)).toBe('');
	});

	it('resolves a submitted choice on the server clock and refuses one past the limit', () => {
		expect(resolveExpiry('30', '', now)).toEqual({ expires_at: '2026-10-26T10:00:00.000Z' });
		expect(resolveExpiry('45', '', now)).toEqual({ problem: 'Choose when the token expires.' });
		expect(resolveExpiry('custom', '2026-10-01T23:59:59+09:00', now)).toEqual({ expires_at: '2026-10-01T23:59:59+09:00' });
		expect(resolveExpiry('custom', '', now)).toHaveProperty('problem');
		expect(resolveExpiry('custom', '2026-09-25T23:59:59Z', now)).toEqual({ problem: 'Choose a day after today.' });
		expect(resolveExpiry('custom', '2026-12-25T10:00:01Z', now)).toEqual({ problem: 'A token expires at most 90 days away.' });
	});

	it('warns in the last seven days and turns danger once expired', () => {
		expect(expiryTone('2026-10-26T10:00:00Z', now)).toBe('neutral');
		expect(expiryTone('2026-10-02T10:00:00Z', now)).toBe('warn');
		expect(expiryTone('2026-09-26T09:59:59Z', now)).toBe('danger');
	});

	it('says how far away an expiry is, in either direction', () => {
		expect(expiryDistance('2026-09-29T10:00:00Z', now)).toBe('in 3 days');
		expect(expiryDistance('2026-09-26T15:00:00Z', now)).toBe('in 5 hours');
		expect(expiryDistance('2026-09-26T10:01:00Z', now)).toBe('in 1 minute');
		expect(expiryDistance('2026-09-24T10:00:00Z', now)).toBe('expired 2 days ago');
	});
});

describe('the grant catalog', () => {
	it('groups grants by what they are over, in catalog order', () => {
		const groups = groupGrants([
			{ name: 'content:read', description: 'r', routes: [] },
			{ name: 'content:write', description: 'w', routes: [] },
			{ name: 'schemas:read', description: 's', routes: [{ method: 'GET', pattern: '/api/admin/schemas' }] },
		]);
		expect(groups.map((g) => [g.id, g.label, g.grants.map((x) => x.name)])).toEqual([
			['content', 'Content', ['content:read', 'content:write']],
			['schemas', 'Schemas', ['schemas:read']],
		]);
	});
});

describe('the address list', () => {
	it('accepts addresses and ranges of both families', () => {
		for (const ok of ['203.0.113.7', '198.51.100.0/24', '0.0.0.0/0', '2001:db8::1', '2001:db8::/32', '::1', '::ffff:192.0.2.1', '1:2:3:4:5:6:7:8']) {
			expect(isIPOrCIDR(ok), ok).toBe(true);
		}
	});

	it('refuses what is not shaped like one', () => {
		for (const bad of ['256.1.1.1', '10.0.0', '10.0.0.0/33', '2001:db8::/129', '1::2::3', 'example.com', '10.0.0.1/24/1', '1:2:3:4:5:6:7:8:9', '']) {
			expect(isIPOrCIDR(bad), bad).toBe(false);
		}
	});

	it('reads one entry per line and names the bad ones', () => {
		expect(parseAllowedIPs(' 10.0.0.1 \n\n10.0.0.0/8\r\n')).toEqual({ entries: ['10.0.0.1', '10.0.0.0/8'], invalid: [] });
		expect(allowedIPsProblem('10.0.0.1\nnope')).toBe('nope is not an IP address or a CIDR range.');
		expect(allowedIPsProblem('a\nb\nc\nd')).toBe('a, b, c and more are not IP addresses or CIDR ranges.');
		expect(allowedIPsProblem('')).toBe('');
		expect(allowedIPsProblem(Array.from({ length: 101 }, (_, i) => `10.0.0.${i % 250}`).join('\n'))).toBe('List at most 100 addresses.');
	});
});

describe('a token status', () => {
	const now = new Date('2026-09-26T10:00:00Z');

	it('puts revoked before expired, and replaced before active', () => {
		const revoked = token({ revoked_at: '2026-09-25T00:00:00Z', expires_at: '2026-09-01T00:00:00Z' });
		expect(tokenStatus(revoked, new Set(), now)).toBe('revoked');
		expect(tokenStatus(token({ expires_at: '2026-09-26T09:00:00Z' }), new Set(['t1']), now)).toBe('expired');
		expect(tokenStatus(token(), new Set(['t1']), now)).toBe('replaced');
		expect(tokenStatus(token(), new Set(), now)).toBe('active');
	});

	it('reads the replaced ids from the successors', () => {
		expect([...replacedIds([token({ id: 'a' }), token({ id: 'b', rotated_from: 'a' })])]).toEqual(['a']);
		// A successor on another page still marks its predecessor.
		expect([...replacedIds([token({ id: 'c', replaced_by: 'z' }), token({ id: 'd', replaced_by: null })])]).toEqual(['c']);
	});
});

describe('the request log', () => {
	it('reads a dropped row as the count it stands for', () => {
		expect(droppedCount({ route_pattern: 'dropped:12', status: 0 })).toBe(12);
		expect(droppedCount({ route_pattern: '/api/admin/schemas', status: 200 })).toBeNull();
		expect(droppedCount({ route_pattern: 'dropped:3', status: 200 })).toBeNull();
	});

	it('tones a status by its class', () => {
		expect([200, 204, 304, 403, 429, 503].map(requestStatusTone)).toEqual(['success', 'success', 'neutral', 'warn', 'warn', 'danger']);
	});

	it('shows a curl example that keeps the token out of the line', () => {
		expect(curlExample('https://admin.example.com')).toBe(
			'curl -H "Authorization: Bearer $LYEVE_ADMIN_TOKEN" https://admin.example.com/api/admin/schemas'
		);
	});
});

describe('describeRefusal', () => {
	it('puts a wrong password or code on its field', () => {
		expect(describeRefusal(403, 'The password is not valid.', 'password').fields).toEqual({ password: 'That password is not right.' });
		expect(describeRefusal(403, 'The MFA code is not valid.', 'mfa_code').fields.mfa_code).toContain('not right');
		expect(describeRefusal(403, 'This MFA code was already used. Wait for the next one.', 'mfa_code').fields.mfa_code).toContain('already used');
		expect(describeRefusal(403, 'password is required to confirm this change.', 'password').fields.password).toBe('Enter your current password.');
	});

	it('switches to the code when the engine asks for one', () => {
		const r = describeRefusal(403, 'mfa_code is required: this account has MFA enrolled.', 'password');
		expect(r.needsMfa).toBe(true);
		expect(r.fields.mfa_code).toContain('two-factor');
	});

	it('says a lockout is a lockout, for either answer', () => {
		expect(describeRefusal(429, 'Too many failed password attempts. Try again later.', 'password').error).toContain('Too many wrong passwords');
		expect(describeRefusal(429, 'Too many MFA attempts. Try again later.', 'mfa_code').error).toContain('Too many wrong codes');
	});

	it('maps each field refusal to the field on the form', () => {
		expect(describeRefusal(422, 'allowed_ips entry "10.0.0.300" is not an IP address or CIDR range.', 'password').fields).toEqual({
			allowed_ips: '10.0.0.300 is not an IP address or a CIDR range.',
		});
		expect(describeRefusal(422, 'expires_at must be at most 90 days away.', 'password').fields.expires_at).toContain('90 days');
		expect(describeRefusal(422, 'expires_at must be in the future.', 'password').fields.expires_at).toContain('after today');
		expect(describeRefusal(422, 'grants names "x:y", which is not an admin grant.', 'password').fields).toHaveProperty('grants');
		expect(describeRefusal(422, 'name is required and must be at most 255 characters.', 'password').fields).toHaveProperty('name');
		expect(describeRefusal(422, 'tenant_id is not a valid tenant.', 'password').fields).toHaveProperty('tenant_id');
	});

	it('relays a role refusal, and hides a server failure behind a static sentence', () => {
		expect(describeRefusal(403, "An admin token's owner must be an admin of its tenant.", 'password').error).toBe(
			"An admin token's owner must be an admin of its tenant."
		);
		expect(describeRefusal(503, 'account check unavailable', 'password').error).toBe('The engine is unavailable, so nothing was changed. Try again in a moment.');
		expect(describeRefusal(500, 'pq: boom', 'password').error).toBe('Could not issue the token. Try again.');
	});
});
