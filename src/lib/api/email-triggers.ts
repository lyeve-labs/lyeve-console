/**
 * Email triggers: a template sent when a content or review event fires,
 * the way a webhook posts to a URL. Served by the email plugin.
 */

import type { HttpClient } from '@lyeve-labs/client';
import { rowsOf, type ListEnvelope } from '#lib/api/list.ts';
import { refusalOf, type Refusal } from '#lib/api/refusal.ts';

const BASE = '/api/admin/email/triggers';

export interface EmailTrigger {
	id: string;
	name: string;
	event: string;
	schema: string;
	template_key: string;
	to_static: string[];
	to_field: string;
	locale: string;
	enabled: boolean;
	updated_at: string;
}

export interface EmailTriggerInput {
	name: string;
	event: string;
	schema: string;
	template_key: string;
	to_static: string[];
	to_field: string;
	locale: string;
	enabled: boolean;
}

/** The events a trigger may watch, with the words the form shows for each. */
export const TRIGGER_EVENT_LABELS: Record<string, string> = {
	after_create: 'A record is created',
	after_update: 'A record is updated',
	after_delete: 'A record is deleted',
	'review.transitioned': 'A review moves to another stage',
	'review.sla.breached': 'A review misses its deadline',
};

export interface EmailTemplateSummary {
	id: string;
	key: string;
	subject: string;
	status: string;
}

export async function listEmailTriggers(client: HttpClient): Promise<{ triggers: EmailTrigger[]; events: string[] }> {
	const res = await client.get<{ data?: EmailTrigger[]; events?: string[] } | null>(BASE);
	return {
		triggers: Array.isArray(res?.data) ? res.data : [],
		events: Array.isArray(res?.events) ? res.events : Object.keys(TRIGGER_EVENT_LABELS),
	};
}

export function createEmailTrigger(client: HttpClient, body: EmailTriggerInput): Promise<EmailTrigger> {
	return client.post<EmailTrigger>(BASE, body);
}

export function updateEmailTrigger(client: HttpClient, id: string, body: EmailTriggerInput): Promise<EmailTrigger> {
	return client.put<EmailTrigger>(`${BASE}/${encodeURIComponent(id)}`, body);
}

export function deleteEmailTrigger(client: HttpClient, id: string): Promise<void> {
	return client.delete<void>(`${BASE}/${encodeURIComponent(id)}`);
}

/** The tenant's email templates, for the trigger form's template list. */
export async function listEmailTemplates(client: HttpClient): Promise<EmailTemplateSummary[]> {
	const res = await client.get<ListEnvelope<EmailTemplateSummary> | EmailTemplateSummary[]>('/api/admin/email-templates?limit=200');
	return rowsOf(res).map((t) => ({ id: t.id, key: t.key, subject: t.subject, status: t.status }));
}

/**
 * The license refusal a trigger create or update would meet, or null.
 *
 * The plugin licenses trigger writes with the same paid capability as its
 * webhook list, and its trigger list says nothing about the license. So the
 * webhook list is read as a probe: a 402 naming a capability means a create
 * or an edit would be refused too. Any other answer, a failure included, is
 * not a refusal, and the save reports for itself.
 */
export async function triggerWriteRefusal(client: HttpClient): Promise<Refusal | null> {
	try {
		await client.get('/api/admin/email/webhooks');
		return null;
	} catch (err) {
		const refused = refusalOf(err);
		return refused?.kind === 'feature' ? refused : null;
	}
}
