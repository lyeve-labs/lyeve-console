// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet, tick } from 'svelte';
import ResizableAside from './ResizableAside.svelte';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const body = createRawSnippet(() => ({ render: () => '<p>body</p>' }));
const count = createRawSnippet(() => ({ render: () => '<span>12</span>' }));

const KEY = 'lyeve-test-aside';

/** Two drawn frames, after which the aside lets its width travel. */
async function frames() {
	await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
	await tick();
}
const BOUNDS = { width: 260, min: 200, max: 500 };

type Props = Partial<{
	side: 'start' | 'end';
	breakpoint: 'md' | 'lg' | 'xl';
	below: 'stack' | 'overlay' | 'hidden';
	overlay: boolean;
	collapsible: boolean;
	open: boolean;
	class: string;
	meta: typeof count;
}>;

function setup(props: Props = {}) {
	const result = render(ResizableAside, {
		props: { storageKey: KEY, label: 'Things', side: props.side ?? 'start', ...BOUNDS, ...props, children: body },
	});
	const aside = result.getByTestId(`aside-${KEY}`);
	return {
		...result,
		aside,
		widthOf: () => aside.style.getPropertyValue('--panel-w'),
		handle: () => result.queryByTestId(`aside-${KEY}-handle`),
		stored: () => JSON.parse(localStorage.getItem(KEY) ?? 'null'),
	};
}

