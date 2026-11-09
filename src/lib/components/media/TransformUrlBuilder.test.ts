// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Each form's submit handler, by its action, so a case can run a submit.
const forms = vi.hoisted(() => ({ handlers: new Map<string, unknown>() }));
vi.mock('$app/forms', () => ({
	enhance: (form: HTMLFormElement, submit: unknown) => {
		forms.handlers.set(form.getAttribute('action') ?? '', submit);
		return { destroy() {} };
	},
}));

import TransformUrlBuilder from './TransformUrlBuilder.svelte';
import FocalPointPicker from './FocalPointPicker.svelte';

afterEach(cleanup);

describe('TransformUrlBuilder', () => {
	it('shows the signed URL the engine answered and when it stops working', () => {
		const { container } = render(TransformUrlBuilder, {
			props: {
				id: 'm1',
				published: false,
				focal: null,
				signed: { url: '/api/v1/media/m1/transform?w=800&sig=abc', expires_at: '2026-10-03T10:00:00Z' },
			},
		});
		expect((container.querySelector('#transform-result') as HTMLInputElement | null)?.value ?? container.textContent).toContain(
			'/api/v1/media/m1/transform?w=800&sig=abc',
		);
		expect(container.textContent).toContain('Expires ');
	});

	it('lays out each fit as a choice with the sentence that says what it does', () => {
		const { getByRole } = render(TransformUrlBuilder, { props: { id: 'm1', published: true, focal: null } });
		const group = getByRole('radiogroup', { name: 'Fit' });
		const cover = getByRole('radio', { name: /Cover/ }) as HTMLInputElement;
		expect(group.contains(cover)).toBe(true);
		expect(cover.name).toBe('fit');
		expect(group.textContent).toContain('crops what falls outside it');
		expect((getByRole('radio', { name: /Engine default/ }) as HTMLInputElement).checked).toBe(true);
	});

	it('lays out the expiry choices side by side, with never only for a published file', () => {
		const published = render(TransformUrlBuilder, { props: { id: 'm1', published: true, focal: null } });
		const group = published.getByRole('radiogroup', { name: 'Expires' });
		expect(group.querySelectorAll('[role="radio"]')).toHaveLength(4);
		for (const name of ['Never', 'In an hour', 'In a day', 'In a week']) {
			expect(group.contains(published.getByRole('radio', { name }))).toBe(true);
		}
		expect(published.getByRole('radio', { name: 'Never' }).getAttribute('aria-checked')).toBe('true');
		cleanup();

		const own = render(TransformUrlBuilder, { props: { id: 'm1', published: false, focal: null } });
		expect(own.queryByRole('radio', { name: 'Never' })).toBeNull();
		expect(own.getByRole('radio', { name: 'In an hour' }).getAttribute('aria-checked')).toBe('true');
		expect((own.container.querySelector('input[name="expires_in"]') as HTMLInputElement).value).toBe('3600');
	});

	it('renders the refusal in place of a URL', () => {
		const { getByTestId } = render(TransformUrlBuilder, {
			props: { id: 'm1', published: true, focal: null, refused: { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' } },
		});
		expect(getByTestId('refusal-notice').textContent).toContain('Not enabled on this engine');
	});

	it('renders a cap refusal with its numbers', () => {
		const { getByTestId } = render(TransformUrlBuilder, {
			props: { id: 'm1', published: true, focal: null, refused: { kind: 'cap', cap: 'example.items', limit: 9, current: 9, upgradeUrl: '' } },
		});
		const text = getByTestId('refusal-notice').textContent ?? '';
		expect(text).toContain("You're using 9 of 9 items");
	});

	it('keeps the size, quality and format it built the URL from', async () => {
		render(TransformUrlBuilder, { props: { id: 'm1', published: true, focal: null } });
		const submit = forms.handlers.get('?/transformUrl') as (o: unknown) => Promise<(o: unknown) => Promise<void>>;
		const update = vi.fn(async () => {});
		const after = await submit({ formData: new FormData(), cancel: vi.fn() });
		await after({ result: { type: 'success', status: 200, data: {} }, update });
		expect(update).toHaveBeenCalledWith({ reset: false });
	});

	it('sends the focal point only when the file has one', () => {
		const { container } = render(TransformUrlBuilder, { props: { id: 'm1', published: true, focal: { x: 0.2, y: 0.8 } } });
		expect(container.querySelector('input[name="focal_x"]')?.getAttribute('value')).toBe('0.2');
		expect(container.querySelector('input[name="use_focal"]')?.getAttribute('value')).toBe('true');
	});
});

describe('FocalPointPicker', () => {
	it('starts from the stored point and offers to reset it', () => {
		const { container, getByText } = render(FocalPointPicker, {
			props: { id: 'm1', src: '/f', alt: 'a', stored: { x: 0.25, y: 0.75 } },
		});
		expect(container.querySelector('input[name="x"]')?.getAttribute('value')).toBe('0.25');
		expect(getByText('Reset to center')).toBeTruthy();
	});

	it('measures a click against the picture, not the frame around it', async () => {
		const { container, getByRole } = render(FocalPointPicker, { props: { id: 'm1', src: '/f', alt: 'a', stored: null } });
		const frame = getByRole('button', { name: /Focal point at/ });
		const rect = (left: number, width: number, height: number) =>
			({ left, top: 0, width, height, right: left + width, bottom: height, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
		// A portrait picture centered in a frame four times its width.
		frame.getBoundingClientRect = () => rect(0, 400, 200);
		(container.querySelector('img') as HTMLImageElement).getBoundingClientRect = () => rect(150, 100, 200);
		await fireEvent.click(frame, { clientX: 160, clientY: 50 });
		expect(container.querySelector('input[name="x"]')?.getAttribute('value')).toBe('0.1');
		expect(container.querySelector('input[name="y"]')?.getAttribute('value')).toBe('0.25');
		expect((container.querySelector('[data-testid="focal-marker"]') as HTMLElement).style.left).toBe('10%');
	});

	it('moves the point with the arrow keys', async () => {
		const { container, getByRole } = render(FocalPointPicker, { props: { id: 'm1', src: '/f', alt: 'a', stored: null } });
		const target = getByRole('button', { name: /Focal point at 50% across/ });
		target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await Promise.resolve();
		await new Promise((r) => setTimeout(r, 0));
		expect(container.querySelector('input[name="x"]')?.getAttribute('value')).toBe('0.55');
	});
});
