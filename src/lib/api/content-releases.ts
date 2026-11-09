/**
 * The content plugin's releases: a named set of entries that publish or
 * unpublish together, now or at a scheduled time.
 *
 * The engine may refuse a write with 402. The page renders the refusal it
 * sends.
 */
import { ApiError, type HttpClient } from '@lyeve-labs/client';
import type { StatusTone } from '@lyeve-labs/ui-kit';
import { query, type ListEnvelope } from './list';

const RELEASES_URL = '/api/admin/content/releases';

export const RELEASE_STATUSES = ['draft', 'scheduled', 'publishing', 'published', 'failed', 'canceled'] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export type ReleaseAction = 'publish' | 'unpublish';

export interface ReleaseItem {
	entry_id: string;
	action: ReleaseAction;
	previous_status?: string;
	outcome?: string;
	added_by: string;
	created_at: string;
}

export interface Release {
	id: string;
	name: string;
	description: string;
	status: ReleaseStatus;
	scheduled_at?: string;
	published_at?: string;
	failure_reason?: string;
	created_by: string;
	updated_by: string;
	created_at: string;
	updated_at: string;
	item_count: number;
	items?: ReleaseItem[];
}

export type ConflictKind = 'entry_missing' | 'entry_schedule' | 'scheduled_transition' | 'other_release';

export interface ReleaseConflict {
	entry_id: string;
	kind: ConflictKind | string;
	at?: string;
	release_id?: string;
	detail: string;
}

/** What each conflict means for the reader deciding whether to go on. */
export const CONFLICT_LABELS: Readonly<Record<string, string>> = {
	entry_missing: 'Deleted since it was added. The release skips it.',
	entry_schedule: 'Has its own publish or unpublish date.',
	scheduled_transition: 'A scheduled transition will move it on its own.',
	other_release: 'Another scheduled release also moves it.',
};

/** Whether a conflict stops the release. A deleted entry is skipped, never refused. */
export function blocks(c: ReleaseConflict): boolean {
	return c.kind !== 'entry_missing';
}

export const STATUS_LABELS: Readonly<Record<ReleaseStatus, string>> = {
	draft: 'Draft',
	scheduled: 'Scheduled',
	publishing: 'Publishing',
	published: 'Published',
	failed: 'Failed',
	canceled: 'Canceled',
};

export function statusTone(s: ReleaseStatus): StatusTone {
	switch (s) {
		case 'published':
			return 'success';
		case 'scheduled':
		case 'publishing':
			return 'brand';
		case 'failed':
			return 'danger';
		case 'canceled':
			return 'neutral';
		default:
			return 'warn';
	}
}

/** Whether entries, the name and the schedule can still change. */
export function editable(r: Pick<Release, 'status'>): boolean {
	return r.status === 'draft' || r.status === 'scheduled';
}

function releaseURL(id: string, tail = ''): string {
	return `${RELEASES_URL}/${encodeURIComponent(id)}${tail}`;
}

export function listReleases(client: HttpClient, status: string, limit: number, offset: number): Promise<ListEnvelope<Release>> {
	return client.get<ListEnvelope<Release>>(`${RELEASES_URL}${query({ limit, offset, status })}`);
}

export function getRelease(client: HttpClient, id: string): Promise<Release> {
	return client.get<Release>(releaseURL(id));
}

export async function releaseConflicts(client: HttpClient, id: string): Promise<ReleaseConflict[]> {
	const res = await client.get<{ data?: ReleaseConflict[] | null }>(releaseURL(id, '/conflicts'));
	return res?.data ?? [];
}

export function createRelease(client: HttpClient, body: { name: string; description: string }): Promise<Release> {
	return client.post<Release>(RELEASES_URL, { ...body, items: [] });
}

export function updateRelease(client: HttpClient, id: string, body: { name: string; description: string }): Promise<Release> {
	return client.put<Release>(releaseURL(id), body);
}

export function deleteRelease(client: HttpClient, id: string): Promise<void> {
	return client.delete<void>(releaseURL(id));
}

export function addReleaseItem(client: HttpClient, id: string, entryId: string, action: ReleaseAction): Promise<Release> {
	return client.post<Release>(releaseURL(id, '/items'), { entry_id: entryId, action });
}

export function removeReleaseItem(client: HttpClient, id: string, entryId: string): Promise<Release> {
	return client.delete<Release>(releaseURL(id, `/items/${encodeURIComponent(entryId)}`));
}

export function scheduleRelease(client: HttpClient, id: string, publishAt: string): Promise<Release> {
	return client.post<Release>(releaseURL(id, '/schedule'), { publish_at: publishAt });
}

export function unscheduleRelease(client: HttpClient, id: string): Promise<Release> {
	return client.delete<Release>(releaseURL(id, '/schedule'));
}

export function publishRelease(client: HttpClient, id: string): Promise<Release> {
	return client.post<Release>(releaseURL(id, '/publish'), {});
}

export function cancelRelease(client: HttpClient, id: string): Promise<Release> {
	return client.post<Release>(releaseURL(id, '/cancel'), {});
}

/**
 * The conflicts a 409 carried, when the engine refused to schedule or publish
 * a release over other schedules. Null for any other failure.
 */
export function conflictsOf(err: unknown): ReleaseConflict[] | null {
	if (!(err instanceof ApiError) || err.status !== 409) return null;
	const body = (err.body ?? {}) as { conflicts?: unknown };
	return Array.isArray(body.conflicts) ? (body.conflicts as ReleaseConflict[]) : null;
}
