// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import ConfigSyncPage from './+page.svelte';

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const plan = {
	sections: {
		flows: { changes: [{ key: 'notify', action: 'create' }, { key: 'old', action: 'delete' }] },
		schemas: {
			changes: [
				{ key: 'articles', action: 'update', fields: ['title'] },
				{ key: 'legacy', action: 'unchanged', note: 'only on this engine, and kept' },
				{ key: 'tags', action: 'unchanged' },
			],
		},
	},
	changes: 3,
	problems: 0,
};

function setup(form: unknown = null, data: Record<string, unknown> = {}) {
	return render(ConfigSyncPage, { props: { data, form } as never });
}

describe('config sync page', () => {
	it('offers both forms and holds every write until a bundle is loaded', () => {
		const { getByTestId, getByRole } = setup();
		expect(getByTestId('export-form')).toBeTruthy();
		expect((getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(true);
		for (const name of ['Compare', 'Dry run', 'Apply']) {
			expect((getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
		}
	});

	it('offers the exported bundle as a download', () => {
		vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:bundle'), revokeObjectURL: vi.fn() }));
		const { getByRole } = setup({ scope: 'export', bundle: '{"format":"lyeve-config"}', filename: 'lyeve-config-2026-10-02.json', sections: ['schemas', 'flows'] });
		const link = getByRole('link', { name: /Download lyeve-config-2026-10-02.json/ });
		expect(link.getAttribute('download')).toBe('lyeve-config-2026-10-02.json');
		expect(link.getAttribute('href')).toBe('blob:bundle');
	});

	it('keeps the secrets caveat beside the download, outside the outcome that clears itself', async () => {
		vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:bundle'), revokeObjectURL: vi.fn() }));
		const { findByText, getByRole, getByText } = setup({ scope: 'export', bundle: '{}', filename: 'b.json', sections: [] });
		await findByText('The bundle is ready.');
		const caveat = getByText('Anyone holding the bundle and the passphrase can read every secret in it.');
		expect(caveat.closest('[aria-live], [role="alert"]')).toBeNull();
		expect(getByRole('link', { name: /Download b.json/ }).parentElement?.contains(caveat)).toBe(true);
	});

	it('lists the plan per section, content types first, with the count of each change', () => {
		const { getByTestId } = setup({ scope: 'sync', mode: 'diff', plan });
		const sections = getByTestId('sync-plan').querySelectorAll('[data-testid^="plan-section-"]');
		expect([...sections].map((s) => s.getAttribute('data-testid'))).toEqual(['plan-section-schemas', 'plan-section-flows']);
		const schemas = getByTestId('plan-section-schemas').textContent ?? '';
		expect(schemas).toContain('1 update');
		expect(schemas).toContain('2 unchanged');
		expect(schemas).toContain('only on this engine, and kept');
		expect(schemas).not.toContain('tags');
		const flows = getByTestId('plan-section-flows').textContent ?? '';
		expect(flows).toContain('1 create');
		expect(flows).toContain('1 delete');
	});

	it('says a dry run wrote nothing', () => {
		const { getByTestId } = setup({ scope: 'sync', mode: 'dry-run', plan });
		expect(getByTestId('sync-plan').textContent).toContain('Nothing was written');
	});

	it('names every problem and the capability that lifts it', () => {
		const blocked = { sections: { flows: { changes: [], problems: [{ key: 'big', message: 'uses a node this instance does not enable', feature: 'feature:example-capability' }] } }, changes: 0, problems: 1 };
		const { getByTestId } = setup({ scope: 'sync', mode: 'dry-run', plan: blocked });
		const text = getByTestId('sync-plan').textContent ?? '';
		expect(text).toContain('1 problem stops the apply');
		expect(text).toContain('uses a node this instance does not enable');
		expect(text).toContain('(needs example-capability)');
	});

	it('says where a partial apply stopped and what it kept', () => {
		const { getByTestId } = setup({
			scope: 'sync',
			mode: 'apply',
			error: 'The apply stopped partway.',
			plan,
			result: {
				applied: false,
				plan,
				schemas_applied: ['articles'],
				not_applied: ['flows', 'webhooks'],
				failed: { section: 'flows', key: 'notify', message: 'the section could not be written, so every section in this step was rolled back' },
			},
		});
		const text = getByTestId('apply-failure').textContent ?? '';
		expect(text).toContain('Flows, notify');
		expect(text).toContain('The section could not be written');
		expect(text).toContain('articles');
		expect(text).toContain('Flows, Webhooks');
	});

	it('renders a refused write as the refusal notice, with the forms still there', () => {
		const { getByTestId } = setup({ scope: 'sync', mode: 'diff', error: 'x', refused: { kind: 'feature', feature: 'example-capability', plugin: 'example', upgradeUrl: '' } });
		expect(getByTestId('refusal-notice').textContent).toContain('Not enabled on this engine');
		expect(getByTestId('export-form')).toBeTruthy();
		expect(getByTestId('sync-form')).toBeTruthy();
	});

	it('shows a refused request in words, with no plan', () => {
		const { getByText, queryByTestId } = setup({ scope: 'sync', mode: 'diff', error: 'the passphrase does not open this bundle' });
		expect(getByText('the passphrase does not open this bundle')).toBeTruthy();
		expect(queryByTestId('sync-plan')).toBeNull();
	});
});
