// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import CommentsPanel from './CommentsPanel.svelte';

afterEach(cleanup);

const people = [
	{ id: 'u1', email: 'ana@example.com' },
	{ id: 'u2', email: 'bo@example.com' },
];

const thread = {
	id: 'c1',
	entry_id: 'e1',
	author_id: 'u1',
	body: 'Is the date right?',
	mentions: ['u2'],
	resolved: false,
	created_at: '2026-10-01T10:00:00Z',
	updated_at: '2026-10-01T10:00:00Z',
	replies: [{ id: 'c2', entry_id: 'e1', parent_id: 'c1', author_id: 'u2', body: 'Yes.', mentions: [], resolved: false, created_at: '2026-10-01T11:00:00Z', updated_at: '' }],
};

describe('CommentsPanel', () => {
	it('shows a thread with its replies, its author and who it mentions', () => {
		const { container } = render(CommentsPanel, { props: { threads: [thread], people, mentionable: people } });
		expect(container.textContent).toContain('Is the date right?');
		expect(container.textContent).toContain('Yes.');
		expect(container.textContent).toContain('@bo@example.com');
		expect(container.querySelector('form[action="?/resolveThread"] input[name="resolved"]')?.getAttribute('value')).toBe('true');
	});

	it('offers to reopen a resolved thread', () => {
		const { container, getByRole } = render(CommentsPanel, { props: { threads: [{ ...thread, resolved: true }], people, mentionable: people } });
		getByRole('radio', { name: 'Resolved' })?.click();
		expect(container.querySelector('form[action="?/resolveThread"] input[name="resolved"]')?.getAttribute('value') ?? 'false').toBe('false');
	});

	it('says a failed read failed, and offers no way to post into it', () => {
		const { container } = render(CommentsPanel, { props: { threads: [], people, mentionable: people, unavailable: true } });
		expect(container.textContent).toContain('Could not load comments');
		expect(container.querySelector('form[action="?/comment"]')).toBeNull();
	});

	it('renders a refused comment as the refusal notice', () => {
		const { getByTestId } = render(CommentsPanel, {
			props: { threads: [], people, mentionable: people, refused: { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' } },
		});
		expect(getByTestId('refusal-notice').textContent).toContain('Not enabled on this engine');
	});
});
