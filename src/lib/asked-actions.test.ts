import { readFileSync, existsSync, globSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * A form that asks first in its enhance handler asks only once the page has
 * hydrated. A click before that, or with scripts off, posts natively with no
 * question, so the action it reaches has to refuse a post that carries no
 * answer, which `asked()` does. This reads every component, finds each form
 * whose enhance handler asks, through `confirmed()` or through the kit's
 * `confirm` directly, follows its `action` to the server action it reaches,
 * and fails when that action is not wrapped.
 *
 * A form's handler asks when its `use:enhance` expression makes the call
 * itself or names a function or const of the same component whose own text
 * makes it. A name counts for the kit's `confirm` only when it is typed
 * `SubmitFunction`, because a click handler that asks and then submits a
 * form of its own posts nothing before the page hydrates. A relative action
 * resolves against every page that draws the component, followed through the
 * components that import it.
 */

/** The index just past the bracket closing the one at `open`, stepping over strings and comments. */
function closeOf(src: string, open: number): number {
	const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
	const stack: string[] = [];
	let i = open;
	while (i < src.length) {
		const c = src[i];
		if (c === "'" || c === '"') {
			i = src.indexOf(c, i + 1) + 1;
			while (src[i - 2] === '\\') i = src.indexOf(c, i) + 1;
			if (stack.length === 0) return i;
			continue;
		}
		if (c === '`') {
			i++;
			while (src[i] !== '`') {
				if (src[i] === '\\') i += 2;
				else if (src.startsWith('${', i)) i = closeOf(src, i + 1);
				else i++;
			}
			i++;
			if (stack.length === 0) return i;
			continue;
		}
		if (src.startsWith('//', i)) {
			i = src.indexOf('\n', i);
			continue;
		}
		if (src.startsWith('/*', i)) {
			i = src.indexOf('*/', i) + 2;
			continue;
		}
		if (c in pairs) stack.push(pairs[c]);
		else if (c === ')' || c === ']' || c === '}') {
			stack.pop();
			if (stack.length === 0) return i + 1;
		}
		i++;
	}
	throw new Error(`unbalanced bracket at ${open}`);
}

/** A call of the kit's `confirm` under the name a component imports it as, or null when it does not. */
type Asking = { kit: RegExp | null };

const NO_KIT: Asking = { kit: null };

function askingOf(src: string): Asking {
	for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@lyeve-labs\/ui-kit['"]/g)) {
		const named = /(?:^|,)\s*confirm(?:\s+as\s+(\w+))?\s*(?:,|$)/.exec(m[1]);
		if (named) return { kit: new RegExp(`(?<![\\w.$])${named[1] ?? 'confirm'}\\(`) };
	}
	return NO_KIT;
}

/** Whether a piece of a component asks, through `confirmed(` anywhere or the kit's confirm where it may count. */
function calls(text: string, how: Asking, kitCounts: boolean): boolean {
	return text.includes('confirmed(') || (kitCounts && how.kit !== null && how.kit.test(text));
}

/** The names in a component's script whose function body or const value asks, each with that text. */
function askingNames(src: string, how: Asking): Map<string, string> {
	const names = new Map<string, string>();
	for (const m of src.matchAll(/^\t(?:async\s+)?function\s+(\w+)\s*\(/gm)) {
		const params = closeOf(src, m.index + m[0].length - 1);
		const body = src.indexOf('{', params);
		const submits = /^\s*:\s*SubmitFunction\b/.test(src.slice(params, body));
		const text = src.slice(body, closeOf(src, body));
		if (calls(text, how, submits)) names.set(m[1], text);
	}
	for (const m of src.matchAll(/^\t(?:const|let)\s+(\w+)\s*(?::\s*([\w<>[\]]+)\s*)?=/gm)) {
		// A value runs to the semicolon that ends its statement.
		let i = m.index + m[0].length;
		while (i < src.length && src[i] !== ';') i = '([{`\'"'.includes(src[i]) ? closeOf(src, i) : i + 1;
		const text = src.slice(m.index, i);
		if (calls(text, how, m[2] === 'SubmitFunction')) names.set(m[1], text);
	}
	return names;
}

type Form = { file: string; action: string | null; enhance: string };

/** Every form in a component with its action and its enhance expression. */
function formsOf(file: string, src: string): Form[] {
	const forms: Form[] = [];
	for (const m of src.matchAll(/<form\b/g)) {
		let i = m.index + m[0].length;
		let action: string | null = null;
		let enhance = '';
		while (src[i] !== '>') {
			if (src[i] === '{') {
				i = closeOf(src, i);
				continue;
			}
			const attr = /^(action|use:enhance)=("[^"]*"|\{)/.exec(src.slice(i));
			if (!attr) {
				i++;
				continue;
			}
			const start = i + attr[1].length + 1;
			const end = attr[2] === '{' ? closeOf(src, start) : start + attr[2].length;
			const value = src.slice(start, end);
			if (attr[1] === 'action') action = value.startsWith('"') ? value.slice(1, -1) : null;
			else enhance = value.slice(1, -1);
			i = end;
		}
		if (enhance) forms.push({ file, action, enhance });
	}
	return forms;
}

/** Whether a form's handler asks. */
function asks(form: Form, names: Map<string, string>, how: Asking): boolean {
	if (calls(form.enhance, how, true)) return true;
	const head = /^\s*(\w+)/.exec(form.enhance);
	return head !== null && names.has(head[1]);
}

const components = globSync('src/**/*.svelte').filter((f) => !f.endsWith('.test.svelte')).sort();

/** Each component and the components that import it. */
function importers(): Map<string, string[]> {
	const by = new Map<string, string[]>();
	for (const file of components) {
		const src = readFileSync(file, 'utf8');
		for (const m of src.matchAll(/from\s+'([^']+\.svelte)'/g)) {
			const target = m[1].startsWith('$lib/') ? join('src/lib', m[1].slice(5)) : normalize(join(dirname(file), m[1]));
			by.set(target, [...(by.get(target) ?? []), file]);
		}
	}
	return by;
}

/** The pages that draw a component, itself when it is one. */
function pagesOf(file: string, by: Map<string, string[]>, seen = new Set<string>()): string[] {
	if (file.endsWith('/+page.svelte')) return [file];
	if (seen.has(file)) return [];
	seen.add(file);
	return (by.get(file) ?? []).flatMap((importer) => pagesOf(importer, by, seen));
}

/** The server file and action name a form posts to from a page, or null when the action is not static. */
function target(page: string, action: string): { server: string; name: string } | null {
	const m = /^(.*)\?\/([\w-]+)$/.exec(action);
	if (!m) return null;
	if (m[1] === '') return { server: join(dirname(page), '+page.server.ts'), name: m[2] };
	// A path names a route, whose folders may sit inside groups.
	const server = globSync('src/routes/**/+page.server.ts').find(
		(f) => dirname(f).replace(/^src\/routes/, '').replace(/\/\([^)]+\)/g, '') === m[1],
	);
	return server ? { server, name: m[2] } : null;
}

