/**
 * The provider form read into the plugin's input, shared by create and edit.
 *
 * The rules the plugin enforces are stated here too, so the operator learns at
 * the form and not from a refused request: a kind from the list, a base URL
 * for the compatible kind, a key for the native kinds unless one is stored,
 * and allow_private only for a super admin.
 */

import { MODALITIES, PROVIDER_KINDS, isCompatibleKind, providerKindLabel, type AiProvider, type Modality, type ProviderInput, type ProviderKind } from '$lib/api/ai';

export type ProviderFormResult = { input: ProviderInput } | { error: string };

function str(data: FormData, key: string): string {
	return String(data.get(key) ?? '').trim();
}

function int(data: FormData, key: string, fallback: number): number | null {
	const raw = str(data, key);
	if (!raw) return fallback;
	const n = Number(raw);
	return Number.isInteger(n) ? n : null;
}

function isKind(k: string): k is ProviderKind {
	return (PROVIDER_KINDS as readonly string[]).includes(k);
}

export function readProviderForm(data: FormData, existing: AiProvider | null, superAdmin: boolean): ProviderFormResult {
	const name = str(data, 'name');
	const kind = str(data, 'kind');
	if (!name) return { error: 'Enter a name.' };
	if (!isKind(kind)) return { error: 'Choose a provider kind.' };

	const apiKey = String(data.get('api_key') ?? '');
	const baseUrl = str(data, 'base_url');
	if (isCompatibleKind(kind) && !baseUrl) return { error: `Enter a base URL. The ${providerKindLabel(kind)} kind needs one.` };
	if (!isCompatibleKind(kind) && !apiKey && !existing?.has_key) return { error: 'Enter an API key. This kind needs one.' };

	const allowPrivate = str(data, 'allow_private') === 'true';
	if (allowPrivate && !superAdmin) return { error: 'Only a super admin can allow a private address.' };

	const modalities = data.getAll('modalities').map(String).filter((m): m is Modality => (MODALITIES as readonly string[]).includes(m));
	if (modalities.length === 0) return { error: 'Choose at least one modality.' };

	const priority = int(data, 'priority', 100);
	if (priority === null || priority < -1000 || priority > 1000) return { error: 'Enter a priority from -1000 to 1000, as a whole number.' };
	const rpm = int(data, 'rate_limit_rpm', 0);
	if (rpm === null || rpm < 0) return { error: 'Enter the rate limit as whole requests per minute, or 0 for no limit.' };
	const budgetRaw = str(data, 'max_budget_usd');
	const budget = budgetRaw ? Number(budgetRaw) : 0;
	if (!Number.isFinite(budget) || budget < 0) return { error: 'Enter the monthly budget in dollars, or 0 for no budget.' };

	const input: ProviderInput = {
		name,
		kind,
		allow_private: allowPrivate,
		default_model: str(data, 'default_model'),
		enabled: str(data, 'enabled') !== 'false',
		priority,
		modalities,
		rate_limit_rpm: rpm,
		max_budget_usd: budget,
	};
	if (apiKey) input.api_key = apiKey;
	if (isCompatibleKind(kind)) {
		input.base_url = baseUrl;
		input.key_header = str(data, 'key_header');
		input.query_string = str(data, 'query_string');
		const preset = str(data, 'preset');
		if (preset && kind === 'openai_compatible') input.preset = preset;
	}
	return { input };
}
