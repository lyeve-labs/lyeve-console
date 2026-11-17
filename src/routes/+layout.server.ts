import type { LayoutServerLoad } from './$types';
import { readPublicBrand, type PublicBrand } from '#lib/brand.ts';

/**
 * The brand for the pages outside the admin frame: sign-in, password reset,
 * magic links, first-run setup and the error pages.
 *
 * The admin layout supplies its own copy from the session's tenant, so a page
 * inside it is not asked twice. The route is tracked, so a client-side move
 * out of the admin, such as an expired session sent to the sign-in page,
 * reads the brand again. Inside the admin the re-run asks nothing.
 */
export const load: LayoutServerLoad = async (event) => {
	const inAdmin = event.route.id?.startsWith('/(admin)') ?? false;
	const brand: PublicBrand | null = inAdmin ? null : await readPublicBrand(event.fetch);
	return { brand };
};
