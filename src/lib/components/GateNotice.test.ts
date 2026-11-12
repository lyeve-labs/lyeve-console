// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GateNotice from './GateNotice.svelte';
import type { Gate } from '$lib/api/gate';
import { BUSY } from '$lib/outage';

const state = vi.hoisted(() => ({ page: { url: new URL('http://localhost/admin/cache?tab=rules&offset=50#top') } }));
vi.mock('$app/state', () => state);

afterEach(cleanup);
beforeEach(() => {
	state.page.url = new URL('http://localhost/admin/cache?tab=rules&offset=50#top');
});

const ABSENT = 'The cache plugin is not part of this build, so nothing is cached.';

function mount(gate: Gate) {
	return render(GateNotice, { props: { gate, title: 'Cache', absent: ABSENT } });
}

describe('GateNotice', () => {
	it('says in the page\'s own words what a missing route means', () => {
		const { container } = mount({ state: 'absent' });
		expect(container.textContent).toContain(ABSENT);
	});

	it('draws a refused read as not enabled, with the link the refusal names', () => {
		const { getByTestId, getByRole } = mount({ state: 'locked', upgradeUrl: '/admin/settings/license?plugin=cache' });
		expect(getByTestId('not-enabled')).toBeTruthy();
		expect(getByRole('link', { name: 'How to enable it' }).getAttribute('href')).toBe('/admin/settings/license?plugin=cache');
	});

	it('states a ceiling with the numbers the refusal carried', () => {
		const { container } = mount({ state: 'full', limit: 7, current: 7, upgradeUrl: '' });
		expect(container.textContent).toContain('Limit reached for cache');
		expect(container.textContent).toContain("You're using 7 of 7");
	});

	it('reads the limit heading the same for a plural title', () => {
		const { container } = render(GateNotice, {
			props: { gate: { state: 'full', limit: 3, current: 3, upgradeUrl: '' }, title: 'Content types', absent: ABSENT },
		});
		expect(container.textContent).toContain('Limit reached for content types');
	});

	it('reports a failed read as a failure', () => {
		const { container } = mount({ state: 'error', message: 'The cache could not be read.' });
		expect(container.textContent).toContain('The cache could not be read.');
	});

	it('draws nothing for a read that answered', () => {
		const { container } = mount({ state: 'ok' });
		expect(container.textContent?.trim()).toBe('');
	});
});

describe('GateNotice for a role the engine refused', () => {
	it('names the feature the role cannot open and who to ask', () => {
		const { container } = mount({ state: 'forbidden' });
		expect(container.textContent?.trim()).toBe('Your role cannot open cache. Ask a super admin if you need it.');
	});

	it('is not drawn as a failure', () => {
		const { container } = mount({ state: 'forbidden' });
		expect(container.textContent).not.toContain('did not load');
		expect(container.querySelector('.text-danger')).toBeNull();
	});

	it('offers nothing to press, because trying again cannot change a role', () => {
		const { container } = mount({ state: 'forbidden' });
		expect(container.querySelector('a, button')).toBeNull();
	});
});

describe('GateNotice names a feature in a sentence in lower case', () => {
	const sentence = (title: string) =>
		render(GateNotice, { props: { gate: { state: 'forbidden' }, title, absent: ABSENT } }).container.textContent?.trim();

	it('lowers a capitalized common noun', () => {
		expect(sentence('Public search')).toBe('Your role cannot open public search. Ask a super admin if you need it.');
		expect(sentence('Two-factor authentication')).toBe('Your role cannot open two-factor authentication. Ask a super admin if you need it.');
	});

	it('keeps a first word spelled with more than its first capital', () => {
		for (const title of ['API keys', 'GraphQL schema', 'OAuth providers', 'A/B testing', 'gRPC']) {
			expect(sentence(title)).toBe(`Your role cannot open ${title}. Ask a super admin if you need it.`);
		}
	});
});

describe('GateNotice with a heading-only title', () => {
	const named = (gate: Gate) =>
		render(GateNotice, { props: { gate, title: 'The schema list', absent: ABSENT } });

	it('names the subject in lower case inside the role refusal', () => {
		const { container } = named({ state: 'forbidden' });
		expect(container.textContent?.trim()).toBe('Your role cannot open the schema list. Ask a super admin if you need it.');
	});

	it('names the subject in lower case inside the outage sentence', () => {
		const { container } = named({ state: 'unavailable' });
		expect(container.textContent).toContain('The engine is unavailable, so the schema list did not load.');
	});

	it('names the subject in lower case inside the limit heading', () => {
		const { container } = named({ state: 'full', limit: 3, current: 3, upgradeUrl: '' });
		expect(container.textContent).toContain('Limit reached for the schema list');
	});
});

describe('GateNotice for a read nothing answered', () => {
	it('says it is temporary and names what did not load', () => {
		const { container } = mount({ state: 'unavailable' });
		expect(container.textContent).toContain('Temporarily unavailable');
		expect(container.textContent).toContain(
			'The engine is unavailable, so cache did not load. Try again in a moment.',
		);
	});

	it('is not drawn as a failure', () => {
		const { container } = mount({ state: 'unavailable' });
		expect(container.querySelector('.text-danger')).toBeNull();
	});
});

describe('GateNotice for a read the engine refused for the rate', () => {
	it('says so in the words every surface uses for it', () => {
		const { container } = mount({ state: 'busy' });
		expect(container.textContent).toContain(BUSY.title);
		expect(container.textContent).toContain(BUSY.body);
	});

	it('is not drawn as an outage or a failure', () => {
		const { container } = mount({ state: 'busy' });
		expect(container.textContent).not.toContain('did not load');
		expect(container.querySelector('.text-danger')).toBeNull();
	});
});

describe('Try again', () => {
	function retry(gate: Gate): HTMLAnchorElement | null {
		const { queryByRole } = mount(gate);
		return queryByRole('link', { name: 'Try again' }) as HTMLAnchorElement | null;
	}

	it('is a link to the current path and query, so it works before the page hydrates', () => {
		for (const gate of [{ state: 'unavailable' }, { state: 'busy' }, { state: 'error', message: 'The cache could not be read.' }] as Gate[]) {
			const link = retry(gate);
			expect(link?.getAttribute('href')).toBe('/admin/cache?tab=rules&offset=50');
			cleanup();
		}
	});

	it('asks for a fresh document, because the router keeps the data of an unchanged address', () => {
		// The two values the router reads as on.
		expect(['', 'true']).toContain(retry({ state: 'unavailable' })?.getAttribute('data-sveltekit-reload'));
	});

	it('follows the address the reader is on', () => {
		state.page.url = new URL('http://localhost/admin/jobs');
		expect(retry({ state: 'unavailable' })?.getAttribute('href')).toBe('/admin/jobs');
	});

	it('is offered only where waiting can help', () => {
		for (const gate of [
			{ state: 'absent' },
			{ state: 'locked', upgradeUrl: '' },
			{ state: 'full', limit: 1, current: 1, upgradeUrl: '' },
			{ state: 'forbidden' },
			{ state: 'ok' },
		] as Gate[]) {
			expect(retry(gate), gate.state).toBeNull();
			cleanup();
		}
	});
});
