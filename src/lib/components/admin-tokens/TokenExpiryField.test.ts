// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import TokenExpiryField from './TokenExpiryField.svelte';

afterEach(cleanup);

/** Renders the field inside a form, so a test reads what a submit would post. */
function setup(props: Record<string, unknown> = {}) {
	const form = document.createElement('form');
	document.body.appendChild(form);
	const result = render(TokenExpiryField, { target: form, props: { id: 'issue', ...props } as never });
	return { ...result, sent: () => new FormData(form) };
}

describe('TokenExpiryField', () => {
	it('posts thirty days unless another lifetime is chosen', () => {
		const { sent } = setup();
		expect(sent().get('expiry')).toBe('30');
		expect(sent().get('expires_at')).toBeNull();
		expect(screen.getByText(/stops working 30 days after it is issued/)).toBeTruthy();
	});

	it('posts the preset a reader picks', async () => {
		const { sent } = setup();
		await fireEvent.click(screen.getByRole('radio', { name: '7 days' }));
		expect(sent().get('expiry')).toBe('7');
	});

	it('asks for a day once a reader chooses to pick one, and posts no end until one is picked', async () => {
		const { sent } = setup();
		await fireEvent.click(screen.getByRole('radio', { name: 'Choose a day' }));
		const out = sent();
		expect(out.get('expiry')).toBe('custom');
		expect(out.get('expires_at')).toBe('');
		expect(screen.getByText(/The token stops working at the end of this day, in your time zone/)).toBeTruthy();
	});

	it('shows the refusal the server gave for a preset', () => {
		setup({ error: 'Admin tokens may live at most 90 days.' });
		expect(screen.getByText('Admin tokens may live at most 90 days.')).toBeTruthy();
	});
});
