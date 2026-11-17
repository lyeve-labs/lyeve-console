import type { LocalePreferences } from '#lib/api/localization.ts';

/** A BCP 47 shape the plugin's fallback logic can split: `fr`, `fr-CA`, `zh-Hant-TW`. */
export const LOCALE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function strings(raw: FormDataEntryValue | null): string[] {
	try {
		const parsed = JSON.parse(String(raw ?? '[]'));
		return Array.isArray(parsed) ? parsed.map((v) => String(v).trim()).filter(Boolean) : [];
	} catch {
		return [];
	}
}

/**
 * What the Locales form sends, checked before it reaches the plugin: the
 * plugin validates lengths and nothing else, so a chain naming a locale
 * nobody enabled would be stored and then never resolve.
 */
export function parsePreferences(form: FormData): { prefs: LocalePreferences } | { error: string } {
	const default_locale = String(form.get('default_locale') ?? '').trim();
	if (!default_locale) return { error: 'Choose a default locale, the language your source fields are written in.' };
	const enabled = [...new Set([default_locale, ...strings(form.get('enabled_locales'))])];
	const bad = enabled.find((l) => !LOCALE_CODE.test(l));
	if (bad) return { error: `"${bad}" is not a locale code. Use a language tag such as fr or pt-BR.` };
	const chain = [...new Set(strings(form.get('fallback_chain')))];
	const unknown = chain.find((l) => !enabled.includes(l));
	if (unknown) return { error: `The fallback chain includes ${unknown}, which is not an enabled locale.` };
	return { prefs: { default_locale, enabled_locales: enabled, fallback_chain: chain } };
}
