// @vitest-environment jsdom
import { render, cleanup, screen, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ invalidate: vi.fn(async () => {}), goto: vi.fn(async () => {}) }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import TemplatesPage from './+page.svelte';
import { outlineSkips } from '$lib/test-outline';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const template = {
	id: 't1',
	name: 'Orders',
	content_type: 'order',
	mode: 'upsert',
	upsert_key: 'entry.slug',
	field_mappings: [
		{ source_field: 'Placed', target_field: 'placed_at', transform: 'date', transform_options: { layout: '02/01/2006' } },
		{ source_field: 'Ref', target_field: 'entry.slug' },
	],
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
};

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		gate: { state: 'ok' },
		schemas: { ok: true, value: [{ name: 'order', fields: [{ name: 'placed_at', field_type: 'datetime' }] }] },
		templates: [template],
		templatesRead: true,
		licensed: true,
		...over,
	} as never,
	form: form as never,
});

describe('mapping templates', () => {
	it('lists each template with its columns, transforms and mode', () => {
		const table = () => screen.getAllByRole('region', { name: 'Mapping templates' })[0];
		render(TemplatesPage, { props: props() });
		expect(table().textContent).toContain('Orders');
		expect(table().textContent).toContain('Placed, parse a date');
		expect(table().textContent).toContain('Update it, key entry.slug');
	});

	it('shows the empty state when no template is saved', () => {
		const { container } = render(TemplatesPage, { props: props({ templates: [] }) });
		expect(said(container)).toContain('No mapping template');
	});

	it('says a failed read failed rather than that there are none', () => {
		const { container } = render(TemplatesPage, { props: props({ templates: [], templatesRead: false }) });
		expect(said(container)).toContain('Could not load templates');
		expect(said(container)).not.toContain('No mapping template');
	});

	it('says a role refusal of the templates as one', () => {
		const { container } = render(TemplatesPage, {
			props: props({ templates: [], templatesRead: false, templatesGate: { state: 'forbidden' } }),
		});
		expect(said(container)).toContain('Your role cannot open templates');
	});

	it('says what an engine without templates keeps', () => {
		const { container } = render(TemplatesPage, { props: props({ licensed: false }) });
		expect(said(container)).toContain('Saving templates and the date, split and lookup transforms are not enabled on this engine.');
	});

	it('opens a stored template in the drawer with its transform', async () => {
		render(TemplatesPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: 'Edit Orders' }));
		expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Orders');
		expect((document.getElementById('template-0-layout') as HTMLInputElement | null)?.value).toBe('02/01/2006');
	});

	it('renders a refused save through the refusal notice', () => {
		render(TemplatesPage, {
			props: props({}, { action: 'deleteTemplate', error: 'x', refused: { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' } }),
		});
		expect(screen.getAllByTestId('refusal-notice').length).toBeGreaterThan(0);
	});
});

describe('the template drawer', () => {
	it('opens on the Mapping templates tab', () => {
		render(TemplatesPage, { props: props() });
		expect(screen.getByRole('tab', { name: 'Mapping templates' }).getAttribute('aria-selected')).toBe('true');
	});

	it('says why a new template offers no content type when the list was not read', async () => {
		render(TemplatesPage, {
			props: props({ templates: [], templatesRead: true, schemas: { ok: false, gate: { state: 'unavailable' } } }),
		});
		await fireEvent.click(screen.getAllByRole('button', { name: /new template/i })[0]);
		expect(document.body.textContent).toContain('Could not load content types');
	});

	it('asks what to do with an existing entry with a sentence on each choice', async () => {
		render(TemplatesPage, { props: props({ templates: [], templatesRead: true }) });
		await fireEvent.click(screen.getAllByRole('button', { name: /new template/i })[0]);
		expect(screen.getByRole('radio', { name: /create only/i })).toBeTruthy();
		expect(document.body.textContent).toContain('Overwrite the fields of an entry the key finds');
	});

	it('shows a failed delete on the page and opens the template drawer clean', async () => {
		const failed = 'Could not delete the template. Try again.';
		const { container } = render(TemplatesPage, {
			props: props({ templates: [], templatesRead: true }, { action: 'deleteTemplate', error: failed }),
		});
		expect(said(container)).toContain(failed);
		await fireEvent.click(screen.getAllByRole('button', { name: /new template/i })[0]);
		expect((document.getElementById('template-form') as HTMLFormElement).textContent).not.toContain(failed);
	});

	it('shows a refused template save in its drawer and not on the page', async () => {
		const { container } = render(TemplatesPage, {
			props: props({ templates: [], templatesRead: true }, { action: 'saveTemplate', error: 'Map at least one column.' }),
		});
		expect(said(container)).not.toContain('Map at least one column.');
	});
});

describe('heading outline', () => {
	it('steps its headings down one level at a time', () => {
		const { container } = render(TemplatesPage, { props: props() });
		expect(outlineSkips(container)).toEqual([]);
	});

	it('steps its headings down one level at a time while the feature is not enabled', () => {
		const { container } = render(TemplatesPage, { props: props({ gate: { state: 'locked', upgradeUrl: '' } }) });
		expect(container.querySelector('[data-testid="not-enabled"]')).toBeTruthy();
		expect(outlineSkips(container)).toEqual([]);
	});
});
