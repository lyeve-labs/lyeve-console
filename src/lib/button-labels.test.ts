import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * One vocabulary for the buttons that write. The header action reads
 * "New <noun>", the drawer's primary reads "Create" on a new row and "Save"
 * on an existing one, the secondary reads "Cancel" and the destructive one
 * reads "Delete". One set of words reads as one product, so the same gesture
 * never reads two ways on pages one click apart. A label that opens a repeating row inside a form ("Add header",
 * "Add field") is not a write and is not covered.
 */
const FORBIDDEN: RegExp[] = [
	/^Update$/,
	/^Add$/,
	/^Submit$/,
	/^Created$/,
	/^Remove$/,
	/^Save changes$/,
	/^Generate Key$/i,
	/^Create (a |first |new )?\S/i,
	/^Add a\b/,
	/^Add (role|provider|webhook|variable|price|tenant|user|key|job|entry|first entry|flow|datasource|schema)$/i,
];

/**
 * The text a Button renders, with tags taken out. An expression beside words
 * stays as `{}`, so "Add {noun}" is not read as a bare "Add", and a label that
 * is only an expression reads as nothing.
 */
function labelOf(inner: string): string {
	const label = inner
		.replace(/<[^>]+>/g, ' ')
		.replace(/\{[^}]*\}/g, ' {} ')
		.replace(/\s+/g, ' ')
		.trim();
	return label.replace(/\{\}/g, '').trim() === '' ? '' : label;
}

/*
 * A Button's opening tag, read through its attributes. An expression in an
 * attribute can hold a `>`, as an arrow function does, so each `{...}` is
 * stepped over whole, one level of nested braces included, rather than read as
 * the end of the tag.
 */
const BUTTON = /<Button\b(?:[^>{]|\{(?:[^{}]|\{[^{}]*\})*\})*>([\s\S]*?)<\/Button>/g;

/*
 * Refused labels that stand until their component's next change, each named
 * by file and label so a new one still fails. The flow editor's map field adds
 * a key row beside a "New key" field, and reads "Add" where the vocabulary
 * asks for "Add key".
 */
const STANDING = new Set(['src/lib/components/flow/NodeConfigForm.svelte: "Add"']);

/** The label of every Button in a component's source. */
function buttonLabels(src: string): string[] {
	return [...src.matchAll(BUTTON)].map((match) => labelOf(match[1]));
}

function offenders(): string[] {
	const out: string[] = [];
	// The signed-out pages are a card outside the shell and name the one thing
	// they do. The vocabulary is the admin's.
	for (const file of globSync('src/**/*.svelte').sort()) {
		if (file.endsWith('.test.svelte') || /^src\/routes\/(login|setup)\//.test(file)) continue;
		const src = readFileSync(file, 'utf8');
		for (const label of buttonLabels(src)) {
			const at = `${file}: "${label}"`;
			if (label && FORBIDDEN.some((re) => re.test(label)) && !STANDING.has(at)) out.push(at);
		}
	}
	return out;
}

describe('button vocabulary', () => {
	it('uses New, Create, Save, Cancel and Delete, and none of the refused labels', () => {
		expect(offenders()).toEqual([]);
	});

	it('reads the label through the icon and the expression around it', () => {
		expect(labelOf('<Plus size={14} /> New user')).toBe('New user');
		expect(labelOf("{editing ? 'Save' : 'Create'}")).toBe('');
	});

	it('reads a label past an arrow function in the opening tag', () => {
		expect(buttonLabels('<Button variant="secondary" onclick={() => (open = true)}>Add</Button>')).toEqual(['Add']);
		expect(buttonLabels('<Button onclick={() => { open = true; }}>Add</Button>')).toEqual(['Add']);
	});
});
