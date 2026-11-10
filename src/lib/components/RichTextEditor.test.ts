// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RichTextEditor from './RichTextEditor.svelte';

const kit = vi.hoisted(() => ({ openDialog: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (original) => ({
	...(await original<typeof import('@lyeve-labs/ui-kit')>()),
	openDialog: kit.openDialog,
}));

afterEach(() => {
	cleanup();
	kit.openDialog.mockClear();
	vi.restoreAllMocks();
});

// The TipTap/ProseMirror editor instance is created asynchronously in onMount
// (dynamic import + `new Editor(...)`), which jsdom cannot fully drive. These
// tests only assert the statically-rendered formatting toolbar.
describe('RichTextEditor', () => {
	it('renders the formatting toolbar controls', () => {
		const { getByLabelText } = render(RichTextEditor, { props: { value: '' } });
		expect(getByLabelText('Bold')).toBeTruthy();
		expect(getByLabelText('Italic')).toBeTruthy();
		expect(getByLabelText('Underline')).toBeTruthy();
	});

	// The frame is focused through the editable part inside it, so its hover
	// border yields to the focus border instead of repainting it gray.
	it('rests the frame on the field border and keeps its focus border under the pointer', () => {
		const { getByLabelText } = render(RichTextEditor, { props: { value: '' } });
		const classes = getByLabelText('Undo').parentElement!.parentElement!.className.split(/\s+/);
		expect(classes).toContain('border-line');
		expect(classes).toContain('hover:not-focus-within:border-line-strong');
		expect(classes).toContain('focus-within:border-focus');
		expect(classes).not.toContain('border-line-strong');
	});

	it('renders undo and redo controls', () => {
		const { getByLabelText } = render(RichTextEditor, { props: { value: '' } });
		expect(getByLabelText('Undo')).toBeTruthy();
		expect(getByLabelText('Redo')).toBeTruthy();
	});

	// A browser prompt is the one dialog in the console the kit does not draw.
	it('asks for a link URL in the kit dialog, not a browser prompt', async () => {
		const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);
		const { getByLabelText } = render(RichTextEditor, { props: { value: '' } });
		await fireEvent.click(getByLabelText('Insert link'));
		expect(kit.openDialog).toHaveBeenCalledTimes(1);
		expect((kit.openDialog.mock.calls[0] as unknown[])[0]).toMatchObject({ title: 'Insert link' });
		expect(prompt).not.toHaveBeenCalled();
	});
});

/*
 * Every toolbar control is an icon with no text, so the only thing naming it is
 * an attribute. aria-label alone leaves a pointer user with no tooltip and
 * nothing to hover: better served by a screen reader than by a mouse. The two
 * are asserted together, and asserted to be equal, so a control added with only
 * one of them fails here rather than shipping half-named.
 */
describe('RichTextEditor toolbar naming', () => {
	function toolbarButtons(container: HTMLElement): HTMLButtonElement[] {
		return [...container.querySelectorAll<HTMLButtonElement>('button[type="button"]')];
	}

	it('names every control to both a screen reader and a pointer', () => {
		const { container } = render(RichTextEditor, { props: { value: '' } });
		const buttons = toolbarButtons(container);

		expect(buttons.length).toBeGreaterThan(0);
		for (const button of buttons) {
			const label = button.getAttribute('aria-label');
			const title = button.getAttribute('title');
			expect(label, `a toolbar control has no aria-label: ${button.outerHTML}`).toBeTruthy();
			expect(title, `a toolbar control has no title: ${label}`).toBeTruthy();
			expect(title).toBe(label);
		}
	});

	it('sizes the controls from the control token rather than a literal', () => {
		const { container } = render(RichTextEditor, { props: { value: '' } });

		// A 28px square is only four pixels over the 24x24 floor in SC 2.5.8,
		// with no spacing exception available because the controls sit against
		// each other, so the size comes from the control token.
		for (const button of toolbarButtons(container)) {
			expect(button.className).toContain('h-control');
			expect(button.className).toContain('w-control');
			expect(button.className).not.toMatch(/\b[wh]-7\b/);
		}
	});
});
