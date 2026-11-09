// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ExportConfigFields from './ExportConfigFields.svelte';

afterEach(cleanup);

describe('ExportConfigFields schema choice', () => {
	const unread = 'Could not load the content type list';

	it('says why there is nothing to pick when the schema list was not read', () => {
		const { container } = render(ExportConfigFields, { props: { idPrefix: 'x', schemaNames: null } });
		expect(container.textContent).toContain(unread);
	});

	it('counts the schemas a read answered with', () => {
		const { container } = render(ExportConfigFields, { props: { idPrefix: 'x', schemaNames: ['article', 'page'] } });
		expect(container.textContent).toContain('Every content type, 2 in this tenant.');
		expect(container.textContent).not.toContain(unread);
	});
});

describe('ExportConfigFields format and status choice', () => {
	it('shows every format with its sentence and submits the chosen one', () => {
		const { container } = render(ExportConfigFields, { props: { idPrefix: 'x', schemaNames: [], format: 'csv' } });
		const radios = container.querySelectorAll('input[type="radio"][name="format"]');
		expect(radios).toHaveLength(7);
		expect(container.textContent).toContain('Imports back as it is.');
		expect(container.textContent).toContain('for a static site');
		const form = document.createElement('form');
		form.append(container.firstElementChild!.cloneNode(true));
		expect(new FormData(form).get('format')).toBe('csv');
	});

	it('states the row ceiling and promises no export of every entry', () => {
		const { container } = render(ExportConfigFields, { props: { idPrefix: 'x', schemaNames: [] } });
		expect(container.textContent).toContain('An export includes at most 10,000 entries.');
		expect(container.textContent).not.toContain('every entry');
	});

	it('keeps the three statuses in sight as checkboxes', () => {
		const { container } = render(ExportConfigFields, { props: { idPrefix: 'x', schemaNames: [], statuses: ['draft'] } });
		const boxes = container.querySelectorAll('input[type="checkbox"][name="statuses"]');
		expect(boxes).toHaveLength(3);
		const ticked = [...boxes].filter((b) => (b as HTMLInputElement).checked).map((b) => (b as HTMLInputElement).value);
		expect(ticked).toEqual(['draft']);
	});
});
