import { describe, expect, it } from 'vitest';
import {
	occupancy,
	regionState,
	regionTone,
	replicationLabel,
	replicationTone,
	reportIsPartial,
	slugIsSound,
	unassigned,
	type Region,
	type ResidencyReport,
} from './residency';

function region(over: Partial<Region> = {}): Region {
	return {
		id: 'r1',
		slug: 'eu-west-1',
		display_name: 'EU West (Ireland)',
		provider: 'aws',
		enabled: true,
		is_default: false,
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

function report(over: Partial<ResidencyReport> = {}): ResidencyReport {
	return {
		generated_at: '2026-09-22T10:00:00Z',
		regions: [region()],
		tenant_regions: [
			{
				tenant_id: 't1',
				tenant_slug: 'acme',
				tenant_name: 'Acme',
				region_id: 'r1',
				region_slug: 'eu-west-1',
				region_display_name: 'EU West (Ireland)',
				provider: 'aws',
				assigned_at: '2026-09-01T00:00:00Z',
				has_replica: true,
				replica_status: 'synced',
			},
		],
		summary: {
			total_regions: 1,
			total_tenants: 1,
			tenants_per_region: { 'eu-west-1': 1 },
			replicating_count: 1,
			unassigned_count: 0,
		},
		...over,
	};
}

describe('tenants nobody placed', () => {
	// The number that reads as harmless and is not. A tenant with no region is
	// not in a compliant default. The report cannot say where its data is.
	it('reads the count off the summary, not off the page of rows', () => {
		const paged = report({
			tenant_regions: [],
			summary: {
				total_regions: 2,
				total_tenants: 500,
				tenants_per_region: { 'eu-west-1': 480 },
				replicating_count: 100,
				unassigned_count: 20,
			},
		});
		expect(unassigned(paged)).toBe(20);
	});

	it('reports none when the report says none, and none when there is no report', () => {
		expect(unassigned(report())).toBe(0);
		expect(unassigned(null)).toBe(0);
	});
});

describe('whether the report is evidence', () => {
	// A report listing fewer tenants than it counts is a page, not an audit,
	// and handing it to a regulator as one is the failure worth guarding.
	it('notices a report that lists fewer tenants than it counts', () => {
		const partial = report({
			tenant_regions: [],
			summary: {
				total_regions: 1,
				total_tenants: 500,
				tenants_per_region: { 'eu-west-1': 500 },
				replicating_count: 0,
				unassigned_count: 0,
			},
		});
		expect(reportIsPartial(partial)).toBe(true);
	});

	// Unassigned tenants have no row by definition, so they must not make a
	// complete report look truncated.
	it('does not call a complete report partial because of unplaced tenants', () => {
		const complete = report({
			summary: {
				total_regions: 1,
				total_tenants: 4,
				tenants_per_region: { 'eu-west-1': 1 },
				replicating_count: 1,
				unassigned_count: 3,
			},
		});
		expect(reportIsPartial(complete)).toBe(false);
		expect(reportIsPartial(null)).toBe(false);
	});
});

describe('region state', () => {
	// A disabled region keeps every tenant already in it, so the label has to
	// say "closed to new tenants" and never anything that reads as empty.
	it('says a closed region is closed to new tenants, not empty', () => {
		expect(regionState(region({ enabled: false }))).toBe('closed');
		expect(regionTone('closed')).toBe('neutral');
	});

	it('marks the default apart from any other open region', () => {
		expect(regionState(region({ is_default: true }))).toBe('default');
		expect(regionState(region())).toBe('open');
		expect(regionTone('default')).toBe('brand');
		expect(regionTone('open')).toBe('success');
	});

	// A disabled default is closed: the disable is what decides.
	it('lets closed outrank default', () => {
		expect(regionState(region({ enabled: false, is_default: true }))).toBe('closed');
	});
});

describe('replication', () => {
	it('says what each status means in words', () => {
		expect(replicationLabel('synced')).toBe('In step');
		expect(replicationLabel('failed')).toBe('Replication failed');
		expect(replicationLabel(null)).toBe('No replica');
		expect(replicationLabel('unknown-state')).toBe('unknown-state');
	});

	it('uses the kit vocabulary', () => {
		expect(replicationTone('synced')).toBe('success');
		expect(replicationTone('failed')).toBe('danger');
		expect(replicationTone('syncing')).toBe('warn');
		expect(replicationTone(null)).toBe('neutral');
	});
});

describe('region slugs', () => {
	// The slug is copied onto every assignment and onto the report, so a bad
	// one cannot be renamed later.
	it('accepts the shape every cloud vendor already uses', () => {
		expect(slugIsSound('eu-west-1')).toBe(true);
		expect(slugIsSound('us-east-1')).toBe(true);
	});

	it('refuses what cannot be read back on a report', () => {
		expect(slugIsSound('')).toBe(false);
		expect(slugIsSound('EU-West-1')).toBe(false);
		expect(slugIsSound('1-west')).toBe(false);
		expect(slugIsSound('eu west 1')).toBe(false);
		expect(slugIsSound('a')).toBe(false);
	});
});

describe('occupancy', () => {
	it('sorts the busiest region first and breaks ties by name', () => {
		const spread = report({
			summary: {
				total_regions: 3,
				total_tenants: 6,
				tenants_per_region: { 'us-east-1': 1, 'eu-west-1': 4, 'ap-south-1': 1 },
				replicating_count: 0,
				unassigned_count: 0,
			},
		});
		expect(occupancy(spread).map((r) => r.slug)).toEqual([
			'eu-west-1',
			'ap-south-1',
			'us-east-1',
		]);
	});

	it('returns nothing rather than throwing on no report', () => {
		expect(occupancy(null)).toEqual([]);
	});
});
