import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { motion } from '@lyeve-labs/ui-kit';
import type { OnNavigate } from '$app/navigation';
import { ENTERING, fadeRouteChange } from './page-transition';

vi.mock('@lyeve-labs/ui-kit', () => ({ motion: { swapPage: vi.fn() } }));

function navigation(
	from: string,
	to: string,
	fromRoute: string | null = '/(admin)/admin/content',
	toRoute: string | null = '/(admin)/admin/schema',
) {
	return {
		from: { url: new URL(from, 'https://app.test'), route: { id: fromRoute } },
		to: { url: new URL(to, 'https://app.test'), route: { id: toRoute } },
		complete: Promise.resolve(),
	} as unknown as OnNavigate;
}

/** An element that keeps its attributes. */
function element() {
	const attrs = new Map<string, string>();
	return {
		getAttribute: (name: string) => attrs.get(name) ?? null,
		setAttribute: (name: string, value: string) => void attrs.set(name, value),
	};
}

/**
 * A page inside the console's frame, with its content region, or a page
 * outside it. The browser offers view transitions, so a test sees whether the
 * fade asks for one.
 */
function page({ frame = true } = {}) {
	const content = element();
	const body = element();
	const startViewTransition = vi.fn();
	vi.stubGlobal('document', {
		body,
		getElementById: (id: string) => (frame && id === 'content' ? content : null),
		startViewTransition,
	});
	return { content, body, startViewTransition };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('fadeRouteChange', () => {
	it("fades the content region in on a change of page inside the console's frame", () => {
		const p = page();
		fadeRouteChange(navigation('/admin/content', '/admin/schema'));
		expect(p.content.getAttribute(ENTERING)).toBe('a');
		expect(p.body.getAttribute(ENTERING)).toBeNull();
	});

	it('starts the fade over on every change, so a change during a fade restarts it', () => {
		const p = page();
		fadeRouteChange(navigation('/admin/content', '/admin/schema'));
		fadeRouteChange(
			navigation('/admin/schema', '/admin/users', '/(admin)/admin/schema', '/(admin)/admin/users'),
		);
		expect(p.content.getAttribute(ENTERING)).toBe('b');
		fadeRouteChange(navigation('/admin/users', '/admin', '/(admin)/admin/users', '/(admin)/admin'));
		expect(p.content.getAttribute(ENTERING)).toBe('a');
	});

	it("fades the whole body in on a change that enters or leaves the console's frame", () => {
		const p = page();
		fadeRouteChange(navigation('/admin/content', '/login', '/(admin)/admin/content', '/login'));
		expect(p.body.getAttribute(ENTERING)).toBe('a');
		fadeRouteChange(navigation('/login', '/admin', '/login', '/(admin)/admin'));
		expect(p.body.getAttribute(ENTERING)).toBe('b');
		expect(p.content.getAttribute(ENTERING)).toBeNull();
	});

	// A path no route matches renders the root error page, outside the frame.
	it('fades the body when no route matched the new page', () => {
		const p = page();
		fadeRouteChange(navigation('/admin/content', '/nope', '/(admin)/admin/content', null));
		expect(p.body.getAttribute(ENTERING)).toBe('a');
		expect(p.content.getAttribute(ENTERING)).toBeNull();
	});

	it('fades the body when the page has no content region', () => {
		const p = page({ frame: false });
		fadeRouteChange(navigation('/admin/content', '/admin/schema'));
		expect(p.body.getAttribute(ENTERING)).toBe('a');
	});

	it('leaves a change of query alone', () => {
		const p = page();
		fadeRouteChange(
			navigation(
				'/admin/content?page=1',
				'/admin/content?page=2',
				'/(admin)/admin/content',
				'/(admin)/admin/content',
			),
		);
		expect(p.content.getAttribute(ENTERING)).toBeNull();
		expect(p.body.getAttribute(ENTERING)).toBeNull();
	});

	// Every kit surface plays its exit when the page holding it goes, and the
	// page waits for it, so an alert on the page being left kept that page on
	// screen above the new one.
	it('swaps the page in one frame on a change of page, not on a change of query', () => {
		page();
		fadeRouteChange(
			navigation(
				'/admin/content?page=1',
				'/admin/content?page=2',
				'/(admin)/admin/content',
				'/(admin)/admin/content',
			),
		);
		expect(motion.swapPage).not.toHaveBeenCalled();
		fadeRouteChange(navigation('/admin/content', '/admin/schema'));
		expect(motion.swapPage).toHaveBeenCalledTimes(1);
	});

	// In desktop Chrome on Intel graphics a view transition's snapshot came out
	// white, on a named region and on the root alike, so the dark theme flashed
	// white between pages.
	it('never asks the browser for a view transition', () => {
		const p = page();
		fadeRouteChange(navigation('/admin/content', '/admin/schema'));
		fadeRouteChange(navigation('/admin/schema', '/login', '/(admin)/admin/schema', '/login'));
		expect(p.startViewTransition).not.toHaveBeenCalled();
	});

	it('does nothing on the server', () => {
		expect(() => fadeRouteChange(navigation('/admin/content', '/admin/schema'))).not.toThrow();
		expect(motion.swapPage).not.toHaveBeenCalled();
	});
});

describe('the route fade in app.css', () => {
	const css = readFileSync(fileURLToPath(new URL('../app.css', import.meta.url)), 'utf8');
	const rule = (selector: string) => {
		const at = css.indexOf(`${selector} {`);
		return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
	};

	it('styles no view transition and names no region for one', () => {
		expect(css).not.toMatch(/::view-transition|view-transition-name\s*:/);
	});

	it('fades the content region in on either mark, and holds nothing after', () => {
		for (const mark of ['a', 'b']) {
			expect(rule(`[data-page-entering='${mark}']`)).toMatch(
				new RegExp(`animation:\\s*page-in-${mark}\\s+var\\(--duration-slow\\)\\s+var\\(--ease-enter\\)\\s+backwards;`),
			);
			expect(css).toMatch(new RegExp(`@keyframes page-in-${mark} \\{\\s*from \\{\\s*opacity: 0;\\s*\\}\\s*\\}`));
		}
	});

	// A page drawn below where it lands overflows the window for as long as it
	// moves, so a page a little shorter than the window showed the scrollbar
	// until it settled. The body takes the same fade when the frame changes.
	it('moves nothing while the page fades in', () => {
		const keyframes = css.match(/@keyframes page-in-[ab] \{[^@]*?\}\s*\}/g) ?? [];
		expect(keyframes).toHaveLength(2);
		for (const k of keyframes) expect(k).not.toMatch(/transform|translate/);
		expect(css).not.toMatch(/data-page-entering[^{]*\{[^}]*(transform|translate)/);
	});
});

// Reduced motion is honored once, in the kit's stylesheet. A second check in
// the admin is a second rule that can disagree with the first.
describe('reduced motion', () => {
	// Reading every source file takes a tenth of a second on a quiet machine
	// and took over 10 s on a busy shared runner, so the survey has its own
	// timeout instead of the 5 s default.
	it('is decided nowhere in the admin', () => {
		const src = fileURLToPath(new URL('..', import.meta.url));
		const files = globSync('**/*.{ts,svelte,css}', { cwd: src }).filter((f) => !f.endsWith('.test.ts'));
		expect(files.length).toBeGreaterThan(0);
		expect(files.filter((f) => /prefers-reduced-motion/.test(readFileSync(join(src, f), 'utf8')))).toEqual([]);
	}, 60_000);
});
