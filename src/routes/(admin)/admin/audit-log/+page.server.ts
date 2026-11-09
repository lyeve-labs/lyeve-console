import type { PageServerLoad, Actions } from './$types';
import { ApiError } from '@lyeve-labs/client';
import { authedClient, authedHeaders, loadUser, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { error, fail, redirect } from '@sveltejs/kit';
import { unwrapList } from '@lyeve-labs/client-rest';
import { pageNumber, pageOffset, pastEndOffset, statedTotal, withOffset, type ListEnvelope } from '$lib/api/list';
import { section, type Section } from '$lib/api/gate';
import { AUDIT_EXPORT_CEILING, UUID, endpointQuery, readFilter } from '$lib/server/audit-filter';
import { formatCount } from '$lib/format';
import { rolesInWords } from '$lib/roles';
import { couldNotLoad } from '$lib/outage';

export interface AuditEntry {
	id: string;
	action: string;
	resource_type: string;
	resource_id: string;
	user_id: string;
	ip: string;
	user_agent: string;
	created_at: string;
}

const PAGE_SIZE = 50;
const READERS = ['admin', 'super_admin'];

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const user = await loadUser(event);
	if (!user.roles.some((r) => READERS.includes(r))) error(403, `Only ${rolesInWords(READERS)} can open this page.`);
	const client = authedClient(event);
	const limit = PAGE_SIZE;
	// The offset comes from the address, so it is clamped and snapped to a page
	// boundary before the engine sees it or the pager counts from it.
	const asked = Math.max(0, Number(url.searchParams.get('offset')) || 0);
	const offset = pageOffset(pageNumber(asked, limit), limit);
	const filter = readFilter(url);

	// GET /api/admin/audit-log answers with a paginated envelope. Read as a bare
	// array, entries.length is undefined and the table is empty.
	const read = (params: URLSearchParams) =>
		client.get<AuditEntry[] | ListEnvelope<AuditEntry>>(`/api/admin/audit-log?${params}`);

	async function readLog(): Promise<{ entries: AuditEntry[]; stated: number | null }> {
		let res = await read(endpointQuery(filter, limit, offset));
		let entries = unwrapList<AuditEntry>(res);

		// An id names a user or a record, and the box cannot tell which. The actor
		// is asked first because that is the question most often typed. A miss is
		// asked again as a resource id before the page says nothing matched.
		if (entries.length === 0 && filter.q && UUID.test(filter.q)) {
			const params = endpointQuery(filter, limit, offset);
			params.delete('actor');
			params.set('resource_id', filter.q);
			res = await read(params);
			entries = unwrapList<AuditEntry>(res);
		}
		return { entries, stated: statedTotal<AuditEntry>(res) };
	}

	const log = await section(
		readLog(),
		couldNotLoad('the audit log')
	);
	const isSuperAdmin = user.roles.includes('super_admin');
	// The plugin stops an export that names no limit at its ceiling, and it
	// cannot narrow a file by user or record id.
	const exportNote =
		`Exports include the entries that match the dates, action and resource type, up to ${formatCount(AUDIT_EXPORT_CEILING)}.` +
		(UUID.test(filter.q) ? ' Searching by id does not filter the export.' : '');

	if (!log.ok) {
		return { entries: log, total: null, offset, limit, isSuperAdmin, filter, actions: [] as string[], exportNote };
	}

	const rows = log.value.entries;
	const back = pastEndOffset(rows.length, limit, offset, log.value.stated);
	if (back !== null) redirect(307, withOffset(url, back));

	// The envelope carries the real row count. A count guessed from the page
	// length undercounts a large log and the pager offers too few pages. What
	// has been read is the floor, for an answer that omits the count.
	const total = Math.max(log.value.stated ?? 0, offset + rows.length);
	// The action filter offers what is on the page plus the one in force. The
	// engine keeps no list of the names it has written, so the page is the
	// only source there is. With an action in force every row carries that
	// one, so the names come from the same window read without it. Losing
	// that read loses only the extra names.
	let seen = rows;
	if (filter.action) {
		const params = endpointQuery({ ...filter, action: '', q: filter.q.includes('.') ? '' : filter.q }, limit, 0);
		seen = await read(params)
			.then((res) => unwrapList<AuditEntry>(res))
			.catch(() => rows);
	}
	const actions = [...new Set([...seen.map((e) => e.action), filter.action].filter(Boolean))].sort();
	const entries: Section<AuditEntry[]> = { ok: true, value: rows };
	return { entries, total, offset, limit, isSuperAdmin, filter, actions, exportNote };
};

export const actions: Actions = {
	prune: async (event) => {
		await requireRole(event, ['super_admin']);
		const form = await event.request.formData();
		const olderThanRaw = form.get('older_than') as string;

		if (!olderThanRaw) {
			return fail(400, { error: 'Choose a date first.' });
		}

		const olderThan = `${olderThanRaw}T00:00:00Z`;

		const res = await event.fetch('/api/admin/audit-log/prune', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...authedHeaders(event),
			},
			body: JSON.stringify({ older_than: olderThan }),
		});

		if (!res.ok) {
			// The plugin says why it refused, such as a cut-off later than now,
			// and the reason reaches the page. A 5xx body stays on the server.
			const body = (await res.json().catch(() => undefined)) as { error?: unknown } | undefined;
			const message = typeof body?.error === 'string' ? body.error : '';
			return actionFailure(new ApiError(res.status, message, body), 'Could not prune the audit log. Try again.', res.status);
		}

		const result = (await res.json()) as { deleted: number };
		redirect(303, `/admin/audit-log?pruned=${result.deleted}`);
	},
};
