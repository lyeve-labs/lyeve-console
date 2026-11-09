/**
 * The data-residency plugin's admin routes.
 *
 * Two audiences and the split matters. Regions are infrastructure and a super
 * admin's alone. A tenant's own region, its replica and any migration it is
 * running are that tenant's, and those routes name the tenant in the path
 * while the handler compares it against the caller's own before touching
 * anything.
 *
 * The report is the reason to run this. It answers one question, which
 * is where each tenant's data is right now, and the number that matters most
 * on it is the one that reads as zero when it is wrong: a tenant with no
 * region assigned is not in a compliant default, it is unaccounted for.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import type { HttpClient } from '@lyeve-labs/client';
import type { ListEnvelope } from './list';

const REGIONS_URL = '/api/admin/regions';
const REPORT_URL = '/api/admin/residency/report';

export interface GeoCoord {
	lat: number;
	long: number;
}

export interface Region {
	id: string;
	slug: string;
	display_name: string;
	provider: string;
	coordinates?: GeoCoord | null;
	enabled: boolean;
	is_default: boolean;
	created_at: string;
	updated_at: string;
}

export interface TenantResidency {
	tenant_id: string;
	tenant_slug: string;
	tenant_name: string;
	region_id: string;
	region_slug: string;
	region_display_name: string;
	provider: string;
	assigned_at: string;
	has_replica: boolean;
	replica_status?: string;
}

export interface ResidencySummary {
	total_regions: number;
	total_tenants: number;
	tenants_per_region: Record<string, number>;
	replicating_count: number;
	unassigned_count: number;
}

export interface ResidencyReport {
	generated_at: string;
	regions: Region[] | null;
	tenant_regions: TenantResidency[] | null;
	summary: ResidencySummary | null;
}

export async function listRegions(
	client: HttpClient,
	limit: number,
	offset: number
): Promise<ListEnvelope<Region>> {
	return client.get<ListEnvelope<Region>>(`${REGIONS_URL}?limit=${limit}&offset=${offset}`);
}

export async function readReport(client: HttpClient, limit = 200): Promise<ResidencyReport> {
	return client.get<ResidencyReport>(`${REPORT_URL}?limit=${limit}&offset=0`);
}

export interface SaveRegion {
	slug: string;
	display_name: string;
	provider: string;
	coordinates?: GeoCoord;
	enabled?: boolean;
	is_default?: boolean;
}

export async function createRegion(client: HttpClient, body: SaveRegion): Promise<Region> {
	return client.post<Region>(REGIONS_URL, body);
}

export async function updateRegion(
	client: HttpClient,
	id: string,
	body: Partial<SaveRegion>
): Promise<Region> {
	return client.put<Region>(`${REGIONS_URL}/${encodeURIComponent(id)}`, body);
}

export async function deleteRegion(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${REGIONS_URL}/${encodeURIComponent(id)}`);
}

/**
 * A region slug the plugin will accept and a person can read on a report.
 *
 * Lower case, digits and hyphens, in the shape every cloud vendor already
 * uses. The slug is denormalized onto each tenant assignment, so renaming one
 * later does not follow, which is why it is worth refusing a bad one up front.
 */
export const SLUG_SHAPE = /^[a-z][a-z0-9-]{1,62}$/;

export function slugIsSound(slug: string): boolean {
	return SLUG_SHAPE.test(slug);
}

export function replicationTone(
	status: string | null | undefined
): StatusTone {
	if (status === 'synced') return 'success';
	if (status === 'failed') return 'danger';
	if (status === 'syncing' || status === 'paused') return 'warn';
	return 'neutral';
}

export const REPLICATION_LABELS: Readonly<Record<string, string>> = {
	synced: 'In step',
	syncing: 'Catching up',
	failed: 'Replication failed',
	paused: 'Paused',
};

export function replicationLabel(status: string | null | undefined): string {
	if (!status) return 'No replica';
	return REPLICATION_LABELS[status] ?? status;
}

/**
 * Tenants the report knows about but could not place.
 *
 * Read off the summary rather than counted from the rows, because the rows are
 * a page and the summary is the whole. Counting the page would report zero
 * unassigned tenants on any install with more tenants than one page holds,
 * which is the most dangerous wrong answer this page can give.
 */
export function unassigned(report: ResidencyReport | null): number {
	return report?.summary?.unassigned_count ?? 0;
}

/**
 * Whether the report is complete enough to be evidence.
 *
 * A report listing fewer tenants than its own summary counts is a page, not an
 * audit, and handing it to a regulator as one is the failure mode worth
 * guarding against.
 */
export function reportIsPartial(report: ResidencyReport | null): boolean {
	if (!report?.summary) return false;
	const listed = (report.tenant_regions ?? []).length;
	return listed < report.summary.total_tenants - report.summary.unassigned_count;
}

/** Regions with at least one tenant, largest first. */
export function occupancy(report: ResidencyReport | null): { slug: string; tenants: number }[] {
	const per = report?.summary?.tenants_per_region ?? {};
	return Object.entries(per)
		.map(([slug, tenants]) => ({ slug, tenants }))
		.sort((a, b) => b.tenants - a.tenants || a.slug.localeCompare(b.slug));
}

/**
 * A region that no tenant can be placed in.
 *
 * A disabled region keeps every tenant already assigned to it, so it is not a
 * way to empty one. Saying so on the row stops a disable being read as an
 * evacuation.
 */
export function regionState(r: Region): 'default' | 'open' | 'closed' {
	if (!r.enabled) return 'closed';
	return r.is_default ? 'default' : 'open';
}

export const REGION_STATE_LABELS: Readonly<Record<string, string>> = {
	default: 'Default for new tenants',
	open: 'Accepting tenants',
	closed: 'Closed to new tenants',
};

export function regionTone(state: string): StatusTone {
	if (state === 'default') return 'brand';
	if (state === 'open') return 'success';
	return 'neutral';
}
