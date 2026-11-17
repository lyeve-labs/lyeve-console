// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import ProviderForm from './ProviderForm.svelte';
import type { AiProvider } from '#lib/api/ai.ts';

afterEach(cleanup);

/** Renders the fields inside a form, so a test reads what a submit would post. */
function setup(props: Record<string, unknown> = {}) {
	const form = document.createElement('form');
	document.body.appendChild(form);
	const result = render(ProviderForm, { target: form, props: { id: 'new', superAdmin: false, ...props } as never });
	return { ...result, sent: () => new FormData(form) };
}

const stored: AiProvider = {
	id: 'p1',
	name: 'local-llm',
	kind: 'openai_compatible',
	has_key: true,
	needs_key: false,
	base_url: 'http://localhost:11434/v1',
	key_header: '',
	query_string: '',
	allow_private: true,
	default_model: 'llama3',
	enabled: false,
	priority: 5,
	modalities: ['text'],
	rate_limit_rpm: 60,
	max_budget_usd: 12.5,
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
};

describe('ProviderForm', () => {
	it('lists the four kinds as radios with a sentence each, so the long labels fit a phone', async () => {
		const { container, sent } = setup();
		const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"][name="kind"]');
		expect(radios).toHaveLength(4);
		expect(screen.getByText('A gateway that speaks the Anthropic API.')).toBeTruthy();
		await fireEvent.click(screen.getByLabelText(/Anthropic-compatible/));
		expect(sent().get('kind')).toBe('anthropic_compatible');
	});

	it('posts a new vendor row enabled, on every modality, with a key required', () => {
		const { sent } = setup();
		const out = sent();
		expect(out.get('kind')).toBe('openai');
		expect(out.getAll('modalities')).toEqual(['text', 'embed', 'image']);
		expect([out.get('enabled'), out.get('allow_private'), out.get('priority')]).toEqual(['true', 'false', '100']);
		expect((screen.getByLabelText(/API key/) as HTMLInputElement).required).toBe(true);
		expect(screen.queryByLabelText(/Base URL/)).toBeNull();
	});

	it('says a higher priority is tried first, the order the engine picks a provider in', () => {
		const { container } = setup();
		expect(container.textContent).toContain('When a request does not name a provider, higher priority is tried first.');
		expect(container.textContent).not.toContain('lower priority is tried first');
	});

	it('asks a compatible kind for its base URL and lets it run keyless', async () => {
		setup();
		await fireEvent.click(screen.getByRole('radio', { name: 'OpenAI-compatible' }));
		expect((screen.getByLabelText(/Base URL/) as HTMLInputElement).required).toBe(true);
		expect((screen.getByLabelText(/API key/) as HTMLInputElement).required).toBe(false);
		expect(screen.getByText('Optional. A local server usually needs none.')).toBeTruthy();
	});

	it('fills the blank fields from a preset and keeps what was typed', async () => {
		const { sent } = setup();
		await fireEvent.click(screen.getByRole('radio', { name: 'OpenAI-compatible' }));
		await fireEvent.input(screen.getByLabelText(/Key header/), { target: { value: 'X-Key' } });
		await fireEvent.click(document.getElementById('new-preset') as HTMLElement);
		await fireEvent.click(screen.getByRole('option', { name: 'Azure OpenAI' }));
		const out = sent();
		expect(out.get('key_header')).toBe('X-Key');
		expect(out.get('query_string')).toBe('api-version=2024-10-21');
	});

	it('offers a private address to a super admin only, and only for a compatible kind', async () => {
		setup({ superAdmin: true });
		expect(screen.queryByLabelText(/Allow a private address/)).toBeNull();
		await fireEvent.click(screen.getByRole('radio', { name: 'OpenAI-compatible' }));
		expect(screen.getByLabelText(/Allow a private address/)).toBeTruthy();
		cleanup();
		setup({ superAdmin: false, provider: stored });
		expect(screen.queryByLabelText(/Allow a private address/)).toBeNull();
	});

	it('warns what a private address lets the row reach once it is allowed', () => {
		setup({ superAdmin: true, provider: stored });
		expect(screen.getByRole('note').textContent).toContain('skip the private-address check');
	});

	it('seeds an edit from the stored row and keeps the stored key unless one is typed', () => {
		const { sent } = setup({ id: 'edit', provider: stored });
		const out = sent();
		expect(out.get('name')).toBe('local-llm');
		expect(out.get('kind')).toBe('openai_compatible');
		expect(out.get('base_url')).toBe('http://localhost:11434/v1');
		expect(out.getAll('modalities')).toEqual(['text']);
		expect([out.get('enabled'), out.get('allow_private')]).toEqual(['false', 'true']);
		expect(out.get('api_key')).toBe('');
		expect(screen.getByText('A key is stored. Leave this blank to keep it.')).toBeTruthy();
	});

	it('asks for the key again when the stored one cannot be read', () => {
		setup({ provider: { ...stored, kind: 'openai', needs_key: true } });
		expect(screen.getByText(/The saved key can no longer be decrypted after an encryption key change/)).toBeTruthy();
	});
});

describe('the modalities under a finger', () => {
	// The boxes wrapped 16px apart, so each 44px hit area took part of the next.
	it('spaces the modality checkboxes so their hit areas do not overlap', () => {
		setup();
		const group = screen.getByRole('group', { name: 'Modalities' });
		expect(group.querySelector('[class*="coarse:gap-y-"]')).toBeTruthy();
	});
});
