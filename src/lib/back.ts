import type { ReadonlyURL } from '$app/state';

/** What a nested page hands PageShell's `back` prop. */
export type BackLink = { href: string; label: string };

/**
 * The list a detail page returns to, keeping the view the reader left.
 *
 * A list that can be filtered or paged forwards its live query on each row
 * link, so the detail page's own URL carries it. Only the named keys come
 * back, in the order given, so a stray parameter on the detail URL cannot
 * reach the list, and an empty value is dropped rather than sent as `?q=`.
 */
export function listBack(href: string, label: string, url: ReadonlyURL, keys: readonly string[]): BackLink {
	const params = new URLSearchParams();
	for (const key of keys) {
		const value = url.searchParams.get(key);
		if (value) params.set(key, value);
	}
	const query = params.toString();
	return { href: query ? `${href}?${query}` : href, label };
}

/**
 * The query a list row link carries so the detail page can hand it back.
 * Empty when nothing is set, so the common case stays a clean path.
 */
export function listQuery(filters: Record<string, string | number | null | undefined>): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(filters)) {
		if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
	}
	const query = params.toString();
	return query ? `?${query}` : '';
}

/**
 * The query an address carries, less the keys in `drop` and less the name of
 * the action a form posted to, as `?a=b` or an empty string. SvelteKit names
 * the action as the first key that starts with a slash.
 */
export function queryWithout(url: ReadonlyURL, drop: readonly string[] = []): string {
	const params = new URLSearchParams();
	for (const [key, value] of url.searchParams) {
		if (key.startsWith('/') || drop.includes(key)) continue;
		params.append(key, value);
	}
	const query = params.toString();
	return query ? `?${query}` : '';
}

/**
 * A form action that keeps the query the page carries. A bare `?/name`
 * replaces it, so the action, and the address its redirect names, would no
 * longer know the filters and the page the reader had open.
 */
export function actionWithQuery(name: string, query: string): string {
	return query ? `${query}&/${name}` : `?/${name}`;
}

/** Where an action sends the reader back to: the address it was posted from, less `drop`. */
export function returnAddress(url: ReadonlyURL, drop: readonly string[] = []): string {
	return `${url.pathname}${queryWithout(url, drop)}`;
}
