/**
 * The AI plugin's flow assistant, and the catalog the flow plugin writes
 * for it. The catalog is Markdown, which the JSON client cannot read, so it
 * takes a `fetch` the way the YAML export does. The two assist calls are JSON
 * and take the authed client. A model answers in seconds, not the client's
 * fifteen, so both carry their own deadline.
 */

import type { HttpClient } from '@lyeve-labs/client';
import type { FlowDefinition } from '#lib/flow/types.ts';

const CATALOG_URL = '/api/admin/flows/catalog/llm';
const ASSIST_URL = '/api/admin/ai/assist/flow';

/** How long a draft or an answer may take before the request is abandoned. */
export const ASSIST_TIMEOUT_MS = 120_000;

/** One thing the validator refused in a draft. The node id is absent for a flow-level problem. */
export interface AssistProblem {
	node_id?: string;
	path: string;
	message: string;
}

export interface AssistUsage {
	model: string;
	tokens: number;
	/** US dollars as a decimal string, because the plugin keeps the price table's precision. */
	cost: string;
}

/**
 * The cost as a number, or null when it does not parse. An empty or
 * malformed string is null rather than zero, so a missing cost never reads
 * as a cost of zero. A number is null too, because the plugin never sends one.
 */
export function parseCost(cost: unknown): number | null {
	if (typeof cost !== 'string' || !/^\d+(\.\d+)?$/.test(cost.trim())) return null;
	return Number(cost);
}

/** What `POST /assist/flow` answers: the draft in both forms, and what the validator still refuses. */
export interface AssistDraft extends AssistUsage {
	definition: FlowDefinition | null;
	yaml: string;
	problems: AssistProblem[];
	conversation_id?: string;
}

export interface AssistAnswer extends AssistUsage {
	/** Markdown. */
	answer: string;
	conversation_id?: string;
}

export interface AssistRequest {
	prompt: string;
	catalog: string;
	current?: FlowDefinition;
	conversation_id?: string;
	format?: 'yaml' | 'json';
}

export interface ExplainRequest {
	catalog: string;
	definition: FlowDefinition;
	node_id?: string;
	problem?: AssistProblem;
	question?: string;
	conversation_id?: string;
}

/** A catalog read that was refused, with the status the caller branches on. */
export class CatalogError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = 'CatalogError';
		this.status = status;
	}
}

/** The node catalog written for a language model, as Markdown. */
export async function getLLMCatalog(fetchFn: typeof fetch, headers: Record<string, string> = {}): Promise<string> {
	const res = await fetchFn(CATALOG_URL, { headers: { ...headers, Accept: 'text/markdown' } });
	const text = await res.text();
	if (!res.ok) {
		let message = text;
		try {
			const json = JSON.parse(text) as { error?: string };
			message = json.error ?? text;
		} catch {
			// Not JSON: the text is the message.
		}
		throw new CatalogError(res.status, message);
	}
	return text;
}

export function assistFlow(client: HttpClient, body: AssistRequest): Promise<AssistDraft> {
	return client.post<AssistDraft>(ASSIST_URL, body, { signal: AbortSignal.timeout(ASSIST_TIMEOUT_MS) });
}

export function explainFlow(client: HttpClient, body: ExplainRequest): Promise<AssistAnswer> {
	return client.post<AssistAnswer>(`${ASSIST_URL}/explain`, body, { signal: AbortSignal.timeout(ASSIST_TIMEOUT_MS) });
}
