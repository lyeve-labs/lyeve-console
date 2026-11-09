// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageData } from './$types';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import DefinitionsPage from './+page.svelte';

afterEach(cleanup);

const definition = {
	definition: {
		id: 'd1',
		name: 'Editorial',
		slug: 'editorial',
		content_schema: 'article',
		publish_on_approve: true,
		created_at: '',
		updated_at: '',
	},
	stages: [
		{ id: 's1', definition_id: 'd1', name: 'Copy edit', position: 1, required_role: 'editor', sla_duration_seconds: 3600 },
		{ id: 's2', definition_id: 'd1', name: 'Sign-off', position: 2, required_role: '', sla_duration_seconds: 0 },
	],
};

/** A test names each read's rows as an array. The load hands the page a read that succeeded, or the gate of one that failed. */
function read(value: unknown) {
	return Array.isArray(value) ? { ok: true, value } : value;
}

function data(overrides: Record<string, unknown> = {}): PageData {
	const merged: Record<string, unknown> = {
		definitions: [definition],
		limits: null,
		schemas: ['article'],
		people: {},
		...overrides,
	};
	for (const key of ['definitions', 'schemas']) merged[key] = read(merged[key]);
	return merged as unknown as PageData;
}

describe('definitions page', () => {
	it('lists a definition with its ordered stages, roles and SLAs', () => {
		render(DefinitionsPage, { props: { data: data(), form: null } });
		expect(screen.getByText('Beta')).toBeTruthy();
		const row = screen.getByTestId('definition-row');
		expect(row.textContent).toContain('Editorial');
		expect(row.textContent).toContain('editorial');
		expect(row.textContent).toMatch(/1\.\s*Copy edit\s*editor\s*1h/);
		expect(row.textContent).toMatch(/2\.\s*Sign-off/);
		expect(row.textContent).toContain('Publishes');
		expect(screen.getByRole('button', { name: 'Delete Editorial' })).toBeTruthy();
	});

	it('opens on the Definitions tab', () => {
		render(DefinitionsPage, { props: { data: data(), form: null } });
		expect(screen.getByRole('tab', { name: 'Definitions' }).getAttribute('aria-selected')).toBe('true');
	});

	it('names the read that failed, never the first-run state', () => {
		render(DefinitionsPage, {
			props: {
				data: data({ definitions: { ok: false, gate: { state: 'error', message: 'The review definitions could not be read.' } } }),
				form: null,
			},
		});
		expect(screen.getByText('The review definitions could not be read.')).toBeTruthy();
		expect(screen.queryByText('No definitions yet')).toBeNull();
		expect(screen.queryByRole('button', { name: /New definition/ })).toBeNull();
	});

	it('reports the refusal and the outcome', async () => {
		render(DefinitionsPage, { props: { data: data(), form: { error: 'Stage 2 needs a name.' } as never } });
		expect(screen.getByText('Stage 2 needs a name.')).toBeTruthy();
		cleanup();
		render(DefinitionsPage, { props: { data: data(), form: { created: true } as never } });
		expect(await screen.findByText('Definition created.')).toBeTruthy();
	});
});

const quorumStage = {
	id: 's3',
	definition_id: 'd1',
	name: 'Legal',
	position: 3,
	required_role: 'legal',
	sla_duration_seconds: 7200,
	quorum: 2,
	escalate_to_user_id: '',
	escalate_to_role: 'legal-lead',
	condition: { field: 'category', op: 'equals', value: 'legal' },
};

describe('definitions page, what the install allows', () => {
	it('states the workflow count against the ceiling the read sent', () => {
		render(DefinitionsPage, {
			props: { data: data({ limits: { licensed: false, workflows: { limit: 3, current: 1 } } }), form: null },
		});
		expect(screen.getByTestId('workflow-count').textContent).toMatch(/1 of 3\s*workflows/);
		expect(screen.queryByTestId('refusal-notice')).toBeNull();
	});

	it('renders the ceiling as a refusal with its numbers and closes New definition at it', () => {
		render(DefinitionsPage, {
			props: { data: data({ limits: { licensed: false, workflows: { limit: 1, current: 1 } } }), form: null },
		});
		expect(screen.getByTestId('refusal-notice').textContent).toContain("You're using 1 of 1 workflows");
		const create = screen.getByRole('button', { name: /New definition/ }) as HTMLButtonElement;
		expect(create.disabled).toBe(true);
	});

	it('says nothing about a ceiling when there is none', () => {
		render(DefinitionsPage, {
			props: { data: data({ limits: { licensed: true, workflows: { limit: null, current: 4 } } }), form: null },
		});
		expect(screen.queryByTestId('workflow-count')).toBeNull();
		expect(screen.queryByTestId('refusal-notice')).toBeNull();
	});

	it('names a stage quorum, escalation and condition in the list', () => {
		render(DefinitionsPage, {
			props: { data: data({ definitions: [{ ...definition, stages: [...definition.stages, quorumStage] }] }), form: null },
		});
		const chips = screen.getAllByTestId('stage-chip').map((c) => c.textContent ?? '');
		expect(chips[2]).toContain('2 approvals');
		expect(chips[2]).toContain('escalates to legal-lead');
		expect(chips[2]).toContain('when category is legal');
	});

	it('renders a refused create with the plugin numbers', () => {
		render(DefinitionsPage, {
			props: {
				data: data(),
				form: {
					error: 'refused',
					refused: { kind: 'cap', cap: 'review.workflows', limit: 1, current: 1, upgradeUrl: '' },
				} as never,
			},
		});
		expect(screen.getByTestId('refusal-notice').textContent).toContain("You're using 1 of 1 workflows");
	});
});

describe('definitions page, failures and unread stages', () => {
	it('says the stages could not be read instead of drawing an empty cell', () => {
		render(DefinitionsPage, {
			props: { data: data({ definitions: [{ ...definition, stages: null }] }), form: null },
		});
		expect(screen.getByText('Could not load stages. Reload the page to try again.')).toBeTruthy();
	});

	it('keeps a failed delete out of the New definition drawer', async () => {
		render(DefinitionsPage, {
			props: { data: data(), form: { action: 'delete', error: 'Could not delete the definition. Try again.' } as never },
		});
		expect(screen.getAllByText('Could not delete the definition. Try again.')).toHaveLength(1);
		await fireEvent.click(screen.getAllByRole('button', { name: /New definition/ })[0]);
		const drawerForm = document.querySelector('form#definition-form') as HTMLFormElement;
		expect(drawerForm.textContent).not.toContain('Could not delete the definition. Try again.');
		expect(screen.getAllByText('Could not delete the definition. Try again.')).toHaveLength(1);
	});
});

describe('definition stages', () => {
	// Every other column holds its text on one line, so on a phone a stage
	// name got 7px and stacked one or two letters a line.
	it('keeps each stage on one line', () => {
		render(DefinitionsPage, { props: { data: data(), form: null } });
		for (const chip of screen.getAllByTestId('stage-chip')) {
			expect(chip.className).toContain('whitespace-nowrap');
		}
	});
});
