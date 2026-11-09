/**
 * The tenant's brand as every page draws it: the name in the tab title and
 * beside the mark, the logo, the accent and the tab icon.
 *
 * A signed-in page takes it from the tenant's customization, which the admin
 * layout reads with the session. A signed-out page has no session, so the
 * root layout reads the public copy instead. The engine answers that for the
 * tenant it resolves without a session: the one the host it was reached on
 * maps to, or the only one there is. An instance with several tenants that
 * reaches the engine under an internal name resolves none, and the page
 * keeps the product's own brand. Both copies arrive as `brand` in the page
 * data, and the nearest layout's wins.
 */
import { logoAddressOk } from '$lib/logo';
import { parseAccent } from '$lib/api/customization';

export interface PublicBrand {
	name: string;
	logo_url: string;
	accent: string;
	favicon_url: string;
}

/** The product's own name, shown wherever the tenant has not named it. */
export const PRODUCT_NAME = 'LyEve Console';

export const STOCK_BRAND: PublicBrand = { name: '', logo_url: '', accent: '', favicon_url: '' };

/** The public brand route, which a signed-out page can read. */
export const PUBLIC_BRAND_PATH = '/api/admin/auth/brand';

/**
 * Where an image the brand points at may live: a published file in this
 * instance's media library. The admin copies an image on another site into
 * the library before it stores the address, and its image policy would block
 * a foreign one anyway. A path that climbs out of the library is not one.
 */
function libraryAddress(url: string): boolean {
	return logoAddressOk(url) && url.startsWith('/api/v1/media/') && !url.split(/[/?#]/).includes('..');
}

/**
 * A brand safe to draw: a name, images from this instance's media library,
 * and an accent the theme can paint with. Anything else reads as unset.
 */
export function brandOf(raw: Partial<PublicBrand> | null | undefined): PublicBrand {
	const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
	const address = (v: unknown) => (libraryAddress(text(v)) ? text(v) : '');
	return {
		name: text(raw?.name).slice(0, 60),
		logo_url: address(raw?.logo_url),
		accent: parseAccent(text(raw?.accent)) || '',
		favicon_url: address(raw?.favicon_url),
	};
}

/** The brand a page's data carries, from whichever layout supplied it. */
export function pageBrand(data: unknown): PublicBrand | null {
	const brand = (data as { brand?: PublicBrand | null } | null | undefined)?.brand;
	return brand ?? null;
}

/** The name the admin goes by: the tenant's, or the product's. */
export function appName(brand: PublicBrand | null | undefined): string {
	return brand?.name || PRODUCT_NAME;
}

/** A tab title: the page's own parts, then the name the admin goes by. */
export function documentTitle(brand: PublicBrand | null | undefined, ...parts: (string | null | undefined)[]): string {
	return [...parts.filter((p): p is string => !!p), appName(brand)].join(' - ');
}

/**
 * The brand a signed-out page draws, read from the engine's public route.
 *
 * Anything but a 200 is the stock brand: an engine without the plugin answers
 * 404, and a page that cannot learn the brand still has to let somebody sign
 * in.
 */
export async function readPublicBrand(fetch: typeof globalThis.fetch): Promise<PublicBrand> {
	try {
		// A slow engine would hold every signed-out page, and the page is
		// whole without the brand.
		const res = await fetch(PUBLIC_BRAND_PATH, { signal: AbortSignal.timeout(2000) });
		if (!res.ok) return STOCK_BRAND;
		return brandOf((await res.json()) as Partial<PublicBrand> | null);
	} catch {
		return STOCK_BRAND;
	}
}
