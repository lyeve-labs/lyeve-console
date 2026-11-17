import type { BackLink } from '#lib/back.ts';

const FLOWS: BackLink = { href: '/admin/flows', label: 'Flows' };

/** The query key the editor's shortcuts carry to the datasource and variable pages. */
export const FROM_FLOW = 'flow';

/** A shortcut from the editor to one of its neighbors, carrying the way back. */
export function fromFlow(href: string, flowId: string): string {
	return flowId ? `${href}?${FROM_FLOW}=${encodeURIComponent(flowId)}` : href;
}

/**
 * Where a datasource or variable page returns to. A reader who came from the
 * editor to add the connection a node was missing goes back to that flow, not
 * to the list they would have to find it in again. Only an id shaped like one
 * is honored, so the parameter cannot point the link anywhere else.
 */
export function flowBack(url: URL): BackLink {
	const id = url.searchParams.get(FROM_FLOW);
	if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return FLOWS;
	return { href: `/admin/flows/${id}`, label: 'Flow editor' };
}
