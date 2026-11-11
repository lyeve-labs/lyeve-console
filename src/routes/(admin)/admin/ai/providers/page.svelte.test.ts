// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';
import { fixtureLocalProvider, fixtureProvider, fixtureSettings } from '$lib/components/ai/test-support/fixtures';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

function setup(overrides: Record<string, unknown> = {}, form: unknown = null) {
	return render(Page, {
		props: {
			data: {
				gate: { state: 'ok' },
				providers: [],
				total: 0,
				limit: 50,
				offset: 0,
				hasMore: false,
				dashboard: null,
				ceiling: { limit: 0, upgradeUrl: '' },
				aiSettings: fixtureSettings,
				aiLayoutGate: { state: 'ok' },
				isSuperAdmin: true,
				...overrides,
			},
			form,
		} as never,
	});
}

describe('AI providers page', () => {
	it('lists kind, priority, modalities and the key state per row', () => {
		const { container } = setup({ providers: [fixtureProvider, fixtureLocalProvider], total: 2 });
		const rows = container.querySelectorAll('tbody tr');
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('OpenAI');
		expect(rows[0].textContent).toContain('10');
		expect(rows[0].textContent).toContain('embed');
		expect(rows[0].textContent).toContain('Stored');
		expect(rows[0].textContent).toContain('Enabled');
		expect(rows[1].textContent).toContain('OpenAI-compatible');
		expect(rows[1].textContent).toContain('http://localhost:11434/v1');
		expect(rows[1].textContent).toContain('Needs key');
		expect(rows[1].textContent).toContain('Disabled');
		expect(rows[1].querySelector('a')?.getAttribute('href')).toBe(`/admin/ai/providers/${fixtureLocalProvider.id}`);
	});

	// A long form announces its failure at the top, where the reader is.
	it('puts a failed create first in the drawer, above the fields', async () => {
		const { container, getAllByText } = setup({}, { error: 'Could not create the provider. Try again.' });
		await fireEvent.click(getAllByText('New provider')[0]);
		const form = container.ownerDocument.querySelector('#provider-create') as HTMLFormElement;
		const alert = form.querySelector('[aria-live]') as HTMLElement;
		expect(alert.textContent).toContain('Could not create the provider. Try again.');
		expect(form.firstElementChild).toBe(alert);
	});

	it('offers the create control to a super admin only', () => {
		const sup = setup();
		expect(sup.getAllByText('New provider').length).toBeGreaterThan(0);
		cleanup();
		const admin = setup({ isSuperAdmin: false });
		expect(admin.queryByText('New provider')).toBeNull();
		expect(admin.getByText(/until a super admin adds a provider/)).toBeTruthy();
	});

	it('paints the empty state and the spend row', () => {
		const { getByText } = setup({ dashboard: { total_calls: 12, total_cost: '0.42', avg_latency_ms: 812.4, enabled_providers: 1, total_providers: 2 } });
		expect(getByText('No providers yet')).toBeTruthy();
		expect(getByText('1/2')).toBeTruthy();
		expect(getByText('812 ms')).toBeTruthy();
	});

	it('hides the create control when the layout says the plugin is absent, even with an empty list answered', () => {
		const { queryByText, getByText } = setup({ aiLayoutGate: { state: 'absent' } });
		expect(getByText('AI is not included in this build')).toBeTruthy();
		expect(queryByText('New provider')).toBeNull();
	});

	it.each([
		['locked', 'Not enabled on this engine.'],
		['forbidden', 'Only an admin or a super admin can open AI providers.'],
		['off', 'AI is switched off for this tenant'],
		['no_provider', 'No AI provider is available'],
	])('paints the %s state and no table', (state, words) => {
		const { getByText, container } = setup({ gate: { state }, providers: [] });
		expect(getByText(words)).toBeTruthy();
		expect(container.querySelector('table')).toBeNull();
	});

	// Without the AI license a tenant holds one provider. The page says so
	// before a create would be refused, and the create control waits.
	describe('the free tier', () => {
		const CEILING = "You're using 1 of 1 AI providers.";

		it('shows the ceiling and holds the create control once the one provider exists', () => {
			const { getByText, getAllByRole } = setup({ ceiling: { limit: 1, upgradeUrl: '' }, providers: [fixtureProvider], total: 1 });
			expect(getByText('No more AI providers')).toBeTruthy();
			expect(getByText(new RegExp(CEILING))).toBeTruthy();
			const create = getAllByRole('button').find((b) => b.textContent?.includes('New provider'));
			expect(create?.hasAttribute('disabled')).toBe(true);
		});

		it('links the ceiling to the plan the list names', () => {
			const url = 'https://lyeve.com/pricing?skus=plugin-ai-pro';
			const { container } = setup({ ceiling: { limit: 1, upgradeUrl: url }, providers: [fixtureProvider], total: 1 });
			expect(container.querySelector(`a[href="${url}"]`)?.textContent).toContain('View the add-on');
		});

		it('holds the create control at the limit the list states', () => {
			const room = setup({ ceiling: { limit: 2, upgradeUrl: '' }, providers: [fixtureProvider], total: 1 });
			expect(room.queryByText('No more AI providers')).toBeNull();
			cleanup();
			const full = setup({ ceiling: { limit: 2, upgradeUrl: '' }, providers: [fixtureProvider, fixtureLocalProvider], total: 2 });
			expect(full.getByText(/You're using 2 of 2 AI providers/)).toBeTruthy();
		});

		it('offers the create control with room left', () => {
			const { queryByText, getAllByText } = setup({ ceiling: { limit: 1, upgradeUrl: '' }, providers: [], total: 0 });
			expect(queryByText('No more AI providers')).toBeNull();
			expect(getAllByText('New provider').length).toBeGreaterThan(0);
		});

		it('shows no ceiling under the AI license', () => {
			const { queryByText } = setup({ ceiling: { limit: 0, upgradeUrl: '' }, providers: [fixtureProvider, fixtureLocalProvider], total: 2 });
			expect(queryByText('No more AI providers')).toBeNull();
		});

		it('shows no ceiling to a reader who cannot create a provider', () => {
			const { queryByText } = setup({ ceiling: { limit: 1, upgradeUrl: '' }, isSuperAdmin: false, providers: [fixtureProvider], total: 1 });
			expect(queryByText('No more AI providers')).toBeNull();
		});

		it('draws a refused create as the ceiling, with the link from the refusal', async () => {
			const url = 'https://lyeve.com/pricing?skus=plugin-ai-pro';
			const refused = { kind: 'cap', cap: 'ai.providers', limit: 1, current: 1, upgradeUrl: url };
			const { container, getAllByText } = setup({ ceiling: { limit: 0, upgradeUrl: '' } }, { error: 'x', refused });
			await fireEvent.click(getAllByText('New provider')[0]);
			const drawer = container.ownerDocument.querySelector('#provider-create') as HTMLFormElement;
			expect(drawer.textContent).toContain('No more AI providers');
			expect(drawer.querySelector(`a[href="${url}"]`)?.textContent).toContain('View the add-on');
		});
	});
});
