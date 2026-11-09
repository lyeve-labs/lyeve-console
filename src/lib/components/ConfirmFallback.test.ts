// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	page: { form: null as unknown, url: new URL('http://admin.test/admin/webhooks?/delete') },
}));
vi.mock('$app/state', () => state);
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import ConfirmFallback from './ConfirmFallback.svelte';

afterEach(() => {
	cleanup();
	state.page.form = null;
});

describe('ConfirmFallback', () => {
	it('draws nothing when no post is waiting for an answer', () => {
		const { container } = render(ConfirmFallback);
		expect(container.querySelector('form')).toBeNull();
	});

	it('asks the question and posts the same fields again with the confirmation', () => {
		state.page.form = {
			unconfirmed: {
				question: 'Delete this webhook?',
				detail: 'This cannot be undone.',
				label: 'Delete',
				action: '/admin/webhooks?/delete',
				fields: [['id', 'wh-1']],
			},
		};
		const { container } = render(ConfirmFallback);

		expect(screen.getByText('Delete this webhook?')).toBeTruthy();
		expect(screen.getByText(/This cannot be undone\./)).toBeTruthy();
		const form = container.querySelector('form')!;
		expect(form.getAttribute('method')).toBe('POST');
		expect(form.getAttribute('action')).toBe('/admin/webhooks?/delete');
		const posted = Object.fromEntries(new FormData(form));
		expect(posted).toEqual({ id: 'wh-1', confirmed: 'yes' });
		expect(screen.getByRole('button', { name: 'Delete' }).getAttribute('type')).toBe('submit');
		expect(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href')).toBe('/admin/webhooks');
	});
});
