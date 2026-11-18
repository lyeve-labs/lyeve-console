// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';
import { fixtureSettings } from '#lib/components/ai/test-support/fixtures.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

afterEach(cleanup);

function setup() {
	return render(Page, {
		props: {
			data: { gate: { state: 'ok' }, prompts: [], aiSettings: fixtureSettings, aiLayoutGate: { state: 'ok' }, isSuperAdmin: true },
		} as never,
	});
}

describe('AI prompts page', () => {
	it('marks the page Beta beside its title', () => {
		const { getByTestId } = setup();
		expect(getByTestId('page-title').textContent?.trim()).toBe('AI prompts');
		expect(getByTestId('page-actions').textContent).toContain('Beta');
	});
});
