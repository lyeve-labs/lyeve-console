/**
 * The schema plugin's configuration sync.
 *
 * One bundle carries an instance's configuration: content types, flows,
 * permission rules, webhooks and the portable settings. It carries no
 * content. Export writes the bundle, diff plans it against this instance, and
 * apply makes this instance match it, or with `dry_run` answers the plan.
 *
 * Every secret in a bundle is sealed with a passphrase the operator chooses
 * at export, and the same passphrase opens it on the target. All three routes
 * are the super admin's, from a signed-in session only.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import { ApiError, type HttpClient } from '@lyeve-labs/client';

const CONFIG_SYNC_URL = '/api/admin/config-sync';

/** The engine refuses a shorter passphrase, so the form does too. */
export const MIN_PASSPHRASE = 12;

/** The name a bundle carries, so a file of another kind is refused by name. */
export const BUNDLE_FORMAT = 'lyeve-config';

export type ConfigAction = 'create' | 'update' | 'delete' | 'unchanged';

export interface ConfigChange {
	key: string;
	action: ConfigAction;
	/** The fields an update changes, when the section names them. */
	fields?: string[];
	note?: string;
}

export interface ConfigProblem {
	key?: string;
	message: string;
	/** The capability the problem names, when the engine sent one. */
	feature?: string;
}

export interface SectionPlan {
	changes: ConfigChange[];
	problems?: ConfigProblem[];
	/** The statements each content type would run. Content types only. */
	ddl?: Record<string, string[]>;
}

export interface SyncPlan {
	sections: Record<string, SectionPlan>;
	/** Every change that is not `unchanged`. */
	changes: number;
	problems: number;
}

export interface SyncFailure {
	section: string;
	key?: string;
	message: string;
}

export interface ApplyResult {
	applied: boolean;
	dry_run?: boolean;
	plan: SyncPlan;
	/** Content types written. Each one commits as it is written, so these stay applied after a failure. */
	schemas_applied?: string[];
	sections_applied?: string[];
	/** Sections a failure left unwritten. */
	not_applied?: string[];
	failed?: SyncFailure;
}

/** A bundle as the engine wrote it. The sections are the owners' own JSON. */
export interface ConfigBundle {
	format: string;
	version: number;
	source?: string;
	exported_at?: string;
	sections: Record<string, unknown>;
	[key: string]: unknown;
}

export interface SyncRequest {
	passphrase: string;
	bundle: ConfigBundle;
	prune: boolean;
}

/** What each section is, in the words the page uses. */
export const SECTION_LABELS: Readonly<Record<string, string>> = {
	schemas: 'Content types',
	flows: 'Flows',
	permissions: 'Permission rules',
	webhooks: 'Webhooks',
	settings: 'Settings',
};

export function sectionLabel(name: string): string {
	return SECTION_LABELS[name] ?? name;
}

/** Content types first, because they apply first, then the rest by name. */
export function sectionOrder(names: readonly string[]): string[] {
	return [...names].sort((a, b) => {
		if (a === b) return 0;
		if (a === 'schemas') return -1;
		if (b === 'schemas') return 1;
		return a.localeCompare(b);
	});
}

export const ACTION_LABELS: Readonly<Record<ConfigAction, string>> = {
	create: 'Create',
	update: 'Update',
	delete: 'Delete',
	unchanged: 'Unchanged',
};

export function actionTone(a: ConfigAction): StatusTone {
	switch (a) {
		case 'create':
			return 'success';
		case 'update':
			return 'brand';
		case 'delete':
			return 'danger';
		default:
			return 'neutral';
	}
}

/** How many of each action a section plans. */
export function actionCounts(section: SectionPlan): Record<ConfigAction, number> {
	const out: Record<ConfigAction, number> = { create: 0, update: 0, delete: 0, unchanged: 0 };
	for (const c of section.changes ?? []) {
		if (c.action in out) out[c.action] += 1;
	}
	return out;
}

/**
 * Reads an uploaded file as a bundle. Answers the bundle, or the sentence
 * the operator reads when the file is not one. The engine checks the same
 * things again: this only spares a round trip for a file that is plainly
 * something else.
 */
export function parseBundle(text: string): { bundle: ConfigBundle } | { error: string } {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { error: 'The file is not JSON. Choose a bundle you downloaded from an export.' };
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return { error: 'The file is not a configuration bundle.' };
	}
	const b = raw as Partial<ConfigBundle>;
	if (b.format !== BUNDLE_FORMAT) {
		return { error: 'The file is not a configuration bundle. To import a content type export, use the Schema builder.' };
	}
	if (!b.sections || typeof b.sections !== 'object') {
		return { error: 'The bundle has no sections.' };
	}
	return { bundle: raw as ConfigBundle };
}

export function exportConfig(client: HttpClient, passphrase: string): Promise<ConfigBundle> {
	return client.post<ConfigBundle>(`${CONFIG_SYNC_URL}/export`, { passphrase });
}

export function diffConfig(client: HttpClient, req: SyncRequest): Promise<SyncPlan> {
	return client.post<SyncPlan>(`${CONFIG_SYNC_URL}/diff`, req);
}

export function applyConfig(client: HttpClient, req: SyncRequest, dryRun: boolean): Promise<ApplyResult> {
	return client.post<ApplyResult>(`${CONFIG_SYNC_URL}/apply`, { ...req, dry_run: dryRun });
}

/**
 * The apply answer a refused or failed apply carried. A plan with problems
 * answers 422 and a failure part way answers 409 or 503, each with the same
 * body a success has, so the page can say what was planned and what applied.
 * A refusal of the request itself (a wrong passphrase, a bundle of a later
 * version) carries only a sentence, and this answers null for it.
 */
export function applyResultOf(err: unknown): ApplyResult | null {
	if (!(err instanceof ApiError)) return null;
	const body = err.body as Partial<ApplyResult> | undefined;
	if (!body || typeof body !== 'object' || !body.plan || typeof body.plan !== 'object') return null;
	return body as ApplyResult;
}
