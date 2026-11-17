// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import CustomBlocks from './CustomBlocks.svelte';
import type { ResolvedBlock } from '#lib/api/customization.ts';

afterEach(cleanup);

const draw = (blocks: ResolvedBlock[], roles: string[] = ['editor']) => render(CustomBlocks, { props: { blocks, roles } });

describe('CustomBlocks', () => {
	it('renders Markdown as elements and never as HTML', () => {
		const { container } = draw([{ type: 'markdown', title: 'Welcome', body: 'Read **this**. <img src=x onerror=alert(1)>' }]);
		expect(screen.getByText('Welcome')).toBeTruthy();
		expect(screen.getByText('this').tagName).toBe('STRONG');
		expect(container.querySelector('img')).toBeNull();
	});

	it('lists the latest entries of a schema, each linked to its editor', () => {
		draw([{ type: 'content', schema: 'posts', entries: [{ id: 'e1', title: 'Hello', status: 'draft', updated_at: '2026-10-01T00:00:00Z' }] }]);
		expect(screen.getByText('Latest in posts')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Hello' }).getAttribute('href')).toBe('/admin/content/posts/e1');
		expect(screen.getByText('draft')).toBeTruthy();
	});

	it('says entries that could not be read apart from a schema with none', () => {
		draw([
			{ type: 'content', schema: 'posts', title: 'Failed', entries: null },
			{ type: 'content', schema: 'pages', title: 'Empty', entries: [] },
		]);
		expect(screen.getByText('Could not load these entries. Reload the page to try again.')).toBeTruthy();
		expect(screen.getByText('No entries yet.')).toBeTruthy();
	});

	it('shows a count it could not read as not available, not as zero', () => {
		const { container } = draw([{ type: 'stats', counts: [{ schema: 'posts', rows: 12 }, { schema: 'orders', rows: null }] }]);
		expect(container.textContent).toContain('12');
		expect(container.textContent).toContain('n/a');
	});

	it('shows a reader only the links their roles may see, and opens an outside link in a new tab', () => {
		draw(
			[
				{
					type: 'links',
					links: [
						{ label: 'Handbook', url: 'https://example.com/handbook' },
						{ label: 'Users', url: '/admin/users', roles: ['super_admin'] },
						{ label: 'Media', url: '/admin/media', roles: ['editor'] },
					],
				},
			],
			['editor'],
		);
		const out = screen.getByRole('link', { name: /Handbook/ });
		expect(out.getAttribute('target')).toBe('_blank');
		expect(out.getAttribute('rel')).toContain('noopener');
		expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
		expect(screen.getByRole('link', { name: 'Media' }).getAttribute('target')).toBeNull();
	});

	it('shows a callout with its title', () => {
		draw([{ type: 'callout', title: 'Freeze', body: 'No publishing on Friday.', tone: 'warn' }]);
		expect(screen.getByText('Freeze')).toBeTruthy();
		expect(screen.getByText('No publishing on Friday.')).toBeTruthy();
	});
});
