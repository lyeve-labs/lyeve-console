// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import LabsPage from './+page.svelte';
import type { LabEndpoint, LabResult } from '$lib/api/labs';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function endpoint(over: Partial<LabEndpoint> = {}): LabEndpoint {
	return {
		id: 'GET /api/v1/content/{schema}',
		groupId: 'content',
		groupLabel: 'Content',
		server: 'api',
		method: 'GET',
		path: '/api/v1/content/{schema}',
		summary: 'List entries',
		params: [{ name: 'schema', in: 'path', type: 'string', required: true, description: '' }],
		...over,
	};
}

function result(over: Partial<LabResult> = {}): LabResult {
	return {
		method: 'GET',
		path: '/api/v1/content/articles',
		status: 200,
		statusText: 'OK',
		durationMs: 42,
		body: '{\n  "data": []\n}',
		json: true,
		headers: { 'content-type': 'application/json' },
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		user: { roles: ['super_admin'] },
		endpoints: [endpoint()],
		source: 'engine',
		...over,
	} as never,
	form: form as never,
});

describe('the warning a tester needs first', () => {
	// There is no sandbox. A page that did not say so would be read as one.
	it('says every request hits the live instance as the caller', () => {
		const { container } = render(LabsPage, { props: props() });
		const text = said(container);
		expect(text).toContain('engine you are signed in to, as you');
		expect(text).toContain('a write changes data and a delete removes it');
	});

	// The list is the allowlist. Rendering the fallback silently would offer
	// endpoints this build may not serve while implying the engine said so.
	it('says when the endpoint list is the fallback rather than the engine', () => {
		const { container } = render(LabsPage, { props: props({ source: 'catalog' }) });
		expect(said(container)).toContain("Could not load the engine's API document, so this is the catalog built into the console");
	});

	it('says nothing of the sort when the engine answered', () => {
		const { container } = render(LabsPage, { props: props() });
		expect(said(container)).not.toContain("Could not load the engine's API document, so this is the catalog built into the console");
	});
});

describe('the answer', () => {
	it('shows the status, the timing and the body', () => {
		const { container } = render(LabsPage, { props: props({}, { rest: result() }) });
		const text = said(container);
		expect(text).toContain('200 OK');
		expect(text).toContain('42 ms');
		expect(text).toContain('"data"');
	});

	// The status a tester meets and misreads as a broken request.
	it('explains a 402 as a disabled plugin rather than a bad request', () => {
		const { container } = render(LabsPage, {
			props: props({}, { rest: result({ status: 402, statusText: 'Payment Required' }) }),
		});
		expect(said(container)).toContain('Changing the request does not help');
	});

	it('says a body is empty rather than rendering nothing', () => {
		const { container } = render(LabsPage, {
			props: props({}, { rest: result({ body: '', json: false, status: 204, statusText: 'No Content' }) }),
		});
		expect(said(container)).toContain('(empty body)');
	});
});

describe('the endpoint picker', () => {
	it('names its search box for a screen reader', () => {
		const { container } = render(LabsPage, { props: props() });
		const label = container.querySelector('label[for="endpoint-narrow"]');
		expect(label?.textContent).toBe('Search endpoints');
		expect(container.querySelector('#endpoint-narrow')).toBeTruthy();
	});

	// Squeezed by the summary on a phone, the path stacked one character per
	// line.
	it('keeps the path its width and drops the summary below the small breakpoint', () => {
		const { container } = render(LabsPage, { props: props() });
		const cells = container.querySelectorAll('table[aria-label="Choose an endpoint"] td, [aria-label="Choose an endpoint"] td');
		const path = [...cells].find((c) => c.classList.contains('font-mono')) as HTMLElement;
		expect(path.className).toContain('min-w-56');
		const summary = path.nextElementSibling as HTMLElement;
		expect(summary.className).toContain('hidden');
		expect(summary.className).toContain('sm:table-cell');
	});

	// The row is wider than its scroll box on a phone and a tablet, which left
	// the Select button past the box edge.
	it('keeps the Select cell stuck to the end of the scroll box, painted like its row', () => {
		const { getAllByRole } = render(LabsPage, { props: props() });
		const cell = getAllByRole('button', { name: 'Select' })[0].closest('td') as HTMLElement;
		for (const cls of ['sticky', 'end-0', 'z-1', 'bg-surface', '[tr:hover>&]:bg-surface-2']) {
			expect(cell.className.split(/\s+/), cls).toContain(cls);
		}
		expect((cell.closest('tr') as HTMLElement).className).not.toContain('relative');
	});

	it('gives each row one Select button, and a click picks that row', async () => {
		const posts = endpoint({ id: 'POST /api/v1/content/{schema}', method: 'POST', summary: 'Create an entry' });
		const { container, getByRole, queryByRole } = render(LabsPage, { props: props({ endpoints: [endpoint(), posts] }) });
		const rows = [...container.querySelectorAll('[aria-label="Choose an endpoint"] tbody tr')] as HTMLElement[];
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			const buttons = [...row.querySelectorAll('button')];
			expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Select']);
		}
		await fireEvent.click(rows[1].querySelector('button') as HTMLElement);
		expect(rows[1].querySelector('button')?.textContent?.trim()).toBe('Selected');
		expect(rows[0].querySelector('button')?.textContent?.trim()).toBe('Select');
		expect(getByRole('heading', { level: 2, name: 'POST /api/v1/content/{schema}' })).toBeTruthy();
		expect(queryByRole('heading', { level: 2, name: 'GET /api/v1/content/{schema}' })).toBeNull();
	});
});

describe('the REST tab', () => {
	it('marks its own tab, and leaves the gRPC tab off for a role below super admin', () => {
		const { getByRole, queryByRole } = render(LabsPage, { props: props({ user: { roles: ['admin'] } }) });
		expect(getByRole('tab', { name: 'REST' }).getAttribute('aria-selected')).toBe('true');
		expect(queryByRole('tab', { name: 'gRPC' })).toBeNull();
		expect(queryByRole('radio', { name: /grpc/i })).toBeNull();
	});
});
