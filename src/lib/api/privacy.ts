/**
 * A tenant's privacy settings: what an erasure does with the tenant's form
 * submissions, and what a person may take when they export their own data.
 *
 * Each setting belongs to the plugin that serves its routes, and a page shows
 * one only while those routes answer. An engine older than a setting answers
 * 404 on its routes, and the page then leaves the setting out rather than
 * offering a control that cannot save. A session that names no tenant is
 * answered 400, because every setting here is one tenant's.
 */
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { ApiError, type HttpClient } from '@lyeve-labs/client';
import { gateOf, type Section } from './gate';
import type { NotRunningReason } from '$lib/plugins';

const FORM_ERASURE_URL = '/api/admin/schemas/form-erasure';

export const FORM_ERASURE_MODES = ['auto', 'soft', 'hard'] as const;
export type FormErasureMode = (typeof FORM_ERASURE_MODES)[number];

export interface FormErasure {
	mode: FormErasureMode;
}

/** What the page says, once, when the session names no tenant. */
export const NO_TENANT =
	"These settings belong to a tenant, and you're not signed in to one. Sign in to a tenant to view or change them.";

/**
 * A setting as load data. Null while its route is not there, on an engine
 * that predates it, and the page leaves it out. Stopped while the engine says
 * the plugin serving it does not run, with the reason the shell would give.
 * Otherwise the value it read, or the gate that says why there is none.
 */
export type Setting<T> = Section<T> | { ok: false; stopped: NotRunningReason } | null;

/** A read the engine refused because the session names no tenant. */
export const NO_TENANT_READ = { ok: false, noTenant: true } as const;

/** What one read answers, before the page knows whether the session names a tenant. */
export type SettingRead<T> = Setting<T> | typeof NO_TENANT_READ;

/** A failed read as a setting: hidden on a 404, otherwise kept as a gate. */
function failedRead(err: unknown, failed: string): Setting<never> {
	if (isRedirect(err) || isHttpError(err)) throw err;
	if (err instanceof ApiError && err.status === 404) return null;
	return { ok: false, gate: gateOf(err, failed) };
}

/**
 * Await a tenant setting's read. A 404 hides the setting, a 400 says the
 * session names no tenant, and any other failure is kept as a gate.
 */
export async function setting<T>(read: Promise<T>, failed: string): Promise<SettingRead<T>> {
	try {
		return { ok: true, value: await read };
	} catch (err) {
		if (err instanceof ApiError && err.status === 400) return NO_TENANT_READ;
		return failedRead(err, failed);
	}
}

/** Await an instance setting's read. No tenant is involved, so a 400 is a failure like any other. */
export async function installSetting<T>(read: Promise<T>, failed: string): Promise<Setting<T>> {
	try {
		return { ok: true, value: await read };
	} catch (err) {
		return failedRead(err, failed);
	}
}

/** Whether a read was refused because the session names no tenant. */
export function namesNoTenant(read: SettingRead<unknown>): read is typeof NO_TENANT_READ {
	return read !== null && 'noTenant' in read;
}

export function isFormErasureMode(v: string): v is FormErasureMode {
	return (FORM_ERASURE_MODES as readonly string[]).includes(v);
}

export async function readFormErasure(client: HttpClient): Promise<FormErasure> {
	return client.get<FormErasure>(FORM_ERASURE_URL);
}

export async function saveFormErasure(client: HttpClient, mode: FormErasureMode): Promise<FormErasure> {
	return client.put<FormErasure>(FORM_ERASURE_URL, { mode });
}

/**
 * The self-service export: the sections a person may include when they
 * export their own data, and the roles that may export. A section is the data
 * one part of the instance keeps, or the account itself. Only what the tenant
 * leaves out is stored, so a section that appears later is offered until
 * someone leaves it out too.
 */
const EXPORT_SECTIONS_URL = '/api/admin/analytics/gdpr/export-sections';
const EXPORT_ROLES_URL = '/api/admin/analytics/gdpr/export-roles';

/** The most roles, and the longest role name, the export roles route takes. */
export const MAX_EXPORT_ROLES = 64;
export const MAX_ROLE_LENGTH = 64;

/** The roles that may always export, whatever the tenant chooses. */
export const ALWAYS_EXPORT: readonly string[] = ['admin', 'super_admin'];

export interface ExportSections {
	/** Every section an export can hold now, and whether the tenant offers it. */
	sections: { section: string; offered: boolean }[];
	/** What the tenant left out, which may name a section that is not available now. */
	excluded: string[];
}

export async function readExportSections(client: HttpClient): Promise<ExportSections> {
	return client.get<ExportSections>(EXPORT_SECTIONS_URL);
}

export async function saveExportSections(client: HttpClient, excluded: string[]): Promise<ExportSections> {
	return client.put<ExportSections>(EXPORT_SECTIONS_URL, { excluded });
}

export async function readExportRoles(client: HttpClient): Promise<{ roles: string[] }> {
	return client.get<{ roles: string[] }>(EXPORT_ROLES_URL);
}

export async function saveExportRoles(client: HttpClient, roles: string[]): Promise<{ roles: string[] }> {
	return client.put<{ roles: string[] }>(EXPORT_ROLES_URL, { roles });
}

/** What a section holds, in the words a tenant admin reads. */
const SECTION_TEXT: Readonly<Record<string, { label: string; description?: string }>> = {
	engine: { label: 'Account', description: 'The account itself, with its email address and roles.' },
	analytics: {
		label: 'Content, uploads and activity',
		description: 'The entries they created, the files they uploaded and the record of what they did.',
	},
	schema: { label: 'Form submissions and comments', description: 'Submissions and comments that hold their address.' },
	ai: { label: 'AI requests' },
	email: { label: 'Email' },
	flow: { label: 'Flow runs' },
	'magic-link': { label: 'Sign-in links' },
	mfa: { label: 'Two-factor authentication' },
	'device-fingerprint': { label: 'Trusted devices' },
	media: { label: 'Media' },
	storage: { label: 'Stored files' },
	'request-capture': { label: 'Captured requests' },
	audit: { label: 'Audit trail' },
	oauth: { label: 'Linked sign-in accounts' },
};

/** A section as an option. A section this console does not know is named from its own name. */
export function sectionOption(section: string): { value: string; label: string; description?: string } {
	const known = SECTION_TEXT[section];
	if (known) return { value: section, ...known };
	const words = section.replace(/[-_]+/g, ' ').trim();
	return { value: section, label: words ? words[0].toUpperCase() + words.slice(1) : section };
}
