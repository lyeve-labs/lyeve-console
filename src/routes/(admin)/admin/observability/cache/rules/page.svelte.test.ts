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
	pattern: '/api/v1/content/posts/**',
	ttl_seconds: 3600,
	tags: ['posts'],
	enabled: true,
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
};

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		rules: { gate: { state: 'ok' }, rows: [rule], licensed: false, limit: { limit: 10, current: 1 } },
		gate: { state: 'ok' },
		...over,
	} as never,
	form: form as never,
});

describe('response cache rules', () => {
	it('counts the rules against the ceiling the plugin stated', () => {
		const { container } = render(RulesPage, { props: props() });
		expect(said(container)).toContain('1 of 10 rules');
		expect(said(container)).toContain('/api/v1/content/posts/**');
		expect(said(container)).toContain('1 h');
	});

	it('warns at the ceiling with the stated numbers', () => {
		const { container } = render(RulesPage, {
			props: props({
				rules: { gate: { state: 'ok' }, rows: [rule], licensed: false, limit: { limit: 10, current: 10 } },
			}),
		});
		expect(said(container)).toContain('10 of 10 rules');
		expect(said(container)).toContain('All available rules are in use');
	});

	it('shows the count alone when the install holds no ceiling', () => {
		const { container } = render(RulesPage, {
			props: props({
				rules: { gate: { state: 'ok' }, rows: [rule], licensed: true, limit: { limit: null, current: 1 } },
			}),
		});
		expect(said(container)).toContain('1 rule');
		expect(said(container)).not.toContain('of 10');
	});

	it('shows the empty state when no rule exists', () => {
		const { container } = render(RulesPage, {
			props: props({ rules: { gate: { state: 'ok' }, rows: [], licensed: false, limit: { limit: 10, current: 0 } } }),
		});
		expect(said(container)).toContain('No response cache rules yet');
		expect(said(container)).toContain('0 of 10 rules');
	});

	it('reports a failed rules read as a failure, not as no rules', () => {
		const { container } = render(RulesPage, {
			props: props({ rules: { gate: { state: 'error', message: 'The rules could not be read.' }, rows: [], licensed: null } }),
		});
		expect(said(container)).toContain('The rules could not be read.');
		expect(said(container)).not.toContain('No response cache rules yet');
	});

	it('renders a ceiling refusal from the action through the refusal notice', () => {
		render(RulesPage, {
			props: props({}, { error: 'x', refused: { kind: 'cap', cap: 'example.rules', limit: 10, current: 10, upgradeUrl: '' } }),
		});
		expect(screen.getAllByTestId('refusal-notice')[0].textContent).toContain("You're using 10 of 10 rules");
	});

	it('offers purge by rule, by tag and for everything', () => {
		render(RulesPage, { props: props() });
		expect(screen.getByRole('button', { name: 'Purge /api/v1/content/posts/**' })).toBeTruthy();
		expect(screen.getByRole('button', { name: /Purge all/ })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Purge tag' })).toBeTruthy();
	});

	it('waits on New rule at the ceiling, with the warning as its reason', () => {
		render(RulesPage, {
			props: props({
				rules: { gate: { state: 'ok' }, rows: [rule], licensed: false, limit: { limit: 10, current: 10 } },
			}),
		});
		const button = screen.getByRole('button', { name: /New rule/ }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		expect(button.getAttribute('aria-describedby')).toBe('rules-full');
		expect(document.getElementById('rules-full')?.textContent).toContain('All available rules are in use');
	});

	it('leaves New rule live below the ceiling', () => {
		render(RulesPage, { props: props() });
		expect((screen.getByRole('button', { name: /New rule/ }) as HTMLButtonElement).disabled).toBe(false);
	});
});

describe('a failed rule save', () => {
	// The message went to the page behind the drawer, so the open panel said
	// nothing about why the save did not happen.
	it('is said at the top of the open form', async () => {
		render(RulesPage, { props: props({}, { error: 'A rule needs a route pattern.', drawer: 'rule' }) });
		await fireEvent.click(screen.getAllByRole('button', { name: /New rule/ })[0]);
		const form = document.querySelector('#cache-rule-form') as HTMLFormElement;
		expect(form.textContent).toContain('A rule needs a route pattern.');
	});

	// A failed delete, purge, flush or circuit reset belongs to the page. Read
	// by the drawer, it greeted the next New rule as that rule's failure.
	it('keeps a failure from a row out of the drawer', async () => {
		const { container } = render(RulesPage, { props: props({}, { error: 'Could not delete the rule. Try again.' }) });
		expect(said(container)).toContain('Could not delete the rule. Try again.');
		await fireEvent.click(screen.getAllByRole('button', { name: /New rule/ })[0]);
		const form = document.querySelector('#cache-rule-form') as HTMLFormElement;
		expect(form.textContent).not.toContain('Could not delete the rule. Try again.');
	});
});

describe('the gate', () => {
	it('says the plugin is absent rather than showing an empty page', () => {
		const { container } = render(RulesPage, { props: props({ gate: { state: 'absent' }, rules: { gate: { state: 'absent' }, rows: [], licensed: null } }) });
		expect(said(container)).toContain('The cache is not included in this build.');
		expect(said(container)).not.toContain('No response cache rules yet');
	});
});
