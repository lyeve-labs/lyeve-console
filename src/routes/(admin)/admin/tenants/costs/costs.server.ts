import { error, fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { actionError } from '$lib/server/action-error';
import { forbiddenText, gateOf, type Gate, type Section } from '$lib/api/gate';

/** The roles every tenant costs page and write admits. */
export const OPERATOR_ROLES = ['admin', 'super_admin'];

/** Refuses a reader below admin before anything is read. */
export function refuseBelowAdmin(user: { roles: string[] }): void {
	if (!user.roles.some((role) => OPERATOR_ROLES.includes(role))) {
		error(403, forbiddenText('this page', OPERATOR_ROLES));
	}
}

/** What a read holds before it is made: the shell already says why the page is unavailable. */
export const UNREAD: Section<never> = { ok: false, gate: { state: 'absent' } };

/**
 * Reads the ledger's routes for one page. They answer 402 on an instance
 * that is not enabled for them, and the page renders that answer rather than
 * predicting it, so `refused()` returns the link the first refusal named.
 */
export function ledgerReader() {
	let upgradeUrl: string | null = null;
	return {
		read<T>(pending: Promise<T>, failed: string): Promise<Section<T>> {
			return pending.then(
				(value): Section<T> => ({ ok: true, value }),
				(err: unknown): Section<T> => {
					const gate: Gate = gateOf(err, failed);
					if (gate.state === 'locked') upgradeUrl = gate.upgradeUrl;
					return { ok: false, gate };
				},
			);
		},
		/** Where the ledger is turned on, once a read was refused for it, else null. */
		refused: (): string | null => upgradeUrl,
	};
}

/** A refused write: a 402 means the ledger is not enabled, and is said as such. */
export function refusal<T extends object>(tag: T, err: unknown, fallback: string) {
	if (err instanceof ApiError && err.status === 402) {
		return fail(402, { ...tag, error: 'The cost ledger is not enabled on this engine.', locked: true });
	}
	return fail(400, { ...tag, error: actionError(err, fallback), locked: false });
}