describe('ResizableAside', () => {
	// The tinted handle measures under 3:1 on both surfaces, so a focused
	// handle takes the full brand color.
	it('marks a focused handle in the full brand color', () => {
		const handle = setup().handle() as HTMLElement;
		expect(handle.classList).toContain('focus-visible:bg-brand');
		expect(handle.classList).not.toContain('focus-visible:bg-brand/40');
	});

	it('opens at its default width, or at the remembered width and lock', () => {
		expect(setup().widthOf()).toBe('260px');
		cleanup();
		localStorage.setItem(KEY, JSON.stringify({ width: 400, locked: true }));
		const { widthOf, handle, getByRole } = setup();
		expect(widthOf()).toBe('400px');
		expect(handle()).toBeNull();
		expect(getByRole('button', { name: 'Unlock Things width' }).getAttribute('aria-pressed')).toBe('true');
	});

	it('survives storage that throws', () => {
		const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('refused');
		});
		const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('refused');
		});
		const { widthOf, handle } = setup();
		expect(widthOf()).toBe('260px');
		expect(() => fireEvent.keyDown(handle() as HTMLElement, { key: 'ArrowRight' })).not.toThrow();
		getItem.mockRestore();
		setItem.mockRestore();
	});

	it('drags the inner edge in the direction that grows it and remembers the width on release', async () => {
		const start = setup({ side: 'start' });
		const h = start.handle() as HTMLElement;
		await fireEvent.pointerDown(h, { button: 0, clientX: 260, pointerId: 1 });
		await fireEvent.pointerMove(h, { clientX: 320, pointerId: 1 });
		expect(start.widthOf()).toBe('320px');
		expect(start.stored()).toBeNull();
		await fireEvent.pointerUp(h, { clientX: 320, pointerId: 1 });
		expect(start.stored()).toEqual({ width: 320, locked: false });
		cleanup();
		localStorage.clear();

		// An end aside grows leftwards: a pointer moving left makes it wider.
		const end = setup({ side: 'end' });
		const e = end.handle() as HTMLElement;
		await fireEvent.pointerDown(e, { button: 0, clientX: 900, pointerId: 1 });
		await fireEvent.pointerMove(e, { clientX: 840, pointerId: 1 });
		expect(end.widthOf()).toBe('320px');
		expect(e.className).toContain('-left-1');
	});

	it('draws its first state still, then travels between the panel and the strip on its width', async () => {
		const { aside } = setup({ collapsible: true });
		const classes = () => aside.className.split(/\s+/);
		// A stored width or fold lands at hydration, which is the first paint.
		expect(classes()).toContain('xl:transition-none');
		await frames();
		expect(classes()).toEqual(expect.arrayContaining(['xl:transition-[width]', 'xl:duration-base', 'xl:ease-move']));
		expect(classes()).not.toContain('xl:transition-none');
	});

	it('holds the width still while the edge is dragged, so it follows the pointer', async () => {
		const { aside, handle } = setup();
		await frames();
		const h = handle() as HTMLElement;
		await fireEvent.pointerDown(h, { button: 0, clientX: 260, pointerId: 1 });
		expect(aside.className.split(/\s+/)).toContain('xl:transition-none');
		await fireEvent.pointerUp(h, { clientX: 300, pointerId: 1 });
		expect(aside.className.split(/\s+/)).toContain('xl:transition-[width]');
	});

	it('ignores a press that is not the primary button', async () => {
		const { handle, widthOf } = setup();
		const h = handle() as HTMLElement;
		await fireEvent.pointerDown(h, { button: 2, clientX: 260, pointerId: 1 });
		await fireEvent.pointerMove(h, { clientX: 400, pointerId: 1 });
		expect(widthOf()).toBe('260px');
	});

	it('clamps to the bounds and announces them', async () => {
		const { handle, widthOf } = setup();
		const h = handle() as HTMLElement;
		await fireEvent.pointerDown(h, { button: 0, clientX: 260, pointerId: 1 });
		await fireEvent.pointerMove(h, { clientX: -500, pointerId: 1 });
		expect(widthOf()).toBe('200px');
		await fireEvent.pointerMove(h, { clientX: 5000, pointerId: 1 });
		expect(widthOf()).toBe('500px');
		expect(h.getAttribute('aria-valuemin')).toBe('200');
		expect(h.getAttribute('aria-valuemax')).toBe('500');
		expect(h.getAttribute('role')).toBe('separator');
	});

	it('nudges by a step from the keyboard, more with Shift, and writes each step', async () => {
		const { handle, widthOf, stored } = setup();
		const h = handle() as HTMLElement;
		await fireEvent.keyDown(h, { key: 'ArrowRight' });
		expect(widthOf()).toBe('284px');
		await fireEvent.keyDown(h, { key: 'ArrowLeft', shiftKey: true });
		expect(widthOf()).toBe('204px');
		expect(stored().width).toBe(204);
		expect(h.getAttribute('aria-valuenow')).toBe('204');
		await fireEvent.keyDown(h, { key: 'ArrowUp' });
		expect(widthOf()).toBe('204px');
	});

	it('locks the width: the handle goes and the lock is remembered', async () => {
		const { getByRole, handle, stored, aside } = setup();
		await fireEvent.click(getByRole('button', { name: 'Lock Things width' }));
		expect(handle()).toBeNull();
		expect(aside.getAttribute('data-locked')).toBe('true');
		expect(stored()).toEqual({ width: 260, locked: true });
		await fireEvent.click(getByRole('button', { name: 'Unlock Things width' }));
		expect(handle()).not.toBeNull();
		expect(stored().locked).toBe(false);
	});

	it('offers no collapse unless asked, and folds to a strip that expands again when it is', async () => {
		const plain = setup();
		expect(plain.queryByRole('button', { name: 'Collapse Things' })).toBeNull();
		expect(plain.queryByTestId(`aside-${KEY}-strip`)).toBeNull();
		cleanup();

		const { getByRole, getByTestId, aside, getByText } = setup({ collapsible: true });
		await fireEvent.click(getByRole('button', { name: 'Collapse Things' }));
		expect(aside.getAttribute('data-open')).toBe('false');
		expect(aside.className).toContain('xl:w-8');
		const strip = getByTestId(`aside-${KEY}-strip`);
		expect(strip.textContent).toContain('Things');
		expect(strip.className).toContain('xl:flex');
		await fireEvent.click(getByRole('button', { name: 'Expand Things' }));
		expect(aside.getAttribute('data-open')).toBe('true');
		expect(aside.className).not.toContain('xl:w-8');
		expect(getByText('body')).toBeTruthy();
	});

	it('moves focus to the control that undoes a fold, each time, and leaves it alone when the page folds it', async () => {
		const { getByRole, rerender } = setup({ collapsible: true });
		for (let i = 0; i < 4; i++) {
			const collapse = getByRole('button', { name: 'Collapse Things' });
			collapse.focus();
			await fireEvent.click(collapse);
			await tick();
			expect(document.activeElement).toBe(getByRole('button', { name: 'Expand Things' }));
			await fireEvent.click(document.activeElement as HTMLElement);
			await tick();
			expect(document.activeElement).toBe(getByRole('button', { name: 'Collapse Things' }));
		}

		(document.activeElement as HTMLElement).blur();
		await rerender({ open: false });
		await tick();
		expect(document.activeElement).toBe(document.body);
	});

	it('stacks in the page flow under the breakpoint and docks at its width above it', () => {
		const { aside, handle } = setup({ breakpoint: 'md', class: 'max-h-2/5' });
		expect(aside.className).toMatch(/(^|\s)flex(\s|$)/);
		expect(aside.className).toContain('border-b');
		expect(aside.className).toContain('md:border-b-0');
		expect(aside.className).toContain('md:w-(--panel-w)');
		expect(aside.className).toContain('md:border-r');
		expect(aside.className).toContain('max-h-2/5');
		expect(aside.className).not.toContain('absolute');
		// No drag below the breakpoint: the handle is hidden until md.
		expect((handle() as HTMLElement).className).toContain('md:block');
	});

	it('hides under the breakpoint when asked to', () => {
		const { aside } = setup({ breakpoint: 'lg', below: 'hidden', side: 'end' });
		expect(aside.className).toMatch(/(^|\s)hidden(\s|$)/);
		expect(aside.className).toContain('lg:flex');
		expect(aside.className).toContain('lg:border-l');
	});

	it('keeps the caller-supplied meta beside the label', () => {
		const { getByRole, getByText } = setup({ meta: count });
		const heading = getByRole('heading', { level: 2 });
		expect(heading.textContent).toContain('Things');
		expect(heading.parentElement?.contains(getByText('12'))).toBe(true);
	});
});

