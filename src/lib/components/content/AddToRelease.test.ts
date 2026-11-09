// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import AddToRelease from './AddToRelease.svelte';

afterEach(cleanup);

// A confirmation takes its text two frames after it mounts, so a test that
// says one is absent looks only after those frames have passed.
async function twoFrames(): Promise<void> {
	await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
	await tick();
}

const releases = [{ id: 'r1', name: 'Launch', status: 'draft' as const }];

describe('AddToRelease', () => {
	it('offers the two ways out as a segmented control that submits its choice', () => {
		const { container } = render(AddToRelease, { props: { releases, holding: [] } });
		expect(screen.getByRole('radiogroup', { name: 'When it goes out' })).toBeTruthy();
		expect(container.querySelector('input[type="hidden"][name="action"]')?.getAttribute('value')).toBe('publish');
	});

	it('says the releases could not be read instead of claiming none is open', () => {
		render(AddToRelease, { props: { releases: [], holding: [], failed: true } });
		expect(screen.getByText(/Could not load releases/)).toBeTruthy();
		expect(screen.queryByText(/No release is open/)).toBeNull();
	});

	it('posts the first open release and a publish to the entry page action', () => {
		const two = [...releases, { id: 'r2', name: 'Spring', status: 'scheduled' as const }];
		const { container } = render(AddToRelease, { props: { releases: two, holding: [] } });
		const form = container.querySelector('form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/addToRelease');
		const sent = new FormData(form);
		expect(sent.get('release_id')).toBe('r1');
		expect(sent.get('action')).toBe('publish');
	});

	it('posts an unpublish once the reader picks it', async () => {
		const { container } = render(AddToRelease, { props: { releases, holding: [] } });
		await fireEvent.click(screen.getByRole('radio', { name: 'Unpublish it' }));
		expect(new FormData(container.querySelector('form') as HTMLFormElement).get('action')).toBe('unpublish');
	});

	it('offers to create a release when none is open', () => {
		render(AddToRelease, { props: { releases: [], holding: [] } });
		expect(screen.getByRole('link', { name: 'Create one' }).getAttribute('href')).toBe('/admin/releases');
		expect(screen.queryByRole('button', { name: 'Add to release' })).toBeNull();
	});

	it('links each release that already holds the entry', () => {
		const two = [...releases, { id: 'r2', name: 'Spring', status: 'scheduled' as const }];
		render(AddToRelease, { props: { releases: two, holding: ['r1', 'r2'] } });
		expect(screen.getByText(/In 2 releases/)).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Spring' }).getAttribute('href')).toBe('/admin/releases/r2');
	});

	it('shows a refused add and not the confirmation', async () => {
		render(AddToRelease, { props: { releases, holding: [], error: 'release r1 is already published', added: true } });
		expect(await screen.findByText('release r1 is already published')).toBeTruthy();
		await twoFrames();
		expect(screen.queryByText('Added to the release.')).toBeNull();
	});

	it('shows a license refusal with its own notice', () => {
		render(AddToRelease, {
			props: { releases, holding: [], error: 'ignored', refused: { kind: 'feature', feature: 'Content releases', plugin: 'content-releases', upgradeUrl: '' } },
		});
		expect(screen.queryByText('ignored')).toBeNull();
		expect(screen.getAllByText(/Not enabled on this engine/).length).toBeGreaterThan(0);
	});

	it('confirms an add', async () => {
		render(AddToRelease, { props: { releases, holding: [], added: true } });
		expect(await screen.findByText('Added to the release.')).toBeTruthy();
	});
});
