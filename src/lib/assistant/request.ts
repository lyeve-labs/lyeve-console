/**
 * What the panel sends with a prompt: the page it is on and the form open
 * there, as the kit describes it. A field the kit withholds (a password, a
 * file, or a field marked No AI) goes with its label and kind only, so the
 * assistant knows it exists and never sees or fills its value.
 */

import type { AssistFieldDescription, FormAssistController } from '@lyeve-labs/ui-kit';
import { optionLabel } from './option-labels';

export interface AssistantField {
	name?: string;
	label: string;
	help?: string;
	kind: string;
	required?: boolean;
	options?: { value: string; label: string; disabled?: boolean }[];
	value?: unknown;
	withheld?: boolean;
	edited?: boolean;
}

export interface AssistantRequest {
	prompt: string;
	conversation_id?: string;
	page?: { path: string; title: string };
	form?: { label: string; fields: AssistantField[] };
}

/** The bounds the AI plugin refuses past. */
const PROMPT_MAX = 32 << 10;
const PAGE_MAX = 2048;
const FIELDS_MAX = 200;

function field(d: AssistFieldDescription): AssistantField {
	if (d.withheld) return { label: d.label, kind: d.kind, withheld: true };
	return {
		name: d.name,
		label: d.label,
		...(d.hint ? { help: d.hint } : {}),
		kind: d.kind,
		...(d.required ? { required: true } : {}),
		...(d.options ? { options: d.options.map((o) => ({ value: o.value, label: optionLabel(d.name, o), ...(o.disabled ? { disabled: true } : {}) })) } : {}),
		value: d.value,
		...(d.edited ? { edited: true } : {}),
	};
}

/** The open form as the request carries it. */
export function formContext(form: FormAssistController): AssistantRequest['form'] {
	return { label: form.label, fields: form.describe().slice(0, FIELDS_MAX).map(field) };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The request the console's route forwards, rebuilt from what the browser
 * sent, or null when it cannot be one. Only the keys above travel, so a
 * browser cannot pick the provider or add anything the panel does not send.
 */
export function readRequest(input: unknown): AssistantRequest | null {
	if (!isObject(input) || typeof input.prompt !== 'string') return null;
	const prompt = input.prompt.trim();
	if (prompt === '' || prompt.length > PROMPT_MAX) return null;
	const out: AssistantRequest = { prompt };
	if (typeof input.conversation_id === 'string' && /^[0-9a-f-]{36}$/i.test(input.conversation_id)) {
		out.conversation_id = input.conversation_id;
	}
	if (isObject(input.page) && typeof input.page.path === 'string') {
		out.page = { path: input.page.path.slice(0, PAGE_MAX), title: String(input.page.title ?? '').slice(0, PAGE_MAX) };
	}
	if (isObject(input.form) && typeof input.form.label === 'string' && Array.isArray(input.form.fields)) {
		const fields = input.form.fields.filter(isObject).slice(0, FIELDS_MAX).map((f): AssistantField => {
			if (f.withheld === true) return { label: String(f.label ?? ''), kind: String(f.kind ?? ''), withheld: true };
			return {
				...(typeof f.name === 'string' ? { name: f.name } : {}),
				label: String(f.label ?? ''),
				...(typeof f.help === 'string' ? { help: f.help } : {}),
				kind: String(f.kind ?? ''),
				...(f.required === true ? { required: true } : {}),
				...(Array.isArray(f.options) ? { options: f.options.filter(isObject).map((o) => ({ value: String(o.value ?? ''), label: String(o.label ?? ''), ...(o.disabled === true ? { disabled: true } : {}) })) } : {}),
				...('value' in f ? { value: f.value } : {}),
				...(f.edited === true ? { edited: true } : {}),
			};
		});
		out.form = { label: input.form.label, fields };
	}
	return out;
}
