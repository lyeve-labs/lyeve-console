import { ApiError, createClient } from '@lyeve-labs/client';
import { getSetupStatus, type SetupTokenSource } from '$lib/api/setup';
import { localPath } from '$lib/server/local-path';

/**
 * Where the engine is on its way to serving the admin.
 *
 * - `unreachable`: no answer. The engine is down, restarting, or the admin
 *   points at the wrong address.
 * - `setup_mode`: the engine booted without a database or its secrets and
 *   serves only the setup routes.
 * - `needs_admin`: configured, database reachable, no account yet.
 * - `ready`: an account exists, so sign-in and the console work.
 * - `busy`: the engine answered, but with 429. It is up and says nothing about
 *   setup, so the request goes on to whatever it was for.
 */
export type EngineSetupState = 'unreachable' | 'setup_mode' | 'needs_admin' | 'ready' | 'busy';

export interface EngineSetup {
	state: EngineSetupState;
	tokenSource: SetupTokenSource | null;
}

/**
 * Asks the engine for its setup state. Every failure is `unreachable`, never
 * a guess in either direction: guessing "done" would send a fresh install to
 * a login that cannot work, and guessing "needed" would show an existing
 * install a setup form.
 */
export async function readEngineSetup(fetchFn: typeof fetch): Promise<EngineSetup> {
	try {
		const status = await getSetupStatus(createClient(fetchFn));
		const tokenSource = status.token_source ?? null;
		if (status.mode === 'setup') return { state: 'setup_mode', tokenSource };
		if (status.setup_required) return { state: 'needs_admin', tokenSource };
		return { state: 'ready', tokenSource: null };
	} catch (e) {
		// A rate-limited answer is an engine that is up. Reading it as down
		// would send a refused sign-in to the setup screen and back to an empty
		// login form, hiding the message the refusal carries.
		if (e instanceof ApiError && e.status === 429) return { state: 'busy', tokenSource: null };
		return { state: 'unreachable', tokenSource: null };
	}
}

/**
 * Paths the gate never redirects: the setup screen itself, the admin's own
 * server endpoints, SvelteKit's assets, static files (anything whose last
 * segment has an extension), and the readiness probe, whose 503 a redirect
 * to the setup screen would turn into a 200.
 */
export function isGatedPath(pathname: string): boolean {
	if (pathname === '/setup' || pathname.startsWith('/setup/')) return false;
	if (pathname === '/readyz') return false;
	if (pathname.startsWith('/api/') || pathname.startsWith('/_app/')) return false;
	const last = pathname.slice(pathname.lastIndexOf('/') + 1);
	return !last.includes('.');
}

/**
 * A `next` target is followed only when it is a path on this origin, so the
 * setup screen cannot be used to bounce a visitor somewhere else.
 */
export function safeNext(next: string | null): string | null {
	const path = localPath(next, '');
	if (!path) return null;
	if (path === '/setup' || path.startsWith('/setup?') || path.startsWith('/setup/')) return null;
	return path;
}

// Once the engine reports an account, it keeps one. The gate stops asking for
// a short while so a signed-in session does not pay an engine round trip on
// every page. Any other state is re-read on every request, because each of
// them is expected to change.
const READY_TTL_MS = 15_000;
let readyUntil = 0;

/**
 * The one setup check: returns where to send the request, or null to let it
 * through. Every route reads this one answer, so no two disagree when the
 * engine cannot be reached.
 *
 * A request that carries a session goes through when the engine cannot be
 * reached. That session belonged to an instance that already had an account,
 * so the engine is down rather than unset, and the page's own session check
 * shows the outage page. The setup screen would ask a signed-in reader to
 * configure an engine that is only away, and a form posted during the outage
 * would lose its edits to the redirect.
 */
export async function setupGateRedirect(
	url: URL,
	fetchFn: typeof fetch,
	now = Date.now(),
	signedIn = false,
): Promise<string | null> {
	if (!isGatedPath(url.pathname)) return null;
	if (now < readyUntil) return null;
	const { state } = await readEngineSetup(fetchFn);
	if (state === 'ready') {
		readyUntil = now + READY_TTL_MS;
		return null;
	}
	if (state === 'busy') return null;
	if (state === 'unreachable' && signedIn) return null;
	const next = url.pathname + url.search;
	return next === '/' ? '/setup' : `/setup?next=${encodeURIComponent(next)}`;
}
