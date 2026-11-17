import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Where the console's typefaces come from.
 *
 * A font loaded from a hosted font service sends every visitor's address and
 * browser to that service on every page, on every install. The console serves
 * Inter and JetBrains Mono from its own build instead, so the page shell may
 * name no font origin and the policy may allow none.
 */
const root = process.cwd();
const appHtml = readFileSync(resolve(root, 'src/app.html'), 'utf8');
const appCss = readFileSync(resolve(root, 'src/app.css'), 'utf8');
// Read as text: importing the config would put it under the type check, which
// types each directive as a list of CSP source keywords.
const viteConfig = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');

function directive(name: string): string {
	const found = viteConfig.match(new RegExp(`'${name}': \\[([^\\]]*)\\]`));
	if (!found) throw new Error(`vite.config.ts sets no ${name}`);
	return found[1];
}

const FONT_HOSTS = /fonts\.googleapis\.com|fonts\.gstatic\.com/;

describe('console fonts', () => {
	it('loads no stylesheet or connection from another origin in the page shell', () => {
		expect(appHtml).not.toMatch(FONT_HOSTS);
		expect(appHtml).not.toMatch(/<link[^>]+href="https?:\/\//);
	});

	it('allows fonts and stylesheets from no font service', () => {
		expect(directive('font-src')).toBe("'self', 'data:'");
		expect(directive('style-src')).not.toMatch(FONT_HOSTS);
	});

	it('bundles each face the theme names from an installed package', () => {
		const require = createRequire(resolve(root, 'package.json'));
		const imports = [...appCss.matchAll(/@import '(@fontsource\/[^']+)';/g)].map((m) => m[1]);
		for (const face of ['inter', 'jetbrains-mono']) {
			expect(imports.some((i) => i.startsWith(`@fontsource/${face}/`))).toBe(true);
		}
		for (const file of imports) {
			expect(() => require.resolve(file)).not.toThrow();
		}
	});

	// The Open Font License travels with every copy of the font files, and the
	// image carries each root LICENSE* file beside the build.
	it('ships the license of both typefaces at the repository root', () => {
		const license = readFileSync(resolve(root, 'LICENSE-FONTS'), 'utf8');
		expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1');
		expect(license).toContain('Copyright 2016 The Inter Project Authors');
		expect(license).toContain('Copyright 2020 The JetBrains Mono Project Authors');
	});
});
