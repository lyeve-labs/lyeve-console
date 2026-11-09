import type { HttpClient } from '@lyeve-labs/client';

/** How the engine grades one control. */
export type ControlStatus = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';

/** One security control as the engine reports it. */
export interface SecurityControl {
	control: string;
	status: ControlStatus;
	detail: string;
	/** What turns the control on. Absent when it already is. */
	remedy?: string;
}

export interface SecurityControls {
	checked_at: string;
	controls: SecurityControl[];
	failures: number;
}

/**
 * The engine's control liveness report: which protections are enforcing,
 * which are compiled and off, and what turns each one on. Evaluated when
 * asked, so a plugin the license activated after boot shows without a
 * restart. Answers super_admin only.
 */
export function getSecurityControls(client: HttpClient): Promise<SecurityControls> {
	return client.get<SecurityControls>('/api/admin/security/controls');
}

/** What each grade means to an operator, in the words the page shows. */
export const STATUS_LABEL: Record<ControlStatus, string> = {
	PASS: 'Enforcing',
	WARN: 'Not configured',
	FAIL: 'Not enforcing',
	SKIP: 'Not active',
};

/** The name a control is shown under. The engine's names are its own. */
export const CONTROL_LABEL: Record<string, string> = {
	'pii-mask': 'PII masking',
	'data-residency': 'Data residency',
	'quota/rate-limit': 'Rate limiting',
	quota: 'Quotas',
	waf: 'Web application firewall',
	mfa: 'Multi-factor authentication',
	'session-anomaly': 'Session anomaly and brute force',
};

/** What a control protects against, so a SKIP reads as a decision rather than a label. */
export const CONTROL_SUMMARY: Record<string, string> = {
	'pii-mask': 'Masks personal data in responses and in the log.',
	'data-residency': 'Refuses writes that would leave the configured region.',
	'quota/rate-limit': 'Caps requests per client so one caller cannot exhaust the engine.',
	quota: 'Caps what a tenant may store and send.',
	waf: 'Blocks injection patterns in paths, headers, cookies and bodies.',
	mfa: 'Asks for a second factor at login.',
	'session-anomaly': 'Locks out repeated failed logins and flags sessions whose device fingerprint changes.',
};
