/**
 * What a person proves before exporting their own data. It is one setting
 * for the whole install, so only a super admin reads or changes it. Every
 * factor chosen is required, and none chosen means no step at all.
 *
 * An engine older than the setting answers 404, and the page then leaves it
 * out.
 */
import { ApiError, type HttpClient } from '@lyeve-labs/client';

const EXPORT_STEP_UP_URL = '/api/admin/analytics/gdpr/export-step-up';

/** Every factor, in the order the engine names them. */
export const STEP_UP_FACTORS = ['password', 'code', 'email'] as const;
export type StepUpFactor = (typeof STEP_UP_FACTORS)[number];

export interface StepUp {
	factors: StepUpFactor[];
}

export function isStepUpFactor(v: string): v is StepUpFactor {
	return (STEP_UP_FACTORS as readonly string[]).includes(v);
}

export async function readStepUp(client: HttpClient): Promise<StepUp> {
	return client.get<StepUp>(EXPORT_STEP_UP_URL);
}

export async function saveStepUp(client: HttpClient, factors: StepUpFactor[]): Promise<StepUp> {
	return client.put<StepUp>(EXPORT_STEP_UP_URL, { factors });
}

/**
 * Whether a save was refused because the instance cannot send mail, so an
 * emailed code cannot be required. The engine answers 422 for that alone,
 * so the status decides and a renamed code cannot break the check.
 */
export function mailUnavailable(err: unknown): boolean {
	return err instanceof ApiError && err.status === 422;
}
