// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

// No widget label opens with a name spelled with more than its first capital
// yet, so one is added here to show how such a label reads in its button.
vi.mock('$lib/api/custom-dashboard', async (original) => {
	const real = await original<typeof import('$lib/api/custom-dashboard')>();
	const graphql = { ...real.WIDGET_KINDS[0], type: 'text' as const, label: 'GraphQL schema' };
	return { ...real, WIDGET_KINDS: [...real.WIDGET_KINDS.filter((k) => k.type !== 'text'), graphql] };
});

import EditorPage from './+page.svelte';

afterEach(cleanup);

describe('the add button for each widget kind', () => {
	it('keeps a name spelled with more than its first capital, and lowers a plain label', () => {
		render(EditorPage, {
			props: {
				data: {
					layout: { entitled: true, custom: false, widgets: [], updated_at: null },
					schemas: ['posts'],
					schemasGate: { state: 'ok' },
					plugins: { state: 'named', running: ['content', 'media', 'audit'], withheld: [] },
					user: { roles: ['admin'] },
					gate: { state: 'ok' },
					entitled: true,
					pages: [],
					homePage: '',
				},
				form: null,
			} as never,
		});
		expect(screen.getByRole('button', { name: 'Add GraphQL schema' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Add entry counts' })).toBeTruthy();
	});
});