/** Whether a server file's action is wrapped in `asked()`. */
function wrapped(server: string, name: string): boolean {
	if (!existsSync(server)) return false;
	const at = new RegExp(`^\\t(['"]?)${name}\\1:\\s*asked\\(`, 'm');
	return at.test(readFileSync(server, 'utf8'));
}

type Finding = {
	asking: Form[];
	direct: Form[];
	unset: string[];
	unwrapped: string[];
	unmapped: string[];
	unused: string[];
};

function survey(): Finding {
	const by = importers();
	const out: Finding = { asking: [], direct: [], unset: [], unwrapped: [], unmapped: [], unused: [] };
	for (const file of components) {
		const src = readFileSync(file, 'utf8');
		const how = askingOf(src);
		if (!calls(src, how, true)) continue;
		const names = askingNames(src, how);
		const plain = askingNames(src, NO_KIT);
		const forms = formsOf(file, src).filter((f) => asks(f, names, how));
		// Every asking name reaches a form, or the reading above missed one.
		for (const name of names.keys()) {
			if (!forms.some((f) => new RegExp(`^\\s*${name}\\b`).test(f.enhance))) out.unused.push(`${file}: ${name}`);
		}
		for (const form of forms) {
			out.asking.push(form);
			if (!asks(form, plain, NO_KIT)) {
				out.direct.push(form);
				// confirmed() sets the field itself. A handler that asks through the
				// kit has to set it by hand, or a yes posts what the action refuses.
				const head = /^\s*(\w+)/.exec(form.enhance);
				const handler = (head && names.get(head[1])) ?? form.enhance;
				if (!handler.includes('CONFIRM_FIELD')) out.unset.push(`${file}: ${form.action ?? 'a computed action'}`);
			}
			const pages = pagesOf(file, by);
			if (form.action === null || pages.length === 0) {
				out.unmapped.push(`${file}: ${form.action ?? 'a computed action'}`);
				continue;
			}
			for (const page of pages) {
				const to = target(page, form.action);
				if (!to) out.unmapped.push(`${file}: ${form.action} from ${page}`);
				else if (!wrapped(to.server, to.name)) out.unwrapped.push(`${to.server}: ${to.name} (posted from ${file})`);
			}
		}
	}
	return out;
}

describe('writes that ask first', () => {
	const found = survey();

	it('finds the forms that ask through confirmed()', () => {
		expect(found.asking.length).toBeGreaterThan(50);
	});

	it('finds the forms that ask through the kit directly', () => {
		expect(found.direct.length).toBeGreaterThanOrEqual(14);
	});

	it('sets the confirmation in every handler that asks through the kit directly', () => {
		expect(found.unset).toEqual([]);
	});

	it('maps every asking form to a static action', () => {
		expect(found.unmapped).toEqual([]);
		expect(found.unused).toEqual([]);
	});

	it('wraps every action an asking form posts to in asked()', () => {
		expect(found.unwrapped).toEqual([]);
	});
});
