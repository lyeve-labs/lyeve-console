// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));

import PiiPage from './+page.svelte';

afterEach(cleanup);

const said = (c: HTMLElement) => (c.textContent ?? '').replace(/\s+/g, ' ');

const rules = {
	presets: [
		{ name: 'CARD', priority: 20, pattern: '\\d{13,19}', replacement: '[redacted]' },
		{ name: 'EMAIL', priority: 5, pattern: '\\S+@\\S+', replacement: '[email]' },
	],
	mask_tags: { email: 'Partial email masking', secret: 'Full redaction to [redacted]' },
};

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		rules,
		gate: { state: 'ok' },
		licensed: true,
		...over,
	} as never,
	// The page reports the outcome of a save, so it takes the form prop every
	// page with actions takes.
	form: form as never,
});

describe('PII masking gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(PiiPage, { props: props({ gate: { state: 'locked', upgradeUrl: '' } }) });
		expect(said(container)).toContain('Not enabled on this engine');
	});

	it('says responses are served as stored when the plugin is absent', () => {
		const { container } = render(PiiPage, {
			props: props({ gate: { state: 'absent' }, rules: null }),
		});
		expect(said(container)).toContain('Responses are not masked');
	});
});

describe('PII masking rules', () => {
	it('carries the strip with Rules marked, and leaves the reads to their own page', () => {
		const { getByRole, container } = render(PiiPage, { props: props() });
		expect(getByRole('tab', { name: 'Rules' }).getAttribute('aria-selected')).toBe('true');
		expect(container.querySelector('#pii-narrow')).toBeNull();
	});

	it('lists the rules in the order they run, not the order they arrived', () => {
		const { container } = render(PiiPage, { props: props() });
		const text = said(container);
		expect(text.indexOf('EMAIL')).toBeLessThan(text.indexOf('CARD'));
	});

	it('says plainly that no rule is loaded rather than drawing an empty table', () => {
		const { container } = render(PiiPage, {
			props: props({ rules: { presets: [], mask_tags: {} } }),
		});
		expect(said(container)).toContain('No rule is loaded, so responses are not masked.');
	});

	it('names each mask style a field can ask for', () => {
		const { container } = render(PiiPage, { props: props() });
		expect(said(container)).toContain('Partial email masking');
	});
});

/*
 * A tenant's own rules.
 *
 * The presets are compiled in and cannot be edited, so a rule that names one
 * takes its place instead. That is the only way to narrow or switch off a
 * preset, and the preset list has to say which of its rows are no longer
 * running or it reads as a promise the engine is not keeping.
 */
