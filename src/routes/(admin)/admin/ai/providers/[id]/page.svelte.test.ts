// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';
import { fixtureLocalProvider, fixtureProvider, fixtureSettings } from '$lib/components/ai/test-support/fixtures';
import { outlineSkips } from '$lib/test-outline';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

function setup(overrides: Record<string, unknown> = {}, form: unknown = null) {
	return render(Page, {
		props: {
			data: {
				gate: { state: 'ok' },
				provider: fixtureProvider,
				aiSettings: fixtureSettings,
				aiLayoutGate: { state: 'ok' },
				isSuperAdmin: true,
				...overrides,
			},
			form,
		} as never,
	});
}

/** Every heading level in document order, so a test can say none is skipped. */
function levels(root: HTMLElement): number[] {
	return [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.tagName.slice(1)));
}

function skips(list: number[]): boolean {
	return list.some((level, i) => level > (i === 0 ? 1 : list[i - 1]) + 1);
}

describe('AI provider detail page', () => {
	it('puts Models and Capabilities at level 2, with no level skipped', () => {
		const { container, getByRole } = setup();
		expect(getByRole('heading', { level: 2, name: 'Models' })).toBeTruthy();
		expect(getByRole('heading', { level: 2, name: 'Capabilities' })).toBeTruthy();
		expect(skips(levels(container))).toBe(false);
	});

	it('shows a stored key as a placeholder and keeps it on a blank save', () => {
		const { container } = setup();
		const key = container.querySelector('input[name="api_key"]') as HTMLInputElement;
		expect(key.placeholder).toBe('Stored');
		expect(key.required).toBe(false);
		expect(container.textContent).toContain('Leave this blank to keep it.');
	});

	it('shows the compatible fields and the private-address warning for a super admin', () => {
		const { container, getByText } = setup({ provider: fixtureLocalProvider });
		expect((container.querySelector('input[name="base_url"]') as HTMLInputElement).value).toBe('http://localhost:11434/v1');
		expect(container.querySelector('input[name="key_header"]')).toBeTruthy();
		expect(container.querySelector('input[name="query_string"]')).toBeTruthy();
		expect(getByText(/skip the private-address check/)).toBeTruthy();
		expect(getByText(/Enter it again/)).toBeTruthy();
	});

	// The form a super admin came to change sat under two checks. It now
	// follows the facts it edits.
	it('puts the configuration directly under the facts, above the checks', () => {
		const { container } = setup();
		const headings = [...container.querySelectorAll('h2')].map((h) => h.textContent?.trim());
		expect(headings.indexOf('Configuration')).toBeGreaterThanOrEqual(0);
		expect(headings.indexOf('Configuration')).toBeLessThan(headings.indexOf('Models'));
		expect(headings.indexOf('Models')).toBeLessThan(headings.indexOf('Capabilities'));
	});

	it('hides the configuration form from a tenant admin and keeps the reads', () => {
		const { container, getByText, queryByText } = setup({ isSuperAdmin: false });
		expect(container.querySelector('form[action="?/update"]')).toBeNull();
		expect(queryByText('Configuration')).toBeNull();
		expect(getByText('List models')).toBeTruthy();
		expect(getByText('Check')).toBeTruthy();
	});

	it('lists the models and the capabilities the actions answered', () => {
		const models = setup({}, { scope: 'models', models: ['gpt-4o', 'o3-mini'] });
		expect(models.getByRole('list', { name: 'Models' }).textContent).toContain('o3-mini');
		cleanup();
		const caps = setup({}, { scope: 'capabilities', capabilities: { model: 'gpt-4o', kind: 'openai', max_tokens: 128000, text: true, embed: false, image: true, vision: true } });
		expect(caps.getByTestId('capabilities').textContent).toContain('128000 tokens');
		// What a model cannot do is said in words, not by a muted color alone.
		expect(caps.getByTestId('capabilities').textContent).toContain('no embed');
		expect(caps.getByTestId('capabilities').textContent).not.toContain('no text');
	});

	it('paints the off state with the switch instead of the row', () => {
		const { getByText, container } = setup({ gate: { state: 'off' }, provider: null });
		expect(getByText('AI is switched off for this tenant')).toBeTruthy();
		expect(container.querySelector('form[action="?/update"]')).toBeNull();
	});
});

// A heading list that jumps from h1 to h3 reads to a screen reader as a
// missing section.
describe('heading outline', () => {
	it('steps its headings down one level at a time', () => {
		const { container } = setup();
		expect(outlineSkips(container)).toEqual([]);
	});

	it('steps its headings down one level at a time while the feature is not enabled', () => {
		const { container } = setup({ gate: { state: 'locked' } });
		expect(container.querySelector('[data-testid="not-enabled"]')).toBeTruthy();
		expect(outlineSkips(container)).toEqual([]);
	});
});
