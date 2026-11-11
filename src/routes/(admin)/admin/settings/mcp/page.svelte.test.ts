// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
const state = vi.hoisted(() => ({ page: { url: new URL('http://localhost/admin/settings/mcp') } }));
vi.mock('$app/state', () => state);

import Page from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const KEY_AGENT = {
	kind: 'api_key',
	credential_id: '0b7f6c2e-1111-4111-8111-111111111111',
	person_id: 'u1',
	first_used_at: '2026-11-10T08:00:00Z',
	last_used_at: '2026-11-11T09:30:00Z',
};
const SESSION_AGENT = { ...KEY_AGENT, kind: 'session', credential_id: 'u2', person_id: 'u2' };

const CEILING = 'No more connected agents on this engine';

function setup(over: Record<string, unknown> = {}, form: unknown = null) {
	return render(Page, {
		props: {
			data: {
				endpoints: { content: 'https://cms.example.com/api/v1/mcp', admin: 'https://cms.example.com/api/admin/mcp' },
				settings: { ok: true, value: { enabled: true } },
				agents: { ok: true, value: { limit: 1, agents: [] } },
				people: { u1: 'ada@example.com', u2: 'grace@example.com' },
				...over,
			},
			form,
		} as never,
	});
}

describe('MCP settings page', () => {
	it('shows the switch, posting the opposite of its value, and both addresses', () => {
		const { getByLabelText, getByTestId } = setup();
		expect(getByLabelText('MCP server').getAttribute('aria-checked')).toBe('true');
		expect((getByTestId('mcp-enabled-form').querySelector('input[name="enabled"]') as HTMLInputElement).value).toBe('false');
		expect((getByLabelText('Content API') as HTMLInputElement).value).toBe('https://cms.example.com/api/v1/mcp');
		expect((getByLabelText('Admin API') as HTMLInputElement).value).toBe('https://cms.example.com/api/admin/mcp');
	});

	it('says how many agents can connect on the free tier while there is room', () => {
		const { getByTestId, getByText, queryByText } = setup();
		expect(getByTestId('mcp-agent-limit').textContent).toContain('You can connect 1 agent.');
		expect(getByText('No connected agents yet')).toBeTruthy();
		expect(queryByText(CEILING)).toBeNull();
	});

	it('shows the ceiling and the license link once the one agent is connected', () => {
		const { getByText, queryByTestId, container } = setup({ agents: { ok: true, value: { limit: 1, agents: [KEY_AGENT] } } });
		expect(getByText(CEILING)).toBeTruthy();
		expect(said(container)).toContain("You're using 1 of 1 connected agents, the most this engine allows.");
		expect(container.querySelector('a[href="/admin/settings/license"]')).toBeTruthy();
		expect(queryByTestId('mcp-agent-limit')).toBeNull();
	});

	it('shows no limit under the AI license, whatever the count', () => {
		const { queryByText, queryByTestId, container } = setup({ agents: { ok: true, value: { limit: 0, agents: [KEY_AGENT, SESSION_AGENT] } } });
		expect(queryByText(CEILING)).toBeNull();
		expect(queryByTestId('mcp-agent-limit')).toBeNull();
		expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
	});

	it('lists each agent with its first and last use and a Disconnect for it', () => {
		const { container, getByLabelText } = setup({ agents: { ok: true, value: { limit: 0, agents: [KEY_AGENT, SESSION_AGENT] } } });
		const rows = container.querySelectorAll('tbody tr');
		expect(rows[0].textContent).toContain('API key 0b7f6c2e');
		expect(rows[0].textContent).toContain('ada@example.com');
		expect(rows[1].textContent).toContain('grace@example.com');
		const form = getByLabelText('Disconnect grace@example.com').closest('form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/disconnect');
		expect((form.querySelector('input[name="kind"]') as HTMLInputElement).value).toBe('session');
		expect((form.querySelector('input[name="credential"]') as HTMLInputElement).value).toBe('u2');
	});

	it('draws a failed read as a failure with a retry, never as no agents', () => {
		const { container, getAllByRole, queryByText } = setup({
			settings: { ok: false, gate: { state: 'error', message: 'Could not load the MCP server setting.' } },
			agents: { ok: false, gate: { state: 'error', message: 'Could not load the connected agents.' } },
		});
		expect(said(container)).toContain('Could not load the MCP server setting.');
		expect(said(container)).toContain('Could not load the connected agents.');
		expect(queryByText('No connected agents yet')).toBeNull();
		const retries = getAllByRole('link', { name: 'Try again' });
		expect(retries).toHaveLength(2);
		expect(retries[0].getAttribute('href')).toBe('/admin/settings/mcp');
	});

	it('says the server is not in this build when the engine does not run the plugin', () => {
		const absent = { ok: false, gate: { state: 'absent' } };
		const { container, queryByLabelText } = setup({ settings: absent, agents: absent });
		expect(said(container)).toContain('The MCP server is not included in this build.');
		expect(queryByLabelText('MCP server')).toBeNull();
		expect(said(container)).not.toContain('No connected agents yet');
	});

	it('shows a failed write beside the control it came from', () => {
		const toggled = setup({}, { action: 'toggle', error: 'Could not save the setting. Try again.' });
		expect(said(toggled.container)).toContain('Could not save the setting. Try again.');
		cleanup();
		const gone = setup({ agents: { ok: true, value: { limit: 0, agents: [KEY_AGENT] } } }, { action: 'disconnect', error: 'This agent is no longer connected.' });
		expect(said(gone.container)).toContain('This agent is no longer connected.');
	});
});
