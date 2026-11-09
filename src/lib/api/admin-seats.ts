/**
 * The optional ceiling on admin accounts, as the pages that grant an admin
 * role read it.
 */
import { ADMIN_SEATS_CAP, refusalOf, type Refusal } from '$lib/api/refusal';

/**
 * The refusal of a write the engine refused at the admin seat ceiling, or
 * null for any other failure, including a refusal at a different cap. An
 * account holding admin or super_admin takes a seat. The page renders it with
 * `RefusalNotice`, so the numbers and the link to more seats come from the
 * engine and the page holds neither.
 */
export function seatRefusal(err: unknown): Refusal | null {
	const r = refusalOf(err);
	if (!r || r.kind !== 'cap' || r.cap !== ADMIN_SEATS_CAP) return null;
	return r;
}
