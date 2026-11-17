/**
 * The audit log's filter, as the page carries it and as the engine takes it.
 * Lives beside the load rather than in it: a page module may export nothing
 * but what SvelteKit names, and a helper exported from one is a 500 in the
 * browser that every unit test passes.
 */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The filter the page carries in its address. Every link on the page keeps it. */
export interface AuditFilter {
	q: string;
	action: string;
	from: string;
	to: string;
}

export function readFilter(url: URL): AuditFilter {
	const day = (key: string) => {
		const v = url.searchParams.get(key) ?? '';
		return DAY.test(v) ? v : '';
	};
	// A From day after the To day is a reversed range, which the engine
	// refuses outright. The two days are swapped, so the reader sees the
	// window they meant instead of a failed read.
	let from = day('from');
	let to = day('to');
	if (from && to && from > to) [from, to] = [to, from];
	return {
		q: (url.searchParams.get('q') ?? '').trim(),
		action: (url.searchParams.get('action') ?? '').trim(),
		from,
		to,
	};
}

/** The most entries an audit export holds when the request names no limit. */
export const AUDIT_EXPORT_CEILING = 100_000;

/**
 * The body of an audit export for the filter on screen.
 *
 * The export takes the dates, the action and the resource type, but no user
 * or record id, so a search for an id is not applied to the file. It names no
 * limit, so the plugin stops at its ceiling.
 */
export function exportBody(filter: AuditFilter): Record<string, string> {
	const params = endpointQuery(filter, 1, 0);
	const body: Record<string, string> = { format: 'json' };
	for (const key of ['from', 'to', 'action', 'resource_type']) {
		const value = params.get(key);
		if (value) body[key] = value;
	}
	return body;
}

/**
 * The endpoint's own filters for one search box.
 *
 * The engine matches exactly and takes no free text: `actor` is a user id,
 * `action` is the namespaced name (`content.delete`) and `resource_type` is
 * the bare type. One box has to pick the column by the shape of what was
 * typed: an id goes to the actor, a dotted name to the action, and anything
 * else to the resource type. The action select wins over a dotted search,
 * because both name the same column. A search for the action the select
 * already chose adds nothing, and one for another action stays a resource
 * type, which matches nothing, as no entry has two actions.
 */
export function endpointQuery(filter: AuditFilter, limit: number, offset: number): URLSearchParams {
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	if (filter.action) params.set('action', filter.action);
	if (filter.q && filter.q !== filter.action) {
		if (UUID.test(filter.q)) params.set('actor', filter.q);
		else if (filter.q.includes('.') && !filter.action) params.set('action', filter.q);
		else params.set('resource_type', filter.q);
	}
	// `to` is exclusive on the engine, so the chosen day is kept whole by
	// asking for everything before the next one.
	if (filter.from) params.set('from', `${filter.from}T00:00:00Z`);
	if (filter.to) {
		const next = new Date(`${filter.to}T00:00:00Z`);
		next.setUTCDate(next.getUTCDate() + 1);
		params.set('to', next.toISOString().slice(0, 10) + 'T00:00:00Z');
	}
	return params;
}

