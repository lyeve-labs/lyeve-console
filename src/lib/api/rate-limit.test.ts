import { describe, expect, it } from 'vitest';
import {
	blocksEverything,
	audienceLabel,
	endpointIsSound,
	roleIsSound,
	windowLabel,
	exhausted,
	rateLabel,
	resetsIn,
	scopeLabel,
	scopeTone,
	type LimiterState,
	type RateRule,
} from './rate-limit';

function rule(over: Partial<RateRule> = {}): RateRule {
	return {
		id: 'r1',
		tenant_id: null,
		endpoint: 'POST /api/v1/auth/login',
		rate: 10,
		burst: 20,
		enabled: true,
		kind: 'custom',
		key_by: 'ip',
		enforced: true,
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

function state(over: Partial<LimiterState> = {}): LimiterState {
	return {
		rule_id: 'r1',
		client_ip: '203.0.113.4',
		endpoint: 'POST /api/v1/auth/login',
		rate: 10,
		burst: 20,
		remaining: 5,
		reset_at: '2026-09-23T12:00:30Z',
		...over,
	};
}

describe('what a rule covers', () => {
	// A null tenant means every tenant, which is what leaving the field empty
	// gives you. An empty cell reads as "not applicable".
	it('names every tenant rather than printing nothing', () => {
		expect(scopeLabel(rule())).toBe('Every tenant');
		expect(scopeTone(rule())).toBe('warn');
		expect(scopeLabel(rule({ tenant_id: 'acme' }))).toBe('acme');
		expect(scopeTone(rule({ tenant_id: 'acme' }))).toBe('neutral');
	});
});

describe('a rule that lets nothing through', () => {
	// A burst of zero is a closed door whatever the rate says: the first
	// request has no token to take. It stores fine and reads as a limit.
	it('spots a burst of zero and a rate of zero', () => {
		expect(blocksEverything(rule({ burst: 0 }))).toBe(true);
		expect(blocksEverything(rule({ rate: 0 }))).toBe(true);
		expect(blocksEverything(rule())).toBe(false);
	});

	// A rule that is switched off blocks nothing, whatever its numbers say.
	it('says nothing about a rule that is not enforced', () => {
		expect(blocksEverything(rule({ burst: 0, enabled: false }))).toBe(false);
	});
});

describe('the rate in the unit a person wrote it in', () => {
	// 0.016 per second is a rule somebody wrote as one a minute. Showing the
	// fraction hides what they meant.
	it('reads a sub-second rate per minute or per hour', () => {
		expect(rateLabel(10)).toBe('10/second');
		expect(rateLabel(1)).toBe('1/second');
		expect(rateLabel(1 / 60)).toBe('1/minute');
		expect(rateLabel(5 / 60)).toBe('5/minute');
		expect(rateLabel(1 / 3600)).toBe('1/hour');
	});

	it('calls a rate of zero a block rather than printing 0/second', () => {
		expect(rateLabel(0)).toBe('Blocked');
		expect(rateLabel(Number.NaN)).toBe('Blocked');
	});
});

describe('the live counters', () => {
	it('finds the callers with nothing left', () => {
		const rows = [state(), state({ client_ip: '1.2.3.4', remaining: 0 })];
		expect(exhausted(rows)).toHaveLength(1);
	});

	it('counts a reset down rather than printing a timestamp', () => {
		const now = new Date('2026-09-23T12:00:00Z');
		expect(resetsIn('2026-09-23T12:00:30Z', now)).toBe('30s');
		expect(resetsIn('2026-09-23T12:02:05Z', now)).toBe('2m 5s');
		expect(resetsIn('2026-09-23T11:59:00Z', now)).toBe('now');
		expect(resetsIn('not a date', now)).toBe('-');
	});
});

describe('the endpoint a rule matches', () => {
	// A rule written without a method matches nothing and reports no error,
	// so it sits in the list looking like a limit that is being enforced.
	it('requires a method and a path', () => {
		expect(endpointIsSound('POST /api/v1/auth/login')).toBe(true);
		expect(endpointIsSound('* /api/v1/*')).toBe(true);
		expect(endpointIsSound('GET /api/content/{schema}/{id}')).toBe(true);
		expect(endpointIsSound('*')).toBe(true);
		// The engine refuses each of these with a 400, so the form does first.
		expect(endpointIsSound('* /api/v1/')).toBe(false);
		expect(endpointIsSound('GET /api/*/x')).toBe(false);
		expect(endpointIsSound('GET /api/x{id}')).toBe(false);
		expect(endpointIsSound('/api/v1/auth/login')).toBe(false);
		expect(endpointIsSound('POST')).toBe(false);
		expect(endpointIsSound('post /api/v1/x')).toBe(false);
		expect(endpointIsSound('')).toBe(false);
	});
});

describe('a count per window', () => {
	it('names the largest whole unit', () => {
		expect(windowLabel(5, 900)).toBe('5 per 15 minutes');
		expect(windowLabel(1, 300)).toBe('1 per 5 minutes');
		expect(windowLabel(3, 3600)).toBe('3 per hour');
		expect(windowLabel(10, 60)).toBe('10 per minute');
		expect(windowLabel(2, 90)).toBe('2 per 90 seconds');
	});
});

describe('who a custom rule applies to', () => {
	it('names the role and the key', () => {
		expect(audienceLabel({ role: null, key_by: 'ip' })).toBe('Everyone, per address');
		expect(audienceLabel({ role: 'editor', key_by: 'user' })).toBe('Role editor, per account');
		expect(audienceLabel({ role: 'anonymous', key_by: 'ip' })).toBe('Signed-out callers, per address');
	});

	it('accepts only the role names the engine accepts', () => {
		expect(roleIsSound('editor')).toBe(true);
		expect(roleIsSound('tenant:admin')).toBe(true);
		expect(roleIsSound('has space')).toBe(false);
		expect(roleIsSound('x'.repeat(65))).toBe(false);
	});
});
