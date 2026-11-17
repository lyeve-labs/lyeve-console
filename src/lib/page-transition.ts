import { motion } from '@lyeve-labs/ui-kit';
import type { OnNavigate } from '$app/navigation';

/**
 * Set on the element that fades in after a route change. app.css gives `a`
 * and `b` two keyframes of the same fade, and each change sets the value the
 * element does not have yet, so a change during a fade starts it over.
 */
export const ENTERING = 'data-page-entering';

const inFrame = (routeId: string | null | undefined) => routeId?.startsWith('/(admin)') ?? false;

/**
 * Fades the new page in on a route change. Pass it to SvelteKit's onNavigate.
 *
 * SvelteKit calls it just before it swaps the page in, in the same task, so
 * the marked element is still transparent at the first frame that shows the
 * new page. Inside the console's frame only the content region fades, and the
 * sidebar and the header hold still. A change that enters or leaves the frame
 * fades the whole body.
 *
 * Nothing asks the browser for a view transition. In desktop Chrome on Intel
 * graphics a view transition's snapshot came out white: the content region
 * flashed white while it had a snapshot of its own, and the whole page did
 * once only the root had one.
 *
 * The page itself changes in one frame. Every kit surface plays its exit when
 * the page holding it goes, and the page waits for it, so an alert on the page
 * being left kept that page on screen above the new one. The kit's
 * `motion.swapPage()` runs every exit and entrance in no time until the next
 * frame.
 *
 * A change of query alone, such as a filter or a page of results, keeps the
 * reader in place and does not fade. Under reduced motion the kit's
 * stylesheet shortens the fade to 1ms.
 */
export function fadeRouteChange(navigation: OnNavigate): void {
	if (typeof document === 'undefined') return;
	if (navigation.from?.url.pathname === navigation.to?.url.pathname) return;
	motion.swapPage();
	const frame = inFrame(navigation.from?.route.id) && inFrame(navigation.to?.route.id);
	const target = (frame && document.getElementById('content')) || document.body;
	target.setAttribute(ENTERING, target.getAttribute(ENTERING) === 'a' ? 'b' : 'a');
}
