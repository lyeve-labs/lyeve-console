// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import GraphqlLab from './+page.svelte';
import type { LabResult } from '$lib/api/labs';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
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
	data: { user: { roles: ['super_admin'] }, ...over } as never,
	form: form as never,
});

describe('GraphQL', () => {
	// GraphQL answers 200 and puts the failure in the body, so a status badge
	// alone reads as success.
	it('warns that a 200 carrying errors is not a success', () => {
		const { container } = render(GraphqlLab, {
			props: props({}, { graphql: result({ path: '/api/v1/graphql', body: '{"errors":[{"message":"boom"}]}' }) }),
		});
		expect(said(container)).toContain('check the body, not the status');
	});

	it('says nothing of the sort on a clean response', () => {
		const { container } = render(GraphqlLab, {
			props: props({}, { graphql: result({ path: '/api/v1/graphql', body: '{"data":{}}' }) }),
		});
		expect(said(container)).not.toContain('check the body, not the status');
	});

	// There is no sandbox on any lab, so every tab says so.
	it('keeps the no-sandbox warning', () => {
		const { container } = render(GraphqlLab, { props: props() });
		expect(said(container)).toContain('a write changes data and a delete removes it');
	});
});
