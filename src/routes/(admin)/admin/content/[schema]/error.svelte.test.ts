// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	page: {
		status: 403,
		error: null as { message: string; subject?: string } | null,
		params: { schema: 'posts' } as Record<string, string>,
		url: new URL('http://admin.test/admin/content/posts/e1'),
	},
}));

vi.mock('$app/state', () => state);
vi.mock('$app/navigation', () => ({ onNavigate: () => {} }));
vi.mock('$app/paths', () => ({ asset: (path: string) => path }));

import ContentTypeError from './+error.svelte';
import UnderRootLayout from '../../../../root-layout-page.test.svelte';

afterEach(cleanup);

function renderAt(status: number, error: { message: string; subject?: string } | null) {
	state.page.status = status;
	state.page.error = error;
	return render(UnderRootLayout, { props: { page: ContentTypeError } });
}

/*
 * A refused entry or new entry draws the way the entry list draws its
 * refusal: the content type as the title, the sentence as a notice, and no
 * status code for the reader to decode.
 */
describe('content type error page', () => {
	it('draws a refusal inside the content type frame, with no status code', () => {
		const message = 'Your role cannot open entries of Posts. Ask a super admin if you need it.';
		const { container, getByRole, getByText } = renderAt(403, { message, subject: 'Posts' });

		expect(getByRole('heading', { level: 1 }).textContent?.trim()).toBe('Posts');
		expect(getByText(message)).toBeTruthy();
		expect(container.textContent).not.toContain('403');
		expect(container.textContent).not.toContain('Access denied');
		expect(container.querySelector('a[href="/admin/content"]')).not.toBeNull();
	});

	it('keeps the error panel for a failure that is not a refusal', () => {
		const { getByText } = renderAt(503, { message: 'The engine did not answer.' });

		expect(getByText('503')).toBeTruthy();
	});
});
