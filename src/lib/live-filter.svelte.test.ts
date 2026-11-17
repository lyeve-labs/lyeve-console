// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { carryLimit } from './live-filter.svelte';

function searchForm(): HTMLFormElement {
	const form = document.createElement('form');
	form.method = 'GET';
	form.innerHTML = '<input name="q" value="nightly" />';
	return form;
}

const sent = (form: HTMLFormElement) => new URLSearchParams(new FormData(form) as unknown as Record<string, string>).toString();

describe('carryLimit', () => {
	it('keeps a page size the reader chose and drops the offset', () => {
		const form = searchForm();
		carryLimit(form, 'http://localhost/admin/jobs?q=old&limit=100&offset=200');
		expect(sent(form)).toBe('q=nightly&limit=100');
	});

	it('follows the address on the next search, and carries nothing without a page size', () => {
		const form = searchForm();
		carryLimit(form, 'http://localhost/admin/jobs?limit=100');
		carryLimit(form, 'http://localhost/admin/jobs?limit=25');
		expect(sent(form)).toBe('q=nightly&limit=25');
		carryLimit(form, 'http://localhost/admin/jobs?offset=50');
		expect(sent(form)).toBe('q=nightly');
	});

	it('leaves a form that has a page size field of its own alone', () => {
		const form = searchForm();
		form.insertAdjacentHTML('beforeend', '<input name="limit" value="500" />');
		carryLimit(form, 'http://localhost/admin/logs?limit=100');
		expect(sent(form)).toBe('q=nightly&limit=500');
	});
});
