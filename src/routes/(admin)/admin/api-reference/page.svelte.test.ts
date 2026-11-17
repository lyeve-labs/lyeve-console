// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The only call the page makes off the page is to the clipboard, which jsdom
// does not implement, so each case installs a writer it can read.
const writeText = vi.fn(async (_text: string) => {});

import ApiReferencePage from './+page.svelte';
import type { EndpointGroup } from '#lib/api/reference.ts';
import type { PageData } from './$types';

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});
beforeEach(() => {
	vi.clearAllMocks();
	Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

/** Two endpoints. Every row discloses at least its gate and a request preview. */
const groups: EndpointGroup[] = [
	{
		id: 'admin-media',
		label: 'Admin - Media',
		description: 'The media library.',
		server: 'admin',
		baseUrl: '/api/admin',
		endpoints: [
			{
				method: 'GET',
				path: '/api/admin/media',
				summary: 'List media',
				auth: 'bearer-or-cookie',
				params: [
					{ name: 'limit', in: 'query', type: 'int', required: false, description: 'Page size' },
				],
				response: { description: 'A page of items', example: '{ "items": [] }' },
			},
			{
				method: 'POST',
				path: '/api/admin/logout',
				summary: 'End the session',
				auth: 'cookie',
			},
		],
	},
];

/** The kit's copy control: the frame that holds the button, its tooltip and its live region. */
function copyFrame(button: HTMLElement): HTMLElement {
	let node = button.parentElement;
	while (node && !node.querySelector(':scope > [aria-live="polite"]')) node = node.parentElement;
	return node!;
}

function setup() {
	return render(ApiReferencePage, {
		props: { data: { groups, collections: 0, source: 'engine' } as unknown as PageData, form: null },
	});
}

/** The row's disclosure, which is the only control carrying expanded state. */
/** The endpoint rows' disclosures. The nav's own collapse and its plugin fold are not endpoints. */
function disclosures(container: HTMLElement) {
	const nav = container.querySelector('[data-testid="api-reference-nav"]');
	return ([...container.querySelectorAll('button[aria-expanded]')] as HTMLButtonElement[]).filter((b) => !nav?.contains(b));
}

describe('api reference rows', () => {
	it('keeps the copy control outside the disclosure', () => {
		// A row that is itself a role="button" holding the copy button makes the
		// two one tab stop, and a screen reader reaches the row and never the
		// control inside it.
		const { container } = setup();

		const copy = screen.getByRole('button', { name: 'Copy the path /api/admin/media' });
		const [disclosure] = disclosures(container);

		expect(disclosure).toBeTruthy();
		expect(disclosure.contains(copy), 'the copy button sits inside the disclosure').toBe(false);
	});

	it('leaves no element standing in for a button', () => {
		const { container } = setup();

		expect(container.querySelector('[role="button"]')).toBeNull();
	});

	it('gives every endpoint one disclosure, since each carries its gate and a request', () => {
		const { container } = setup();

		expect(disclosures(container)).toHaveLength(2);
	});

	it('opens to the gate and a request a reader can paste', async () => {
		const { container } = setup();
		const [first] = disclosures(container);
		await fireEvent.click(first);
		const panel = document.getElementById(first.getAttribute('aria-controls')!)!;
		expect(panel.textContent).toContain('A bearer token or the admin session cookie');
		const pres = [...panel.querySelectorAll('pre')];
		expect(pres.at(-1)?.textContent).toContain(`curl -X GET 'http://localhost:3002/api/admin/media'`);
	});

	it('shows no summary for a route the document only echoed, and folds the plugins in the rail', () => {
		const withPlugin = [
			...groups,
			{
				id: 'plugin-waf',
				label: 'Plugin \u00b7 waf',
				description: '',
				server: 'admin',
				baseUrl: '/api/admin',
				endpoints: [{ method: 'GET', path: '/api/admin/waf/config', summary: 'GET /api/admin/waf/config', auth: 'bearer-or-cookie' }],
			},
		] as EndpointGroup[];
		const { container, getByRole, queryByRole } = render(ApiReferencePage, {
			props: { data: { groups: withPlugin, collections: 0, source: 'engine' } as unknown as PageData, form: null },
		});
		// The path shows once, not as its own summary beside itself.
		const row = [...container.querySelectorAll('span')].filter((s) => s.textContent?.trim() === 'GET /api/admin/waf/config');
		expect(row).toHaveLength(0);
		const fold = getByRole('button', { name: /Plugins \(1\)/ });
		expect(fold.className).toContain('coarse:min-h-control');
		expect(fold.getAttribute('aria-expanded')).toBe('false');
		expect(queryByRole('button', { name: 'waf' })).toBeNull();
	});

	it('says when it is showing the catalog instead of the engine', () => {
		const { container } = render(ApiReferencePage, {
			props: { data: { groups, collections: 0, source: 'catalog' } as unknown as PageData, form: null },
		});
		expect(container.textContent).toContain('Showing the built-in catalog');
	});

	it('reports the disclosure state and names the panel it opens', async () => {
		const { container } = setup();
		const [disclosure] = disclosures(container);

		expect(disclosure.getAttribute('aria-expanded')).toBe('false');
		expect(
			disclosure.getAttribute('aria-controls'),
			'a collapsed row names a panel that is not on the page',
		).toBeNull();

		await fireEvent.click(disclosure);

		expect(disclosure.getAttribute('aria-expanded')).toBe('true');
		// getElementById, because aria-controls is matched by id and not by
		// selector: the key it is built from carries the endpoint path.
		const panelId = disclosure.getAttribute('aria-controls');
		expect(panelId).toBeTruthy();
		expect(document.getElementById(panelId as string)).toBeTruthy();
	});

	it('copies without opening the row', async () => {
		// The copy button sits beside the disclosure rather than inside it, so
		// its click never reaches the row.
		const { container } = setup();
		const [disclosure] = disclosures(container);

		await fireEvent.click(screen.getByRole('button', { name: 'Copy the path /api/admin/media' }));

		expect(writeText).toHaveBeenCalledWith('/api/admin/media');
		expect(disclosure.getAttribute('aria-expanded')).toBe('false');
	});

	it('confirms a copy for a second and a half', async () => {
		vi.useFakeTimers();
		setup();
		const copy = screen.getByRole('button', { name: 'Copy the path /api/admin/media' });
		const status = copyFrame(copy).querySelector('[aria-live="polite"]')!;

		await fireEvent.click(copy);
		await vi.advanceTimersByTimeAsync(0);
		expect(status.textContent).toBe('Copied');

		await vi.advanceTimersByTimeAsync(1499);
		expect(status.textContent).toBe('Copied');
		await vi.advanceTimersByTimeAsync(1);
		expect(status.textContent).toBe('');
	});

	// A code block's copy control stays out of the way until the block is
	// hovered or the control is reached by keyboard. Revealing it on any focus
	// left it standing after a mouse click until focus moved on.
	it('reveals a code block copy control on keyboard focus, not on a click', async () => {
		const { container } = setup();
		await fireEvent.click(disclosures(container)[0]);

		const copy = screen.getByRole('button', { name: 'Copy a curl request for GET /api/admin/media' });
		const wrapper = copyFrame(copy);
		expect(wrapper.classList.contains('opacity-0')).toBe(true);
		expect(wrapper.classList.contains('has-[:focus-visible]:opacity-100')).toBe(true);
		expect([...wrapper.classList].some((c) => c.startsWith('focus-within:'))).toBe(false);
	});

	it('copies the request preview from an open row', async () => {
		const { container } = setup();
		await fireEvent.click(disclosures(container)[0]);

		await fireEvent.click(screen.getByRole('button', { name: 'Copy a curl request for GET /api/admin/media' }));

		expect(writeText).toHaveBeenCalledTimes(1);
		expect(writeText.mock.calls[0][0]).toContain('/api/admin/media');
	});

	it('names every copy control by what it copies', async () => {
		const { container } = setup();
		await fireEvent.click(disclosures(container)[0]);

		expect(
			screen.getByRole('button', {
				name: 'Copy the example response body for GET /api/admin/media',
			}),
		).toBeTruthy();
	});

	it('shows a tooltip on every icon-only copy control naming what it copies', async () => {
		const { container } = setup();
		await fireEvent.click(disclosures(container)[0]);

		for (const name of [
			'Copy the path /api/admin/media',
			'Copy a curl request for GET /api/admin/media',
			'Copy the example response body for GET /api/admin/media',
		]) {
			const button = screen.getByRole('button', { name });
			expect(copyFrame(button).textContent, name).toContain(name);
			// The tooltip says what the name says, so it is not read a second time.
			expect(button.hasAttribute('aria-describedby'), name).toBe(false);
		}
	});

	it('names the search box for a reader who cannot see the placeholder', () => {
		setup();

		expect(screen.getByLabelText('Search endpoints')).toBeTruthy();
	});

	// The search narrows the list, so it sits on the list's row, not the header.
	it('puts the search on the list toolbar', () => {
		setup();

		const toolbar = screen.getByRole('toolbar', { name: 'Filter endpoints' });
		expect(toolbar.querySelector('#endpoint-search')).not.toBeNull();
	});
});

/*
 * Running an endpoint from the page that documents it.
 *
 * The reader already holds a session against the engine being documented, so
 * a GET needs nothing set up. A write is a different thing entirely: this page
 * looks like documentation rather than like a console, and a DELETE here
 * deletes real data.
 */
describe('try it', () => {
	const withMethod = (method: string, canSeeAdmin: boolean) =>
		render(ApiReferencePage, {
			props: {
				data: {
					groups: [
						{
							id: 'content',
							label: 'Content',
							description: '',
							server: 'api',
							endpoints: [
								{
									method,
									path: '/api/v1/content/post',
									summary: `${method} /api/v1/content/post`,
									auth: 'bearer',
								},
							],
						},
					],
					collections: 0,
					source: 'engine',
					canSeeAdmin,
				} as unknown as PageData,
				form: null,
			},
		});

	it('offers a read to anyone who can see the page', async () => {
		const { getByRole, container } = withMethod('GET', false);
		await fireEvent.click(getByRole('button', { name: /GET \/api\/v1\/content\/post/ }));
		expect(container.textContent).toContain('Try it');
		expect(container.textContent).toContain('Send');
	});

	// The native element draws the browser's own marker and cannot be driven
	// from the page. The kit's disclosure is a button that says its state.
	it('is the kit disclosure, not the native element', async () => {
		const { getByRole, container } = withMethod('GET', false);
		await fireEvent.click(getByRole('button', { name: /GET \/api\/v1\/content\/post/ }));
		expect(container.querySelector('details')).toBeNull();
		expect(getByRole('button', { name: /Try it/ }).getAttribute('aria-expanded')).toBe('false');
	});

	it('marks a write as one before it is opened', async () => {
		const { getByRole, container } = withMethod('DELETE', true);
		await fireEvent.click(getByRole('button', { name: /DELETE \/api\/v1\/content\/post/ }));
		expect(container.textContent).toContain('changes data');
	});

	// The role is checked again on the server. This is the half that stops an
	// admin being offered a button that would only be refused.
	it('offers an admin no way to send a write, and says why', async () => {
		const { getByRole, container } = withMethod('DELETE', false);
		await fireEvent.click(getByRole('button', { name: /DELETE \/api\/v1\/content\/post/ }));
		expect(container.textContent).toContain('Only a super admin can send');
		expect(container.textContent).not.toContain('I understand this');
	});

	it('makes a super admin acknowledge the one call', async () => {
		const { getByRole, container } = withMethod('DELETE', true);
		await fireEvent.click(getByRole('button', { name: /DELETE \/api\/v1\/content\/post/ }));
		expect(container.textContent).toContain('I understand this DELETE');
	});

	// A path still carrying {id} asks the engine for a record whose id is the
	// literal text, which answers 404 and reads as the endpoint being broken.
	it('says which parameters are still placeholders', async () => {
		const { getByRole, container } = render(ApiReferencePage, {
			props: {
				data: {
					groups: [
						{
							id: 'content',
							label: 'Content',
							description: '',
							server: 'api',
							endpoints: [
								{
									method: 'GET',
									path: '/api/v1/content/{schema}/{id}',
									summary: 'GET one',
									auth: 'bearer',
								},
							],
						},
					],
					collections: 0,
					source: 'engine',
					canSeeAdmin: true,
				} as unknown as PageData,
				form: null,
			},
		});
		await fireEvent.click(getByRole('button', { name: /GET one/ }));
		expect(container.textContent).toContain('{schema}');
		expect(container.textContent).toContain('{id}');
	});
});
