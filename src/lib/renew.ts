import { ApiError } from '@lyeve-labs/client';
import { refreshAll } from '$app/navigation';

/**
 * Sends a request the browser makes to the engine itself, and sends it once
 * more after a 401. The console renews the engine's short session token only
 * on a request its own server handles, so a call that goes straight to the
 * engine can carry a token that lapsed while the session is still alive.
 * Rerunning the loads is a request to this console, which renews the token,
 * and a session that really ended goes to sign in from the layout's load. A
 * second 401 is handed back for the page to say so without leaving it.
 */
export async function renewingOnce<T>(call: () => Promise<T>): Promise<T> {
	try {
		const first = await call();
		if (!(first instanceof Response && first.status === 401)) return first;
	} catch (err) {
		if (!(err instanceof ApiError && err.status === 401)) throw err;
	}
	// A reader who stays at the leave prompt cancels the layout's way to sign
	// in. The call still runs again, so the page has a refusal to show.
	await refreshAll().catch(() => undefined);
	return call();
}