describe('custom PII rules', () => {
	const rule = (over: Record<string, unknown> = {}) => ({
		id: 'r1',
		name: 'ACCOUNT',
		description: 'Our account numbers',
		pattern: '\\bACC-\\d{6}\\b',
		replacement: '[redacted-account]',
		priority: 100,
		enabled: true,
		...over,
	});

	it('lists a tenant rule beside the presets', () => {
		const { container } = render(PiiPage, {
			props: props({
				rules: { presets: [], custom: [rule()], mask_tags: {} },
			}),
		});
		expect(said(container)).toContain('ACCOUNT');
		expect(said(container)).toContain('Our account numbers');
	});

	// The delete is a form in the row, so the id it posts is the row's own.
	it('deletes a rule through a form in its row that posts the rule id', () => {
		const { getByRole } = render(PiiPage, {
			props: props({ rules: { presets: [], custom: [rule()], mask_tags: {} } }),
		});
		const form = getByRole('button', { name: 'Delete ACCOUNT' }).closest('form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/delete');
		expect(new FormData(form).get('id')).toBe('r1');
	});

	it('names RE2, because a PCRE pattern fails within minutes', () => {
		const { container } = render(PiiPage, {
			props: props({ rules: { presets: [], custom: [], mask_tags: {} } }),
		});
		expect(said(container)).toContain('RE2');
	});

	it('says a preset has been replaced rather than listing it as running', () => {
		const { container } = render(PiiPage, {
			props: props({
				rules: {
					presets: [
						{ name: 'EMAIL', pattern: 'x', replacement: '[e]', priority: 10 },
						{ name: 'PHONE', pattern: 'y', replacement: '[p]', priority: 20 },
					],
					custom: [rule({ name: 'EMAIL' })],
					mask_tags: {},
				},
			}),
		});
		expect(said(container)).toContain('replaced by yours');
	});

	// The presets alone miss the tenant's own rules and count a preset that a
	// custom rule has taken out of the path.
	it('counts what is running, not what shipped', () => {
		const { container } = render(PiiPage, {
			props: props({
				rules: {
					presets: [
						{ name: 'EMAIL', pattern: 'x', replacement: '[e]', priority: 10 },
						{ name: 'PHONE', pattern: 'y', replacement: '[p]', priority: 20 },
					],
					// One replaces EMAIL, one is off. So PHONE plus the override.
					custom: [rule({ name: 'EMAIL' }), rule({ id: 'r2', name: 'OFF', enabled: false })],
					limits: { max_pattern_length: 512, max_enabled_rules: 50 },
					mask_tags: {},
				},
			}),
		});
		expect(said(container)).toContain('1 of 50');
	});

	it('offers somewhere to add one when the tenant has none', () => {
		const { container } = render(PiiPage, {
			props: props({ rules: { presets: [], custom: [], mask_tags: {} } }),
		});
		expect(said(container)).toContain('No rules of your own');
	});

	/**
	 * The tester is inside the drawer, because that is where a pattern is being
	 * written. Opening it is part of what these assert: a result rendered on
	 * the page behind would belong to a rule nobody is editing.
	 */
	const withResult = async (test: unknown) => {
		const rendered = render(PiiPage, {
			props: {
				...props({ rules: { presets: [], custom: [], mask_tags: {} } }),
				form: { test } as never,
			},
		});
		await fireEvent.click(rendered.getByRole('button', { name: /New rule/ }));
		return rendered.container;
	};

	// The commonest way a rule is wrong: it saves, it enables, and it hides
	// nothing. No other screen would ever say so.
	it('warns when a valid pattern matched nothing in the sample', async () => {
		const container = await withResult({ valid: true, matches: [], count: 0, masked: 'untouched' });
		expect(said(container)).toContain('matched nothing');
	});

	it('shows what a reader would get when the pattern does match', async () => {
		const container = await withResult({
			valid: true,
			matches: ['ACC-123456'],
			count: 1,
			masked: 'paid [redacted-account]',
		});
		expect(said(container)).toContain('paid [redacted-account]');
	});

	it('reports a pattern that does not compile', async () => {
		const container = await withResult({ valid: false, error: 'pattern does not compile as RE2' });
		expect(said(container)).toContain('does not compile');
	});
});

describe('PII rule drawer', () => {
	it('shows a refused save inside the open drawer', async () => {
		const { getAllByRole } = render(PiiPage, {
			props: props({}, { action: 'create', error: 'pattern does not compile: missing closing )' }),
		});
		await fireEvent.click(getAllByRole('button', { name: /new rule/i })[0]);
		const form = document.querySelector('form[action="?/create"]') as HTMLFormElement;
		expect(form.textContent).toContain('pattern does not compile');
	});
});

describe('PII failures stay where they were made', () => {
	it('shows a failed delete on the page and opens the rule drawer clean', async () => {
		const { getAllByRole, container } = render(PiiPage, {
			props: props({}, { action: 'delete', error: 'Could not delete the rule. Try again.' }),
		});
		expect(said(container)).toContain('Could not delete the rule. Try again.');
		await fireEvent.click(getAllByRole('button', { name: /new rule/i })[0]);
		const form = document.querySelector('form[action="?/create"]') as HTMLFormElement;
		expect(form.textContent).not.toContain('Could not delete');
	});

	it('reports a failed dry run under the sample, not as a failed save', async () => {
		const { getAllByRole } = render(PiiPage, {
			props: props({}, { action: 'test', error: 'Could not run the pattern. Try again.' }),
		});
		await fireEvent.click(getAllByRole('button', { name: /new rule/i })[0]);
		const save = document.querySelector('form[action="?/create"]') as HTMLFormElement;
		expect(save.textContent).not.toContain('Could not run');
	});
});
