/**
 * Where the console keeps the reader's sidebar collapse choice.
 *
 * A cookie rather than local storage, because the server draws the shell:
 * it reads the choice before the first paint, so the sidebar never jumps
 * after hydration. The value is `1` for collapsed and `0` for expanded.
 */
export const SIDEBAR_COOKIE = 'lyeve-admin-sidebar-collapsed';

/**
 * Where the choice was kept before the cookie. Read once and moved over, so a
 * reader who collapsed the sidebar before keeps it collapsed.
 */
export const OLD_SIDEBAR_KEY = 'lyeve-admin-sidebar-collapsed';

/** The stored choice, or null when this browser has not stored one. */
export function sidebarChoice(value: string | undefined): boolean | null {
	if (value === '1') return true;
	if (value === '0') return false;
	return null;
}

/** Writes the choice for a year, for every path the console serves. */
export function storeSidebarChoice(collapsed: boolean): void {
	const secure = location.protocol === 'https:' ? '; secure' : '';
	document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? '1' : '0'}; path=/; max-age=31536000; samesite=lax${secure}`;
}
