// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';
import { fixtureSettings, fixtureTranscript } from '$lib/components/ai/test-support/fixtures';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

function setup(overrides: Record<string, unknown> = {}, form: unknown = null) {
	return render(Page, {
		props: {
			data: { gate: { state: 'ok' }, transcript: fixtureTranscript, aiSettings: fixtureSettings, aiLayoutGate: { state: 'ok' }, isSuperAdmin: false, ...overrides },
			form,
		} as never,
	});
}

describe('AI transcript page', () => {
	it('renders every message with its role and the assistant turn with its cost', () => {
		const { getByRole } = setup();
		const items = getByRole('list', { name: 'Messages' }).querySelectorAll('li');
		expect(items).toHaveLength(2);
		expect(items[0].textContent).toContain('user');
		expect(items[0].textContent).toContain('Rewrite the intro.');
		expect(items[1].textContent).toContain('assistant');
		expect(items[1].textContent).toContain('120 in, 80 out, 900 ms, $0.0011');
	});

	it('sums the tokens and the cost over the messages', () => {
		const { getByText } = setup();
		expect(getByText('120')).toBeTruthy();
		expect(getByText('80')).toBeTruthy();
		expect(getByText('$0.0011')).toBeTruthy();
	});

	it('links the two exports as plain downloads through the admin route', () => {
		const { getByRole } = setup();
		const json = getByRole('link', { name: /JSON/ });
		expect(json.getAttribute('href')).toBe(`/admin/ai/transcripts/${fixtureTranscript.id}/export?format=json`);
		expect(json.getAttribute('download')).toBe(`transcript-${fixtureTranscript.id}.json`);
		const md = getByRole('link', { name: /Markdown/ });
		expect(md.getAttribute('href')).toBe(`/admin/ai/transcripts/${fixtureTranscript.id}/export?format=markdown`);
	});

	it('shows the recap the action wrote, and the stored one otherwise', () => {
		const fresh = setup({}, { recap: 'The intro was tightened.' });
		expect(fresh.getByTestId('recap').textContent).toBe('The intro was tightened.');
		expect(fresh.getByText('Recap again')).toBeTruthy();
		cleanup();
		const stored = setup({ transcript: { ...fixtureTranscript, recap: 'Stored recap.' } });
		expect(stored.getByTestId('recap').textContent).toBe('Stored recap.');
		cleanup();
		const none = setup();
		expect(none.queryByTestId('recap')).toBeNull();
		expect(none.getByRole('button', { name: 'Recap' })).toBeTruthy();
		expect(none.getByText(/No recap yet/)).toBeTruthy();
	});

	it('names a recap that no provider could write', () => {
		const { getByRole } = setup({}, { error: 'No enabled AI provider can answer this. Add or enable a provider first.' });
		expect(getByRole('alert').textContent).toContain('No enabled AI provider');
	});

	it('paints the no-provider state and no messages', () => {
		const { getByText, queryByRole } = setup({ gate: { state: 'no_provider' }, transcript: null });
		expect(getByText('No AI provider is available')).toBeTruthy();
		expect(queryByRole('list', { name: 'Messages' })).toBeNull();
	});
});
