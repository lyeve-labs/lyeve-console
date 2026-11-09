// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://admin/admin/settings/privacy') } }));

import PrivacyPage from './+page.svelte';
import { NO_TENANT } from '$lib/api/privacy';

afterEach(cleanup);

// A confirmation takes its text two frames after it mounts, so a test that
// says one is absent looks only after those frames have passed.
async function twoFrames(): Promise<void> {
	await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
	await tick();
}

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const props = (data: Record<string, unknown>, form: unknown = null) => ({
	data: { noTenant: false, formErasure: { ok: true, value: { mode: 'auto' } }, exportSections: null, exportRoles: null, ...data } as never,
	form: form as never,
});

describe('privacy settings: form submissions on erasure', () => {
	it('shows the stored mode as chosen, with a sentence for each mode', () => {
		const { container } = render(PrivacyPage, { props: props({ formErasure: { ok: true, value: { mode: 'hard' } } }) });
		const chosen = container.querySelector('input[name="mode"]:checked') as HTMLInputElement;
		expect(chosen.value).toBe('hard');
		expect(said(container)).toContain("When it also holds someone else's address, clear only the person's own values.");
		expect(said(container)).toContain('No submission is deleted.');
	});

	it('draws a failed read as a failure with a way to try again', () => {
		const { container } = render(PrivacyPage, {
			props: props({ formErasure: { ok: false, gate: { state: 'error', message: 'It could not be read.' } } }),
		});
		expect(said(container)).toContain('It could not be read.');
		expect(screen.getByRole('link', { name: /try again/i })).toBeTruthy();
		expect(container.querySelector('input[name="mode"]')).toBeNull();
	});

	it('leaves the setting out while its routes do not answer', () => {
		const { container } = render(PrivacyPage, { props: props({ formErasure: null }) });
		expect(said(container)).not.toContain('Form submissions on erasure');
		expect(said(container)).toContain('None of these settings apply to this engine');
	});

	it('says why the card is empty while its plugin is stopped', () => {
		const { container } = render(PrivacyPage, {
			props: props({ formErasure: { ok: false, stopped: { state: 'not-built' } } }),
		});
		const notice = screen.getByTestId('not-running');
		expect(notice.dataset.state).toBe('not-built');
		expect(said(container)).toContain('Form submissions on erasure');
		expect(container.querySelector('input[name="mode"]')).toBeNull();
		expect(said(container)).not.toContain('None of these settings apply');
	});

	it('says once that the session names no tenant, with nothing to retry and no card', () => {
		const { container } = render(PrivacyPage, { props: props({ noTenant: true, formErasure: null }) });
		expect(said(container).split(NO_TENANT)).toHaveLength(2);
		expect(screen.queryByRole('link', { name: /try again/i })).toBeNull();
		expect(container.querySelector('form')).toBeNull();
		expect(said(container)).not.toContain('None of these settings apply');
	});

	it('confirms a save with a confirmation that clears itself', async () => {
		const { container } = render(PrivacyPage, { props: props({}, { action: 'erasure', saved: true }) });
		await vi.waitFor(() => expect(said(container)).toContain('Saved. The next erasure in this tenant follows this choice.'));
	});

	it('shows a failed save on the form that made it', async () => {
		const { container } = render(PrivacyPage, {
			props: props({}, { action: 'erasure', error: 'The choice could not be saved.' }),
		});
		await vi.waitFor(() => expect(said(container)).toContain('The choice could not be saved.'));
		await twoFrames();
		expect(said(container)).not.toContain('Saved.');
	});
});

const sections = {
	ok: true,
	value: {
		sections: [
			{ section: 'engine', offered: true },
			{ section: 'analytics', offered: false },
			{ section: 'some-new-part', offered: true },
		],
		excluded: ['analytics', 'media'],
	},
};

