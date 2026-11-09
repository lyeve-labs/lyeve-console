import { describe, expect, it } from 'vitest';
import {
	activeHolds,
	archivalLabel,
	archivalTone,
	deletionIsBlocked,
	entriesDeleted,
	holdIsUnbounded,
	holdScope,
	listPolicies,
	policyIsCatchAll,
	policyScope,
	retentionLabel,
	type LegalHold,
	type RetentionPolicy,
} from './retention';

function policy(over: Partial<RetentionPolicy> = {}): RetentionPolicy {
	return {
		id: 'p1',
		event_type: 'user.login',
		resource_type: '',
		retention_days: 365,
		archival_enabled: true,
		archival_storage: 'glacier',
		archival_path_prefix: 'audit/',
		tenant_id: 'default',
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

function hold(over: Partial<LegalHold> = {}): LegalHold {
	return {
		id: 'h1',
		name: 'Matter 42',
		description: '',
		filter_action: 'user.login',
		filter_resource_type: '',
		filter_resource_id: '',
		filter_tenant_id: '',
		tenant_id: 'default',
		created_at: '2026-09-01T00:00:00Z',
		created_by: 'legal@example.com',
		...over,
	};
}

describe('a hold overrides every policy', () => {
	// The reading a policy list alone gets wrong. An auditor asking "is this
	// gone after ninety days" is told yes by the policy and no by reality.
	it('says deletion is blocked when an unbounded hold is live', () => {
		const wide = hold({ filter_action: '' });
		expect(holdIsUnbounded(wide)).toBe(true);
		expect(deletionIsBlocked([policy()], [wide])).toBe(true);
	});

	it('says nothing when the hold is narrow', () => {
		expect(deletionIsBlocked([policy()], [hold()])).toBe(false);
	});

	// A released hold is soft-deleted and protects nothing, so it must not
	// keep the warning up forever.
	it('ignores a released hold', () => {
		const released = hold({ filter_action: '', deleted_at: '2026-09-10T00:00:00Z' });
		expect(activeHolds([released])).toEqual([]);
		expect(deletionIsBlocked([policy()], [released])).toBe(false);
	});

	it('claims nothing when no policy would have deleted anything anyway', () => {
		expect(deletionIsBlocked([], [hold({ filter_action: '' })])).toBe(false);
	});
});

describe('what a rule covers, in words', () => {
	// An empty event type is the widest rule there is. An empty cell reads as
	// an unfinished row.
	it('names the catch-all rather than printing nothing', () => {
		expect(policyScope(policy({ event_type: '', resource_type: '' }))).toBe('Every event');
		expect(policyIsCatchAll(policy({ event_type: '', resource_type: '' }))).toBe(true);
		expect(policyIsCatchAll(policy())).toBe(false);
	});

	it('names a hold with no filters as covering everything', () => {
		expect(holdScope(hold({ filter_action: '' }))).toBe('Every audit entry');
		expect(holdScope(hold({ filter_resource_type: 'user' }))).toBe('user.login, on user');
	});
});

describe('retention windows', () => {
	it('reads in the unit the policy was written in', () => {
		expect(retentionLabel(365)).toBe('1 year');
		expect(retentionLabel(730)).toBe('2 years');
		expect(retentionLabel(90)).toBe('3 months');
		expect(retentionLabel(7)).toBe('7 days');
		expect(retentionLabel(1)).toBe('1 day');
	});

	// Zero is not "no retention policy", it is the strictest one there is.
	it('spells out what zero days means', () => {
		expect(retentionLabel(0)).toBe('Delete at the next run');
		expect(retentionLabel(-1)).toBe('Not set');
	});
});

describe('archival', () => {
	// Off means the entries are gone. With a compliance obligation that is the
	// difference between a retention policy and a data loss incident.
	it('says outright when nothing is archived', () => {
		expect(archivalLabel(policy({ archival_enabled: false }))).toBe('Deleted outright');
		expect(archivalTone(policy({ archival_enabled: false }))).toBe('warn');
	});

	it('names where entries go when they are kept', () => {
		expect(archivalLabel(policy())).toBe('Archived to glacier');
		expect(archivalTone(policy())).toBe('success');
		expect(archivalLabel(policy({ archival_storage: '' }))).toBe('Archived');
	});
});

describe('an enforcement run', () => {
	it('adds up the entries each policy deleted', () => {
		const run = {
			policies_processed: 2,
			results: [
				{ policy_id: 'p1', entries_deleted: 9 },
				{ policy_id: 'p2', entries_deleted: 3, entries_archived: 3 },
			],
		};
		expect(entriesDeleted(run)).toBe(12);
	});

	it('counts a run that processed nothing as none deleted', () => {
		expect(entriesDeleted({ policies_processed: 0, results: null })).toBe(0);
		expect(entriesDeleted({})).toBe(0);
	});
});

describe('reading every policy', () => {
	it('reads past the first page until the stated total', async () => {
		const asked: string[] = [];
		const client = {
			get: async (url: string) => {
				asked.push(url);
				const offset = Number(new URL(url, 'http://x').searchParams.get('offset'));
				const size = offset === 0 ? 500 : 20;
				return { data: Array.from({ length: size }, (_, i) => ({ id: `p${offset + i}` })), total_count: 520 };
			},
		};
		const all = await listPolicies(client as never);
		expect(all.data).toHaveLength(520);
		expect(asked).toEqual(['/api/admin/retention-policies?limit=500&offset=0', '/api/admin/retention-policies?limit=500&offset=500']);
	});
});
