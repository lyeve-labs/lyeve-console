/**
 * The AI plugin's admin routes: providers, prompts, prices, transcripts, the
 * tenant switch and the dashboard.
 *
 * Every call takes the authenticated client, where the session bearer and the
 * CSRF header are joined. The export is the one route that answers a file
 * rather than JSON, so it is served by a server route of its own and is not
 * wrapped here.
 */

import type { HttpClient } from '@lyeve-labs/client';
import { query, rowsOf, statedTotal, type ListEnvelope } from '$lib/api/list';
import type { Gate } from '$lib/api/gate';

export const PROVIDER_KINDS = ['openai', 'anthropic', 'openai_compatible', 'anthropic_compatible'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const MODALITIES = ['text', 'embed', 'image'] as const;
export type Modality = (typeof MODALITIES)[number];

/** A kind that names a wire format rather than a vendor: it takes a base URL and may run keyless. */
export function isCompatibleKind(kind: string): boolean {
	return kind === 'openai_compatible' || kind === 'anthropic_compatible';
}

/**
 * Presets of the openai_compatible kind. A preset fills the base URL and the
 * key header in the form. The row it produces is openai_compatible and nothing
 * downstream knows the name. Azure has no fixed host, so it fills only the
 * header and the query string.
 */
export const PRESETS: { id: string; label: string; base_url: string; key_header: string; query_string: string }[] = [
	{ id: 'ollama', label: 'Ollama', base_url: 'http://localhost:11434/v1', key_header: '', query_string: '' },
	{ id: 'vllm', label: 'vLLM', base_url: 'http://localhost:8000/v1', key_header: '', query_string: '' },
	{ id: 'lm_studio', label: 'LM Studio', base_url: 'http://localhost:1234/v1', key_header: '', query_string: '' },
	{ id: 'openrouter', label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', key_header: '', query_string: '' },
	{ id: 'groq', label: 'Groq', base_url: 'https://api.groq.com/openai/v1', key_header: '', query_string: '' },
	{ id: 'deepseek', label: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', key_header: '', query_string: '' },
	{ id: 'gemini', label: 'Gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', key_header: '', query_string: '' },
	{ id: 'azure', label: 'Azure OpenAI', base_url: '', key_header: 'api-key', query_string: 'api-version=2024-10-21' },
];

export function providerKindLabel(kind: string): string {
	switch (kind) {
		case 'openai':
			return 'OpenAI';
		case 'anthropic':
			return 'Anthropic';
		case 'openai_compatible':
			return 'OpenAI-compatible';
		case 'anthropic_compatible':
			return 'Anthropic-compatible';
		default:
			return kind;
	}
}

/** One sentence per kind, so the four read as a list that fits a phone. */
export function providerKindDescription(kind: string): string {
	switch (kind) {
		case 'openai':
			return 'The OpenAI API.';
		case 'anthropic':
			return 'The Anthropic API.';
		case 'openai_compatible':
			return 'Any server that speaks the OpenAI API, such as Ollama or vLLM.';
		case 'anthropic_compatible':
			return 'A gateway that speaks the Anthropic API.';
		default:
			return '';
	}
}

export interface AiSettings {
	tenant_id: string;
	enabled: boolean;
	transcripts_enabled: boolean;
	updated_by?: string;
	updated_at: string;
}

export interface AiProvider {
	id: string;
	name: string;
	kind: ProviderKind;
	has_key: boolean;
	needs_key: boolean;
	base_url: string;
	key_header: string;
	query_string: string;
	allow_private: boolean;
	default_model: string;
	config_json?: string;
	enabled: boolean;
	priority: number;
	modalities: Modality[];
	rate_limit_rpm: number;
	max_budget_usd: number;
	created_at: string;
	updated_at: string;
}

/** What create and update accept. A blank key on update keeps the stored one. */
export interface ProviderInput {
	name: string;
	kind: ProviderKind;
	preset?: string;
	api_key?: string;
	base_url?: string;
	key_header?: string;
	query_string?: string;
	allow_private: boolean;
	default_model?: string;
	enabled: boolean;
	priority: number;
	modalities: Modality[];
	rate_limit_rpm?: number;
	max_budget_usd?: number;
}

export interface ModelCapabilities {
	model: string;
	kind: ProviderKind;
	max_tokens: number;
	text: boolean;
	embed: boolean;
	image: boolean;
	vision: boolean;
}

export interface AiPromptVersion {
	id: string;
	use_case: string;
	version: number;
	body: string;
	created_by?: string;
	created_at: string;
}

/** One use case: the shipped default is version 0 and never a row. */
export interface PromptView {
	use_case: string;
	default: string;
	active_version: number;
	active: string;
	guardrail: string;
	versions: AiPromptVersion[];
}

export interface ModelPrice {
	kind: ProviderKind;
	model: string;
	input_per_1k: number;
	output_per_1k: number;
	image_per_call: number;
	updated_at: string;
}

export type TranscriptKind = 'assistant' | 'flow_assistant' | 'node' | 'route';
export const TRANSCRIPT_KINDS: TranscriptKind[] = ['assistant', 'flow_assistant', 'node', 'route'];

export interface TranscriptMessage {
	id: string;
	transcript_id: string;
	seq: number;
	role: string;
	content: string;
	tokens_in: number;
	tokens_out: number;
	latency_ms: number;
	cost_estimate: string;
	created_at: string;
}

export interface Transcript {
	id: string;
	kind: TranscriptKind;
	subject_kind?: string;
	subject_id?: string;
	caller?: string;
	provider_id?: string;
	model: string;
	prompt_use_case?: string;
	prompt_version: number;
	created_by?: string;
	created_at: string;
	updated_at: string;
	recap?: string;
	message_count: number;
	messages?: TranscriptMessage[];
}

export interface RecapResult {
	id: string;
	recap: string;
	model: string;
	tokens_in: number;
	tokens_out: number;
	cost_estimate: string;
}

export interface AiDashboard {
	total_calls: number;
	total_cost: string;
	avg_latency_ms: number;
	enabled_providers: number;
	total_providers: number;
}

/**
 * What a read of the plugin answered, sorted for the page: a shared gate, the
 * tenant's switch turned off, or no provider to answer through. Lives here
 * rather than beside the sorter because a page passes it to a component. An
 * absent gate is the plugin not mounted, which only the settings read, the
 * one the tenant switch leaves open, can tell.
 */
export type AiGate = Gate | { state: 'off' } | { state: 'no_provider' };

/**
 * The gate a page renders under: the layout's word when the settings read
 * was refused, since it alone can tell a switch that is off from a plugin
 * that is not there, and the page's own otherwise.
 */
export function effectiveGate(pageGate: AiGate, layoutGate: AiGate): AiGate {
	return layoutGate.state === 'ok' ? pageGate : layoutGate;
}

export interface Page<T> {
	rows: T[];
	total: number | null;
}

const BASE = '/api/admin/ai';

export function getAiSettings(client: HttpClient): Promise<AiSettings> {
	return client.get<AiSettings>(`${BASE}/settings`);
}

export function putAiSettings(
	client: HttpClient,
	body: { enabled?: boolean; transcripts_enabled?: boolean }
): Promise<AiSettings> {
	return client.put<AiSettings>(`${BASE}/settings`, body);
}

export async function listProviders(
	client: HttpClient,
	params: { limit?: number; offset?: number } = {}
): Promise<Page<AiProvider>> {
	const res = await client.get<ListEnvelope<AiProvider> | AiProvider[]>(`${BASE}/providers${query(params)}`);
	return { rows: rowsOf(res), total: statedTotal(res) };
}

export function getProvider(client: HttpClient, id: string): Promise<AiProvider> {
	return client.get<AiProvider>(`${BASE}/providers/${encodeURIComponent(id)}`);
}

export function createProvider(client: HttpClient, body: ProviderInput): Promise<AiProvider> {
	return client.post<AiProvider>(`${BASE}/providers`, body);
}

export function updateProvider(client: HttpClient, id: string, body: ProviderInput): Promise<AiProvider> {
	return client.put<AiProvider>(`${BASE}/providers/${encodeURIComponent(id)}`, body);
}

export async function deleteProvider(client: HttpClient, id: string): Promise<void> {
	await client.delete<void>(`${BASE}/providers/${encodeURIComponent(id)}`);
}

export async function listModels(client: HttpClient, id: string): Promise<string[]> {
	const res = await client.get<{ models: string[] }>(`${BASE}/providers/${encodeURIComponent(id)}/models`);
	return res.models ?? [];
}

export function getCapabilities(client: HttpClient, id: string, model?: string): Promise<ModelCapabilities> {
	return client.get<ModelCapabilities>(`${BASE}/providers/${encodeURIComponent(id)}/capabilities${query({ model })}`);
}

export async function listPrompts(client: HttpClient): Promise<PromptView[]> {
	const res = await client.get<{ prompts: PromptView[] }>(`${BASE}/prompts`);
	return res.prompts ?? [];
}

export function getPrompt(client: HttpClient, useCase: string): Promise<PromptView> {
	return client.get<PromptView>(`${BASE}/prompts/${encodeURIComponent(useCase)}`);
}

/** Every save is a new version, which is the one in force from then on. */
export function savePromptVersion(client: HttpClient, useCase: string, body: string): Promise<AiPromptVersion> {
	return client.post<AiPromptVersion>(`${BASE}/prompts/${encodeURIComponent(useCase)}`, { body });
}

export async function listPrices(client: HttpClient): Promise<ModelPrice[]> {
	const res = await client.get<{ prices: ModelPrice[] }>(`${BASE}/prices`);
	return res.prices ?? [];
}

export function putPrice(
	client: HttpClient,
	kind: string,
	model: string,
	body: { input_per_1k: number; output_per_1k: number; image_per_call: number }
): Promise<ModelPrice> {
	return client.put<ModelPrice>(`${BASE}/prices/${encodeURIComponent(kind)}/${encodeURIComponent(model)}`, body);
}

export async function deletePrice(client: HttpClient, kind: string, model: string): Promise<void> {
	await client.delete<void>(`${BASE}/prices/${encodeURIComponent(kind)}/${encodeURIComponent(model)}`);
}

export async function listTranscripts(
	client: HttpClient,
	params: { limit?: number; offset?: number; kind?: string; subject_kind?: string; subject_id?: string } = {}
): Promise<Page<Transcript>> {
	const res = await client.get<ListEnvelope<Transcript> | Transcript[]>(`${BASE}/transcripts${query(params)}`);
	return { rows: rowsOf(res), total: statedTotal(res) };
}

export function getTranscript(client: HttpClient, id: string): Promise<Transcript> {
	return client.get<Transcript>(`${BASE}/transcripts/${encodeURIComponent(id)}`);
}

export function recapTranscript(client: HttpClient, id: string): Promise<RecapResult> {
	return client.post<RecapResult>(`${BASE}/transcripts/${encodeURIComponent(id)}/recap`, undefined);
}

/** The path the export server route forwards to. */
export function transcriptExportPath(id: string, format: 'json' | 'markdown'): string {
	return `${BASE}/transcripts/${encodeURIComponent(id)}/export?format=${format}`;
}

export function getAiDashboard(client: HttpClient): Promise<AiDashboard> {
	return client.get<AiDashboard>(`${BASE}/dashboard`);
}

/** Tokens and cost over a transcript's messages, which the list row does not carry. */
export function transcriptTotals(messages: TranscriptMessage[] | undefined): {
	tokens_in: number;
	tokens_out: number;
	cost: number;
} {
	let tokens_in = 0;
	let tokens_out = 0;
	let cost = 0;
	for (const m of messages ?? []) {
		tokens_in += m.tokens_in;
		tokens_out += m.tokens_out;
		cost += Number(m.cost_estimate) || 0;
	}
	return { tokens_in, tokens_out, cost };
}