/** The classes one by one, so a case can name a class without matching its variants. */
const classesOf = (el: HTMLElement) => el.className.split(/\s+/).filter(Boolean);

describe('ResizableAside as an overlay', () => {
	afterEach(() => vi.unstubAllGlobals());

	/** A viewport under every breakpoint or at all of them, which can be resized. */
	function viewport(wide: boolean) {
		const listeners = new Set<() => void>();
		let now = wide;
		vi.stubGlobal('matchMedia', (media: string) => ({
			media,
			get matches() {
				return media.startsWith('(min-width') && now;
			},
			addEventListener: (_: string, fn: () => void) => listeners.add(fn),
			removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
		}));
		return {
			async resize(next: boolean) {
				now = next;
				for (const fn of listeners) fn();
				await tick();
			},
		};
	}

	it('sits closed off its own edge, transparent and invisible, until the page asks for it', () => {
		expect(classesOf(setup({ below: 'overlay' }).aside)).toEqual(
			expect.arrayContaining(['absolute', 'invisible', 'opacity-0', '-translate-x-full'])
		);
		cleanup();
		expect(classesOf(setup({ below: 'overlay', side: 'end' }).aside)).toEqual(
			expect.arrayContaining(['invisible', 'opacity-0', 'translate-x-full'])
		);
	});

	it('opens in place, with nothing hiding it or holding it off its edge', () => {
		const open = classesOf(setup({ below: 'overlay', overlay: true }).aside);
		expect(open).toContain('absolute');
		for (const shut of ['invisible', 'opacity-0', '-translate-x-full', 'translate-x-full']) expect(open).not.toContain(shut);
	});

	it('enters on the slow rung and leaves one rung faster', async () => {
		const { aside, rerender } = setup({ below: 'overlay' });
		// Visibility is in the exit's list, so the panel stays visible until it has slid out.
		expect(classesOf(aside)).toEqual(
			expect.arrayContaining(['transition-[translate,opacity,visibility]', 'duration-base', 'ease-exit'])
		);
		await rerender({ overlay: true });
		// It is not in the entrance's, so a field inside can take focus on the first frame.
		expect(classesOf(aside)).toEqual(expect.arrayContaining(['transition-[translate,opacity]', 'duration-slow', 'ease-enter']));
		expect(classesOf(aside)).not.toContain('duration-base');
		expect(classesOf(aside)).not.toContain('ease-exit');
	});

	it('docks at the breakpoint with nothing moving or transitioning, open or closed', () => {
		for (const overlay of [false, true]) {
			expect(classesOf(setup({ below: 'overlay', overlay }).aside)).toEqual(
				expect.arrayContaining(['xl:static', 'xl:visible', 'xl:translate-none', 'xl:opacity-100', 'xl:transition-none'])
			);
			cleanup();
		}
	});

	it('is inert while closed under the breakpoint, and never at it', async () => {
		const screen = viewport(false);
		const { aside, rerender } = setup({ below: 'overlay' });
		expect(aside.inert).toBe(true);
		await rerender({ overlay: true });
		expect(aside.inert).toBe(false);
		await rerender({ overlay: false });
		expect(aside.inert).toBe(true);
		await screen.resize(true);
		expect(aside.inert).toBe(false);
	});

	it('keeps what the reader typed through a close, a reopen and the breakpoint', async () => {
		const screen = viewport(false);
		const field = createRawSnippet(() => ({ render: () => '<input aria-label="Filter" />' }));
		const { getByTestId, getByLabelText, rerender } = render(ResizableAside, {
			props: { storageKey: KEY, label: 'Things', side: 'start', ...BOUNDS, below: 'overlay', overlay: true, children: field },
		});
		const aside = getByTestId(`aside-${KEY}`);
		const input = getByLabelText('Filter') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'http.req' } });

		await rerender({ overlay: false });
		await rerender({ overlay: true });
		await screen.resize(true);
		await screen.resize(false);

		expect(getByTestId(`aside-${KEY}`)).toBe(aside);
		expect(getByLabelText('Filter')).toBe(input);
		expect(input.value).toBe('http.req');
	});
});
