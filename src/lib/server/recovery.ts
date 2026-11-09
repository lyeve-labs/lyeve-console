import { ApiError } from '@lyeve-labs/client';
import { inSentence } from '$lib/api/gate';
import { outageFor } from '$lib/outage';

/**
 * The sentence a signed-out recovery page shows for an engine refusal that is
 * not about the visitor's input, or null when the refusal is the caller's to
 * explain.
 *
 * Magic links and password reset are plugins. An instance that runs neither
 * has no route, so the engine answers 404 (or 405 when a neighboring method
 * exists), and a 402 means the plugin is loaded but not enabled to serve.
 * Either way the visitor needs to hear that this way in is closed, not that
 * they typed something wrong.
 */
export function recoveryRefusal(e: unknown, feature: string): { status: number; error: string } | null {
	if (!(e instanceof ApiError)) {
		return { status: 503, error: outageFor(`${inSentence(feature)} is not available`) };
	}
	if (e.status === 402) {
		return { status: 404, error: `${feature} is not enabled on this engine. Ask a super admin to sign you in.` };
	}
	if (e.status === 404 || e.status === 405) {
		return { status: 404, error: `${feature} is not included in this build. Ask a super admin to sign you in.` };
	}
	if (e.status === 429) {
		return { status: 429, error: 'Too many attempts. Wait a few minutes, then try again.' };
	}
	if (e.status >= 500) {
		return { status: e.status, error: outageFor(`${inSentence(feature)} is not available`) };
	}
	return null;
}