describe('privacy settings: what a person may include', () => {
	it('ticks the offered sections and names each in plain words', () => {
		const { container } = render(PrivacyPage, { props: props({ exportSections: sections }) });
		const ticked = [...container.querySelectorAll('input[name="offered"]:checked')].map((i) => (i as HTMLInputElement).value);
		expect(ticked).toEqual(['engine', 'some-new-part']);
		expect(said(container)).toContain('Account');
		expect(said(container)).toContain('Content, uploads and activity');
		expect(said(container)).toContain('Some new part');
	});

	it('says which left-out sections are not available now and posts them to stay left out', () => {
		const { container } = render(PrivacyPage, { props: props({ exportSections: sections }) });
		expect(said(container)).toContain('Also left out: Media.');
		const form = container.querySelector('form[action="?/sections"]') as HTMLFormElement;
		expect(new FormData(form).getAll('kept')).toEqual(['media']);
		expect(new FormData(form).getAll('available')).toEqual(['engine', 'analytics', 'some-new-part']);
	});

	it('draws a failed read as a failure, not as nothing offered', () => {
		const { container } = render(PrivacyPage, {
			props: props({ exportSections: { ok: false, gate: { state: 'unavailable' } } }),
		});
		expect(said(container)).toContain('did not load');
		expect(container.querySelector('input[name="offered"]')).toBeNull();
	});
});

describe('privacy settings: who may export', () => {
	it('shows every role as chosen when the stored list is empty, and offers no role list', () => {
		const { container } = render(PrivacyPage, { props: props({ exportRoles: { ok: true, value: { roles: [] } } }) });
		const scope = container.querySelector('input[name="scope"]') as HTMLInputElement;
		expect(scope.value).toBe('every');
		expect(container.querySelector('input[name="roles"]')).toBeNull();
		expect(said(container)).toContain('An administrator can always export.');
	});

	it("offers the user editor's roles less the two that always export, and keeps a custom one already chosen", () => {
		const { container } = render(PrivacyPage, {
			props: props({ exportRoles: { ok: true, value: { roles: ['editor', 'auditor', 'admin'] } } }),
		});
		const offered = [...container.querySelectorAll('input[name="roles"]')].map((i) => (i as HTMLInputElement).value);
		expect(offered).toEqual(['viewer', 'editor', 'auditor']);
		const ticked = [...container.querySelectorAll('input[name="roles"]:checked')].map((i) => (i as HTMLInputElement).value);
		expect(ticked).toEqual(['editor', 'auditor']);
	});

	it('reads a list naming only admin as chosen roles with none ticked', () => {
		const { container } = render(PrivacyPage, { props: props({ exportRoles: { ok: true, value: { roles: ['admin'] } } }) });
		expect((container.querySelector('input[name="scope"]') as HTMLInputElement).value).toBe('chosen');
		expect(container.querySelectorAll('input[name="roles"]:checked')).toHaveLength(0);
	});

	it('confirms a save on its own card only', async () => {
		const { container } = render(PrivacyPage, {
			props: props({ exportRoles: { ok: true, value: { roles: [] } } }, { action: 'roles', saved: true }),
		});
		await vi.waitFor(() => expect(said(container)).toContain('Saved. The next export follows this choice.'));
		expect(said(container)).not.toContain('Saved. The next erasure');
	});

	it('shows a license refusal on save with its way forward, on the card that saved', () => {
		const refused = { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' };
		const { container } = render(PrivacyPage, {
			props: props(
				{ exportSections: sections, exportRoles: { ok: true, value: { roles: [] } } },
				{ action: 'roles', error: 'This needs example-feature.', refused },
			),
		});
		const rolesForm = container.querySelector('form[action="?/roles"]') as HTMLFormElement;
		expect(rolesForm.querySelector('[data-testid="refusal-notice"]')).not.toBeNull();
		expect(container.querySelector('form[action="?/sections"] [data-testid="refusal-notice"]')).toBeNull();
	});

	it('says once why both export cards are missing while their plugin is stopped', () => {
		const stopped = { ok: false, stopped: { state: 'not-started', reason: '' } };
		const { container } = render(PrivacyPage, { props: props({ exportSections: stopped, exportRoles: stopped }) });
		const notices = [...container.querySelectorAll('[data-testid="not-running"]')] as HTMLElement[];
		expect(notices).toHaveLength(1);
		expect(notices[0].dataset.plugin).toBe('analytics');
		expect(container.querySelector('form[action="?/sections"]')).toBeNull();
		expect(container.querySelector('form[action="?/roles"]')).toBeNull();
	});

	it('shows the page when only the export settings answer', () => {
		const { container } = render(PrivacyPage, {
			props: props({ formErasure: null, exportRoles: { ok: true, value: { roles: [] } } }),
		});
		expect(said(container)).not.toContain('None of these settings apply');
		expect(said(container)).not.toContain('Form submissions on erasure');
	});
});
