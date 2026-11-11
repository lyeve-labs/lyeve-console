// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';
import { fixtureSettings } from '$lib/components/ai/test-support/fixtures';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

const instance = [
	{ key: 'ai_transcript_retention', value: '720h', source: 'default', editable: true },
	{ key: 'ai_transcripts_enabled', value: 'true', source: 'default', editable: false },
];

function setup(overrides: Record<string, unknown> = {}, form: unknown = null) {
	return render(Page, {
		props: {
			data: { instance, instanceReadable: true, aiSettings: fixtureSettings, aiLayoutGate: { state: 'ok' }, isSuperAdmin: true, ...overrides },
			form,
		} as never,
	});
}

describe('AI settings page', () => {
	it('shows both switches with the plain words under the tenant switch', () => {
		const { getByTestId, getByLabelText } = setup();
		expect(getByLabelText('AI for this tenant').getAttribute('aria-checked')).toBe('true');
		expect(getByLabelText('Store transcripts').getAttribute('aria-checked')).toBe('true');
		const words = getByTestId('what-never-leaves').textContent ?? '';
		expect(words).toContain('Only the request to the endpoint you configured leaves this engine');
		expect(words).toContain('LyEve Labs never sees your prompts');
		expect(words).toContain('They are not anonymized');
	});

	it('posts the opposite of the current value for the one switch named', () => {
		const { getByTestId } = setup();
		const enabled = getByTestId('ai-enabled-form');
		expect((enabled.querySelector('input[name="enabled"]') as HTMLInputElement).value).toBe('false');
		expect(enabled.querySelector('input[name="transcripts_enabled"]')).toBeNull();
		const transcripts = getByTestId('ai-transcripts-form');
		expect((transcripts.querySelector('input[name="transcripts_enabled"]') as HTMLInputElement).value).toBe('false');
		expect(transcripts.querySelector('input[name="enabled"]')).toBeNull();
	});

	it('shows the assistant switch on by default and posts its opposite alone', () => {
		const { getByLabelText, getByTestId } = setup({ aiSettings: { ...fixtureSettings, assistant_enabled: undefined } });
		expect(getByLabelText('Assistant').getAttribute('aria-checked')).toBe('true');
		const form = getByTestId('ai-assistant-form');
		expect((form.querySelector('input[name="assistant_enabled"]') as HTMLInputElement).value).toBe('false');
		expect(form.querySelector('input[name="enabled"]')).toBeNull();
		expect(form.querySelector('input[name="transcripts_enabled"]')).toBeNull();
	});

	it('shows the assistant switch off once the tenant turned it off, and offers to turn it on', () => {
		const { getByLabelText, getByTestId } = setup({ aiSettings: { ...fixtureSettings, assistant_enabled: false } });
		expect(getByLabelText('Assistant').getAttribute('aria-checked')).toBe('false');
		expect((getByTestId('ai-assistant-form').querySelector('input[name="assistant_enabled"]') as HTMLInputElement).value).toBe('true');
	});

	it('disables the assistant switch while AI is off for the tenant', () => {
		const { getByLabelText } = setup({ aiSettings: { ...fixtureSettings, enabled: false } });
		expect(getByLabelText('Assistant').hasAttribute('disabled')).toBe(true);
	});

	it('stays reachable while the tenant is off and shows the switch off', () => {
		const { getByLabelText, queryByText } = setup({ aiSettings: { ...fixtureSettings, enabled: false }, aiLayoutGate: { state: 'ok' } });
		expect(getByLabelText('AI for this tenant').getAttribute('aria-checked')).toBe('false');
		expect(getByLabelText('Store transcripts').hasAttribute('disabled')).toBe(true);
		expect(queryByText('AI is switched off for this tenant')).toBeNull();
	});

	it('offers the retention row to a super admin when the value is editable', () => {
		const { getByLabelText, getByText } = setup();
		expect((getByLabelText('Retention') as HTMLInputElement).value).toBe('720h');
		expect(getByText(/720h \(30 days\)/)).toBeTruthy();
	});

	it('tells a tenant admin the engine settings are for super admins and shows no default as a value', () => {
		const { getByText, queryByLabelText, queryByText } = setup({ isSuperAdmin: false, instanceReadable: false });
		expect(queryByLabelText('Retention')).toBeNull();
		expect(getByText(/Only a super admin can see and change the retention window/)).toBeTruthy();
		expect(queryByText('720h (default)')).toBeNull();
		expect(queryByText('true (default)')).toBeNull();
	});

	it('shows no value when a super admin could not read the engine configuration', () => {
		const { getByText, queryByText } = setup({ instanceReadable: false, instance: instance.map((s) => ({ ...s, editable: false })) });
		expect(getByText(/Could not load the retention window/)).toBeTruthy();
		expect(queryByText('720h (default)')).toBeNull();
	});

	it('paints the locked and the absent states with no switch', () => {
		const locked = setup({ aiSettings: null, aiLayoutGate: { state: 'locked' } });
		expect(locked.getByText('Not enabled on this engine.')).toBeTruthy();
		expect(locked.queryByLabelText('AI for this tenant')).toBeNull();
		cleanup();
		const absent = setup({ aiSettings: null, aiLayoutGate: { state: 'absent' } });
		expect(absent.getByText('AI is not included in this build')).toBeTruthy();
	});

	it('fixes retention at 30 days on the free tier and says why, for every reader', () => {
		const free = { ...fixtureSettings, transcript_retention: { value: '720h', source: 'free_tier', editable: false } };
		for (const isSuperAdmin of [true, false]) {
			const { getByLabelText, getByTestId, queryByText } = setup({ aiSettings: free, isSuperAdmin });
			const field = getByLabelText('Retention') as HTMLInputElement;
			expect(field.value).toBe('30 days');
			expect(field.hasAttribute('disabled')).toBe(true);
			expect(getByTestId('retention-fixed').textContent).toContain(
				'On the free tier, transcripts are kept for 30 days, and the AI license lets you choose how long.',
			);
			expect(queryByText(/Only a super admin can see and change the retention window/)).toBeNull();
			cleanup();
		}
	});

	it('keeps the configurable retention under the AI license', () => {
		const licensed = { ...fixtureSettings, transcript_retention: { value: '720h', source: 'config', editable: true } };
		const { getByLabelText, queryByTestId } = setup({ aiSettings: licensed });
		expect((getByLabelText('Retention') as HTMLInputElement).value).toBe('720h');
		expect(queryByTestId('retention-fixed')).toBeNull();
	});
});
