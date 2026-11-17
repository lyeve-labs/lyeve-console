// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '$app/forms';

const forms = vi.hoisted(() => ({ submits: new Map<string, SubmitFunction>() }));
vi.mock('$app/forms', () => ({
	enhance: (el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.submits.set(el.getAttribute('action') ?? '', fn);
		return { destroy: () => {} };
	},
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));

const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

import RetentionPage from './+page.svelte';
import type { LegalHold, RetentionPolicy } from '#lib/api/retention.ts';

beforeEach(() => {
	forms.submits.clear();
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
});
afterEach(cleanup);

const policy: RetentionPolicy = {
	id: 'p1',
	event_type: 'content.delete',
	resource_type: 'article',
	retention_days: 90,
	archival_enabled: false,
	archival_storage: '',
	archival_path_prefix: '',
	tenant_id: 'default',
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
};

const hold: LegalHold = {
	id: 'h1',
	name: 'Litigation 42',
	description: '',
	filter_action: '',
	filter_resource_type: 'article',
	filter_resource_id: '',
	filter_tenant_id: '',
	tenant_id: 'default',
	created_at: '2026-10-01T00:00:00Z',
	created_by: 'u1',
};

function props(roles: string[], over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: {
			user: { id: 'u1', roles },
			policies: [policy],
			holds: { ok: true, value: [hold] },
			gate: { state: 'ok' },
			...over,
		} as never,
		form: form as never,
	};
}

// The audit plugin takes every retention write from a super admin only.
describe('Retention controls by role', () => {
	it('offers every write to a super admin', () => {
		const { container, getAllByRole } = render(RetentionPage, { props: props(['super_admin']) });
		expect(getAllByRole('button', { name: /enforce now/i })).toHaveLength(1);
		expect(getAllByRole('button', { name: /new policy/i }).length).toBeGreaterThan(0);
		expect(getAllByRole('button', { name: /new hold/i }).length).toBeGreaterThan(0);
		expect(container.querySelector('[aria-label^="Delete the policy"]')).not.toBeNull();
		expect(container.querySelector('[aria-label^="Duplicate the policy"]')).not.toBeNull();
		expect(container.querySelector('[aria-label="Release Litigation 42"]')).not.toBeNull();
	});

	it('withholds every write from an admin and says who can make them', () => {
		const { container, queryByRole } = render(RetentionPage, { props: props(['admin']) });
		expect(queryByRole('button', { name: /enforce now/i })).toBeNull();
		expect(queryByRole('button', { name: /new policy/i })).toBeNull();
		expect(queryByRole('button', { name: /new hold/i })).toBeNull();
		expect(container.querySelector('[aria-label^="Delete the policy"]')).toBeNull();
		expect(container.querySelector('[aria-label^="Duplicate the policy"]')).toBeNull();
		expect(container.querySelector('[aria-label="Release Litigation 42"]')).toBeNull();
		expect(container.textContent).toContain('Only a super admin can change a retention policy');
	});
});

describe('Retention enforcement outcome', () => {
	it('keeps a warning naming the policy whose archive failed', () => {
		const { container } = render(RetentionPage, {
			props: props(['super_admin'], {}, { enforced: true, deleted: 0, policies: 1, archiveFailed: ['content.delete'] }),
		});
		const warning = [...container.querySelectorAll('[role="alert"], [role="status"]')].find((n) =>
			n.textContent?.includes('Archiving failed for content.delete'),
		);
		expect(warning).toBeTruthy();
		expect(container.textContent).toContain('nothing that policy covers was deleted');
	});
});

describe('Retention policy delete', () => {
	it('names the policy in the confirmation title', async () => {
		render(RetentionPage, { props: props(['super_admin']) });
		const submit = forms.submits.get('?/deletePolicy');
		expect(submit).toBeTypeOf('function');
		await submit?.({ cancel: vi.fn() } as never);
		const [title] = kit.confirm.mock.calls[0] as unknown as [string];
		expect(title).toBe('Delete the policy covering content.delete on article?');
	});
});

describe('Retention drawers', () => {
	it('shows a refused policy inside the open drawer', async () => {
		const { getAllByRole } = render(RetentionPage, {
			props: props(['super_admin'], {}, {
				action: 'createPolicy',
				error: 'Enter a whole number of days, 0 or more.',
			}),
		});
		await fireEvent.click(getAllByRole('button', { name: /new policy/i })[0]);
		const form = document.getElementById('policy-form') as HTMLFormElement;
		expect(form.textContent).toContain('Enter a whole number of days, 0 or more.');
	});

	// The engine stores a policy that does not mention archival with it off,
	// and the form starts from the same default.
	it('starts a new policy with archival off, as the engine does', async () => {
		const { getAllByRole } = render(RetentionPage, { props: props(['super_admin']) });
		await fireEvent.click(getAllByRole('button', { name: /new policy/i })[0]);
		const form = document.getElementById('policy-form') as HTMLFormElement;
		const archival = form.querySelector('input[name="archival_enabled"]') as HTMLInputElement;
		expect(archival.value).toBe('false');
	});
});

describe('Retention failures stay where they were made', () => {
	it('shows a failed row action on the page and opens the next drawer clean', async () => {
		const failed = 'Could not delete the policy. Try again.';
		const { getAllByRole, container } = render(RetentionPage, {
			props: props(['super_admin'], {}, { action: 'deletePolicy', error: failed }),
		});
		expect(container.textContent).toContain(failed);
		await fireEvent.click(getAllByRole('button', { name: /new policy/i })[0]);
		const form = document.getElementById('policy-form') as HTMLFormElement;
		expect(form.textContent).not.toContain(failed);
	});

	it('keeps a refused hold out of the policy drawer and off the page', async () => {
		const { getAllByRole, container } = render(RetentionPage, {
			props: props(['super_admin'], {}, { action: 'createHold', error: 'Enter a name for the hold.' }),
		});
		expect(container.textContent).not.toContain('Enter a name for the hold.');
		await fireEvent.click(getAllByRole('button', { name: /new policy/i })[0]);
		expect((document.getElementById('policy-form') as HTMLFormElement).textContent).not.toContain('Enter a name for the hold.');
	});
});

describe('Retention holds that could not be read', () => {
	it('says so instead of reporting that nothing is held', () => {
		const { container } = render(RetentionPage, {
			props: props(['super_admin'], {
				holds: {
					ok: false,
					gate: {
						state: 'error',
						message: 'Could not load the legal holds.',
					},
				},
			}),
		});
		expect(container.textContent).toContain('Could not load the legal holds.');
		expect(container.textContent).not.toContain('No legal holds yet');
	});
});

describe('the outcome of an enforcement run', () => {
	it('says how many entries were deleted across how many policies', async () => {
		const { container } = render(RetentionPage, { props: props(['super_admin'], {}, { enforced: true, deleted: 12, policies: 2 }) });
		await vi.waitFor(() => expect(container.textContent).toContain('Retention enforced across 2 policies.'));
		expect(container.textContent).toContain('12 entries were deleted.');
	});

	it('speaks of one policy and one entry in the singular', async () => {
		const { container } = render(RetentionPage, { props: props(['super_admin'], {}, { enforced: true, deleted: 1, policies: 1 }) });
		await vi.waitFor(() => expect(container.textContent).toContain('across 1 policy.'));
		expect(container.textContent).toContain('1 entry was deleted.');
	});
});
