// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '$app/forms';
import type { PageData } from './$types';

// Each form's submit handler, by its action, so a case can hand the page the
// result the preview action returned.
const forms = vi.hoisted(() => ({ handlers: new Map<string, unknown>() }));
vi.mock('$app/forms', () => ({
	enhance: (form: HTMLFormElement, submit: unknown) => {
		forms.handlers.set(form.getAttribute('action') ?? '', submit);
		return { destroy() {} };
	},
}));
vi.mock('$app/navigation', () => ({ beforeNavigate: vi.fn(), goto: vi.fn(async () => {}), refreshAll: vi.fn(async () => {}) }));
vi.mock('#lib/canvas/schema.ts', () => ({ SchemaCanvas: null, hasSchemaCanvas: false }));

import SchemaPage from './+page.svelte';

afterEach(() => {
	cleanup();
	forms.handlers.clear();
});

const data = {
	entitlements: { plan: 'example', state: 'active', features: ['schema'], tenant_quota: 1 },
	schemas: [
		{
			name: 'note',
			display_name: 'Note',
			fields: [{ id: 'f-title', name: 'title', field_type: 'text', required: true, unique: false, indexed: false }],
		},
	],
	rowCounts: { note: 3 },
	presets: [],
	presetsGate: null,
	loadGate: null,
	canWrite: true,
} as unknown as PageData;

/** Runs the preview action's result through the page's own submit handler. */
async function previewAnswers(statements: unknown[]) {
	const submit = forms.handlers.get('?/preview') as SubmitFunction;
	const after = await submit({
		action: new URL('http://localhost/admin/schema?/preview'),
		formData: new FormData(),
		formElement: document.createElement('form'),
		controller: new AbortController(),
		submitter: null,
		cancel: vi.fn(),
	});
	await (after as (o: unknown) => Promise<void>)({
		action: new URL('http://localhost/admin/schema?/preview'),
		formData: new FormData(),
		formElement: document.createElement('form'),
		update: vi.fn(async () => {}),
		result: { type: 'success', status: 200, data: { scope: 'preview', intent: 'look', statements } },
	});
}

describe('Preview DDL', () => {
	it('marks the statement the engine says a save queues because it drops data', async () => {
		render(SchemaPage, { props: { data, form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Note' }));
		await previewAnswers([
			{ description: 'add column _note.subtitle', sql: 'ALTER TABLE "_note" ADD COLUMN "subtitle" TEXT' },
			{
				description: 'drop column _note.pinned',
				sql: 'ALTER TABLE "_note" DROP COLUMN IF EXISTS "pinned"',
				down_sql: '-- no safe undo for drop of _note.pinned',
				destructive: true,
			},
		]);
		const [add, drop] = screen.getAllByTestId('ddl-statement');
		expect(add.getAttribute('data-destructive')).toBeNull();
		expect(add.textContent).not.toContain('Queued');
		expect(drop.getAttribute('data-destructive')).toBe('true');
		expect(drop.textContent).toContain('Queued');
		expect(drop.textContent).toContain('This statement drops data. Saving queues it');
	});
});
