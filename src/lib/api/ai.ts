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
	/** Whether signed-in people may ask the assistant. Absent from a plugin older than the switch, and on by default. */
	assistant_enabled?: boolean;
	/** The transcript window the hourly cleanup applies. Absent from a plugin older than the free tier. */
	transcript_retention?: TranscriptRetention;
	updated_by?: string;
	updated_at: string;
}

/** The transcript window as the settings answer reports it. */
export interface TranscriptRetention {
	/** A duration such as 720h. */
	value: string;
	/** `free_tier` while the free tier fixes the window, `config` while the engine's configuration sets it. */
	source: string;
	editable: boolean;
	reason?: string;
}

/** The capability that lifts the AI free tier's ceilings. */
export const AI_PRO = 'ai-pro';

/** The cap a provider create past the free tier's ceiling is refused under. */
export const PROVIDERS_CAP = 'ai.providers';

/**
 * How many providers a tenant holds on the free tier. The provider list
 * states the ceiling itself, so this is read only for a plugin older than
 * that answer.
 */
export const FREE_PROVIDERS = 1;

/** The provider ceiling as the list answers it. */
export interface ProviderCeiling {
	/** How many providers the tenant may hold, 0 meaning no limit. */
	limit: number;
	/** The link that lifts the ceiling, empty when the answer carries none. */
	upgradeUrl: string;
}

/**
 * Whether this tenant is on the AI free tier, from what the engine reports.
 * A plugin that knows the free tier reports the transcript window, and while
 * the engine holds no AI license that window's source is the free tier. An
 * engine that holds the license and withholds it from this tenant says so in
 * the entitlements. A plugin older than the free tier reports no window, so
 * an engine that gates AI as a whole reads as no free tier at all.
 */
export function aiFreeTier(settings: AiSettings | null | undefined, withheld: readonly string[] | null | undefined): boolean {
	const retention = settings?.transcript_retention;
	if (!retention) return false;
	return retention.source === 'free_tier' || (withheld ?? []).includes(AI_PRO);
}

/**
 * A retention window in days, such as "30 days" for 720h, or the duration as
 * written when it is not a whole number of days.
 */
export function retentionDays(value: string): string {
	const m = /^(\d+)h$/.exec(value.trim());
	if (!m) return value;
	const hours = Number(m[1]);
	if (hours % 24 !== 0) return value;
	const days = hours / 24;
	return `${days} ${days === 1 ? 'day' : 'days'}`;
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
	body: { enabled?: boolean; transcripts_enabled?: boolean; assistant_enabled?: boolean }
): Promise<AiSettings> {
	return client.put<AiSettings>(`${BASE}/settings`, body);
}

/** A page of providers, with the ceiling when the plugin states one. */
export interface ProviderPage extends Page<AiProvider> {
	/** Null from a plugin older than the ceiling in the list answer. */
	ceiling: ProviderCeiling | null;
}

export async function listProviders(
	client: HttpClient,
	params: { limit?: number; offset?: number } = {}
): Promise<ProviderPage> {
	const res = await client.get<(ListEnvelope<AiProvider> & { provider_limit?: unknown; upgrade_url?: unknown }) | AiProvider[]>(
		`${BASE}/providers${query(params)}`,
	);
	const stated = Array.isArray(res) ? undefined : res?.provider_limit;
	const ceiling =
		typeof stated === 'number' && Number.isInteger(stated) && stated >= 0
			? { limit: stated, upgradeUrl: !Array.isArray(res) && typeof res?.upgrade_url === 'string' ? res.upgrade_url : '' }
			: null;
	return { rows: rowsOf(res), total: statedTotal(res), ceiling };
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
