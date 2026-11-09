// @vitest-environment jsdom
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import RulesPage from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const rule = {
	id: 'r1',
	route_pattern: '/api/v1/orders/**',
	method: 'POST',
	sample_rate: 0.25,
	retention_seconds: 30 * 86400,
	enabled: true,
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
};

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		rules: [rule],
		rulesRead: true,
		rulesGate: null,
		licensed: true,
		gate: { state: 'ok' },
		...over,
	} as never,
	form: form as never,
});

describe('capture rules', () => {
	it('lists each rule with its method, sample and retention in words', () => {
		const { container } = render(RulesPage, { props: props() });
		expect(said(container)).toContain('/api/v1/orders/**');
		expect(said(container)).toContain('25%');
		expect(said(container)).toContain('30 days');
		expect(said(container)).toContain('Only requests that match an enabled rule are kept');
	});

	it('says every request is kept for a day when no rule exists', () => {
		const { container } = render(RulesPage, { props: props({ rules: [] }) });
		expect(said(container)).toContain('No capture rule');
		expect(said(container)).toContain('every request is kept for a day');
	});

	it('says what is not included when the plugin answers unlicensed', () => {
		const { container } = render(RulesPage, { props: props({ licensed: false }) });
		expect(said(container)).toContain('Capture rules and replay sets are not included');
	});

	// The note said the license was missing while New rule stayed live, so a
	// reader filled in a rule only to be refused on save.
	it('offers no new rule the license refuses', () => {
		const { getAllByRole } = render(RulesPage, { props: props({ licensed: false, rules: [] }) });
		const newRule = getAllByRole('button', { name: /New rule/ });
		expect(newRule.length).toBeGreaterThan(0);
		for (const b of newRule) {
			expect((b as HTMLButtonElement).disabled).toBe(true);
			expect(b.getAttribute('title')).toBe('Not included in this license');
		}
	});

	it('keeps New rule live on a licensed install', () => {
		const { getAllByRole } = render(RulesPage, { props: props({ licensed: true }) });
		expect((getAllByRole('button', { name: /New rule/ })[0] as HTMLButtonElement).disabled).toBe(false);
	});

	it('reports a failed rules read as a failure', () => {
		const { container } = render(RulesPage, { props: props({ rules: [], rulesRead: false }) });
		expect(said(container)).toContain('Could not load capture rules');
		expect(said(container)).not.toContain('No capture rule');
	});

	it('renders a refused create through the refusal notice', () => {
		render(RulesPage, {
			props: props({}, { error: 'x', refused: { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' } }),
		});
		expect(screen.getAllByTestId('refusal-notice').length).toBeGreaterThan(0);
	});
});

describe('the gate', () => {
	it('says the plugin is absent rather than showing an empty list', () => {
		const { container } = render(RulesPage, { props: props({ gate: { state: 'absent' }, rules: [], rulesRead: false }) });
		expect(said(container)).toContain('not included in this build');
		expect(said(container)).not.toContain('No capture rules yet');
	});
});

describe('a failed rule save', () => {
	// The message went to the page behind the drawer, so the open panel said
	// nothing about why the save did not happen.
	it('is said at the top of the open form', async () => {
		render(RulesPage, { props: props({}, { error: 'A route is an absolute path.', drawer: 'rule' }) });
		await fireEvent.click(screen.getAllByRole('button', { name: /New rule/ })[0]);
		const form = document.querySelector('#capture-rule-form') as HTMLFormElement;
		expect(form.textContent).toContain('A route is an absolute path.');
	});

	it('says a failed row action on the page and not in the drawer', async () => {
		const { container } = render(RulesPage, { props: props({}, { error: 'Could not delete the rule. Try again.' }) });
		expect(said(container)).toContain('Could not delete the rule. Try again.');
		await fireEvent.click(screen.getAllByRole('button', { name: /New rule/ })[0]);
		const form = document.querySelector('#capture-rule-form') as HTMLFormElement;
		expect(form.textContent).not.toContain('Could not delete');
	});
});

describe('editing a rule without the license', () => {
	// The plugin refuses any change that leaves a rule enabled, so the drawer
	// could only fail. Switching the rule off stays allowed.
	it('offers no edit of an enabled rule, and offers to switch it off', () => {
		const { container } = render(RulesPage, { props: props({ licensed: false }) });
		const edit = screen.getByRole('button', { name: `Edit ${rule.route_pattern}` }) as HTMLButtonElement;
		expect(edit.disabled).toBe(true);
		expect(edit.getAttribute('title')).toContain('Not included in this license');
		const off = screen.getByRole('button', { name: `Switch off ${rule.route_pattern}` });
		const form = off.closest('form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/updateRule');
		expect((form.querySelector('input[name="enabled"]') as HTMLInputElement).value).toBe('false');
		expect((form.querySelector('input[name="from"]') as HTMLInputElement).value).toBe('row');
		void container;
	});

	it('keeps Edit live on a licensed install', () => {
		render(RulesPage, { props: props({ licensed: true }) });
		expect((screen.getByRole('button', { name: `Edit ${rule.route_pattern}` }) as HTMLButtonElement).disabled).toBe(false);
		expect(screen.queryByRole('button', { name: `Switch off ${rule.route_pattern}` })).toBeNull();
	});
});
