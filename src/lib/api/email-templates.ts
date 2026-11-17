/**
 * Email templates: the subject and MJML body a mail is rendered from, served
 * by the email plugin. Some templates are required, because a sign-in mail is
 * sent from them, and the plugin says which.
 */

import type { HttpClient } from '@lyeve-labs/client';
import { rowsOf, type ListEnvelope } from '#lib/api/list.ts';

const BASE = '/api/admin/email-templates';

export type TemplateStatus = 'draft' | 'active' | 'archived';

export interface EmailTemplate {
	id: string;
	key: string;
	subject: string;
	mjml_source: string;
	status: TemplateStatus;
	/** A sign-in mail is sent from it, so it cannot be deleted or switched off. */
	required: boolean;
	updated_at?: string;
}

/** A built-in body to start a template from. */
export interface TemplateStarter {
	key: string;
	subject: string;
	mjml_source: string;
	required: boolean;
	/** The variable a required template's body has to print. */
	link_variable?: string;
}

/** How many templates the tenant holds, and the most it may. A limit of 0 is none. */
export interface TemplateLimits {
	limit: number;
	current: number;
}

export interface TemplateInput {
	subject: string;
	mjml_source: string;
	status: TemplateStatus;
}

export interface TemplatePreview {
	subject: string;
	html: string;
}

export async function listTemplates(client: HttpClient): Promise<EmailTemplate[]> {
	const res = await client.get<ListEnvelope<EmailTemplate> | EmailTemplate[]>(`${BASE}?limit=200`);
	return rowsOf(res).map((t) => ({ ...t, required: t.required === true }));
}

export async function templateLimits(client: HttpClient): Promise<TemplateLimits | null> {
	const res = await client.get<{ templates?: Partial<TemplateLimits> } | null>(`${BASE}/limits`);
	const t = res?.templates;
	if (typeof t?.limit !== 'number' || typeof t?.current !== 'number') return null;
	return { limit: t.limit, current: t.current };
}

export async function templateStarters(client: HttpClient): Promise<TemplateStarter[]> {
	const res = await client.get<{ data?: TemplateStarter[] } | null>(`${BASE}/starters`);
	return Array.isArray(res?.data) ? res.data : [];
}

export function createTemplate(client: HttpClient, body: TemplateInput & { key: string }): Promise<EmailTemplate> {
	return client.post<EmailTemplate>(BASE, body);
}

export function updateTemplate(client: HttpClient, id: string, body: Partial<TemplateInput>): Promise<EmailTemplate> {
	return client.put<EmailTemplate>(`${BASE}/${encodeURIComponent(id)}`, body);
}

export function deleteTemplate(client: HttpClient, id: string): Promise<void> {
	return client.delete<void>(`${BASE}/${encodeURIComponent(id)}`);
}

export function previewTemplate(client: HttpClient, key: string, vars: Record<string, string>): Promise<TemplatePreview> {
	return client.post<TemplatePreview>(`${BASE}/key/${encodeURIComponent(key)}/preview`, { vars });
}

/**
 * Values a preview is rendered with, one for every variable the built-in
 * bodies print, so a preview reads like a mail and not like blanks.
 */
export const SAMPLE_VARS: Record<string, string> = {
	name: 'Ada',
	email: 'ada@example.com',
	reset_link: 'https://example.com/reset-password?token=sample',
	magic_link: 'https://example.com/magic-link?token=sample',
	expires_in: '1 hour',
	dashboard_url: 'https://example.com/dashboard',
	security_settings_url: 'https://example.com/settings/security',
	mfa_method: 'Authenticator app',
};

/** What each required template is sent for, in the words the page shows. */
export const REQUIRED_PURPOSE: Record<string, string> = {
	'password-reset': 'Sent when someone asks to reset their password.',
	'magic-link': 'Sent when someone signs in with a link instead of a password.',
};

/** A template key: lower case letters, digits and dashes, starting with a letter. */
export const TEMPLATE_KEY = /^[a-z][a-z0-9-]{0,62}$/;
