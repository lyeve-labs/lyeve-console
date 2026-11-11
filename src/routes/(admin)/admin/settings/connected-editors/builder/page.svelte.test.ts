// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Each form's submit handler, by its action, so a test can play an outcome through it.
const forms = vi.hoisted(() => ({ submits: new Map<string, (input: unknown) => Promise<unknown>>() }));
vi.mock('$app/forms', () => ({
	enhance: (el: HTMLFormElement, submit: (input: unknown) => Promise<unknown>) => {
		forms.submits.set(el.getAttribute('action') ?? '', submit);
		return { destroy() {} };
	},
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(async () => {}) }));
const app = vi.hoisted(() => ({
	page: { url: new URL('http://admin/admin/settings/connected-editors/builder') },
	navigating: { to: null as null | { url: URL } },
}));
vi.mock('$app/state', () => app);

const kit = vi.hoisted(() => ({ confirm: vi.fn(async (_t: string, _b?: string, _o?: unknown) => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, confirm: kit.confirm };
});

import Page from './+page.svelte';
import { invalidateAll } from '$app/navigation';
import { SAID, STATIC_SITES_REFUSED } from '$lib/api/connected-editors';
import { FORMS_TYPE_TAKEN, SUBMISSIONS_PUBLIC } from '$lib/api/form-destinations';

afterEach(cleanup);
beforeEach(() => {
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
	app.navigating.to = null;
	Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

function said(): string {
	return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

const SETTINGS = { allowed: true, lifetime_days: 90, show_schemas: ['posts', 'gone'], writes_per_minute: 120, max_writes_per_minute: 120 };

function props(over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: {
			gate: { state: 'ok' },
			settings: { ok: true, value: SETTINGS },
			schemas: ['posts', 'products'],
			schemasGate: null,
			formSchemas: [],
			schemaLabels: {},
			submissions: 'absent',
			formsTypeTaken: false,
			flows: null,
			formsPreset: null,
			sites: null,
			...over,
		} as never,
		form: form as never,
	};
}

/** Lets an outcome alert take its text, which it does two frames after it mounts. */
async function frames() {
	await new Promise((r) => setTimeout(r, 50));
	await tick();
}

describe('the page', () => {
	it('carries the strip with Builder settings marked', () => {
		render(Page, { props: props() });
		const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.trim() === 'Builder settings');
		expect(tab?.getAttribute('aria-selected')).toBe('true');
	});

	it('shows four skeleton rows while the settings load', () => {
		app.navigating.to = { url: new URL('http://admin/admin/settings/connected-editors/builder') };
		const { container } = render(Page, { props: props() });
		expect(container.querySelectorAll('[data-testid="settings-loading"] > *')).toHaveLength(4);
	});

	it.each([
		[{ state: 'absent' }, 'Builder connections are not included in this build.'],
		[{ state: 'withheld' }, SAID.withheld],
	])('draws the area gate in place of the settings', (gate, words) => {
		render(Page, { props: props({ gate, settings: null }) });
		expect(said()).toContain(words);
		expect(said()).not.toContain('Writes a minute for each connection');
	});

	it('says so when the settings route is missing from the plugin', () => {
		render(Page, { props: props({ settings: { ok: false, gate: { state: 'absent' } } }) });
		expect(said()).toContain('Builder settings need a newer version of the builder plugin.');
	});

	it('says so offline and holds every save until the connection returns', async () => {
		render(Page, { props: props() });
		window.dispatchEvent(new Event('offline'));
		await tick();
		expect(said()).toContain("You're offline. Changes on this page wait until you reconnect.");
		const save = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save') as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		window.dispatchEvent(new Event('online'));
		await tick();
		expect(said()).not.toContain("You're offline.");
	});
});

describe('the settings card', () => {
	it('draws a refused settings read as a failure', () => {
		render(Page, { props: props({ settings: { ok: false, gate: { state: 'unavailable' } } }) });
		expect(said()).toContain('builder settings did not load');
	});

	it('states that the builder is off, and keeps saying it', () => {
		render(Page, { props: props({ settings: { ok: true, value: { ...SETTINGS, allowed: false } } }) });
		expect(said()).toContain('The builder is off. Connected browsers cannot save.');
		// A standing condition is no outcome, so it never clears itself.
		const live = [...document.querySelectorAll('[aria-live="polite"]')].some((a) => a.textContent?.includes('The builder is off'));
		expect(live).toBe(false);
	});

	const allowSwitch = () => document.querySelector('[role="switch"]') as HTMLButtonElement;

	it('switches the builder with a Toggle that applies at once', async () => {
		const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
		render(Page, { props: props({ settings: { ok: true, value: { ...SETTINGS, allowed: false } } }) });
		expect(allowSwitch().getAttribute('aria-label')).toBe('Enabled');
		expect(allowSwitch().getAttribute('aria-checked')).toBe('false');
		await fireEvent.click(allowSwitch());
		await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
		const form = submit.mock.contexts[0] as HTMLFormElement;
		expect(new FormData(form).get('allowed')).toBe('on');
		// Turning it on asks nothing.
		expect(kit.confirm).not.toHaveBeenCalled();
		submit.mockRestore();
	});

	it('asks before it turns the builder off, and stays on when the person says no', async () => {
		const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
		render(Page, { props: props() });
		await fireEvent.click(allowSwitch());
		await waitFor(() =>
			expect(kit.confirm).toHaveBeenCalledWith(
				'Turn off the builder?',
				'Connected browsers stop saving immediately.',
				{ confirmLabel: 'Turn off' },
			),
		);
		await tick();
		expect(allowSwitch().getAttribute('aria-checked')).toBe('true');
		expect(submit).not.toHaveBeenCalled();
		submit.mockRestore();
	});

	it('saves the other settings together under one Save', () => {
		render(Page, { props: props() });
		const cards = [...document.querySelectorAll('form[action="?/setting"]')];
		expect(cards).toHaveLength(3);
		const limits = cards.find((f) => f.querySelector('input[name="field"][value="limits"]')) as HTMLFormElement;
		expect(limits.querySelector('[name="lifetime_days"]')).not.toBeNull();
		expect(limits.querySelector('#writes-per-minute')).not.toBeNull();
		expect(limits.querySelector('input[name="schemas_offered"]')).not.toBeNull();
		const saves = [...limits.querySelectorAll('button[type="submit"]')].map((b) => b.textContent?.trim());
		expect(saves).toEqual(['Save']);
		// The switch saves itself, so its card has no Save at all.
		const allowed = cards.find((f) => f.querySelector('input[name="field"][value="allowed"]')) as HTMLFormElement;
		expect(allowed.querySelector('button[type="submit"]')).toBeNull();
	});

	it('names the lifetime and the write limit in plain words', () => {
		render(Page, { props: props() });
		expect(said()).toContain('Valid for');
		expect(said()).not.toContain('Lasts');
		expect(said()).toContain('Applies to connections approved from now on.');
		expect(said()).toContain('When a connection reaches this limit, the builder waits and saves again.');
	});

	it('draws a failed schema list as a failure, never as none to offer', () => {
		render(Page, {
			props: props({
				schemas: [],
				schemasGate: { state: 'error', message: 'Could not load content types. Pages keep showing the content types saved before.' },
			}),
		});
		expect(said()).toContain('Could not load content types. Pages keep showing the content types saved before.');
		expect(said()).toContain('Try again');
		expect(said()).not.toContain('Create a content type');
		// Nothing offered, so a Save clears no stored schema.
		expect(document.querySelector('input[name="schemas_offered"]')).toBeNull();
	});

	it('says how to offer a schema when there is none', () => {
		render(Page, { props: props({ schemas: [] }) });
		expect(said()).toContain('Create a content type to show its entries on pages.');
		expect(document.querySelector('input[name="schemas_offered"]')).toBeNull();
	});

	it('drops a schema that no longer exists', () => {
		render(Page, { props: props() });
		const labels = [...document.querySelectorAll('label')].map((l) => l.textContent?.trim());
		expect(labels).toContain('posts');
		expect(labels).not.toContain('gone');
	});

	it('says a setting saved, and lets the words clear themselves', async () => {
		render(Page, { props: props({}, { saved: { field: 'limits', settings: SETTINGS } }) });
		await frames();
		expect(said()).toContain('Settings saved.');
	});

	it('lands a refused value on its field', () => {
		render(Page, {
			props: props({}, { settingError: { field: 'writes_per_minute', message: 'Writes must be between 1 and 120 a minute.' } }),
		});
		expect(said()).toContain('Writes must be between 1 and 120 a minute.');
	});
});

describe('where forms can send', () => {
	const FORM_SETTINGS = { ...SETTINGS, form_schemas: ['form_submissions'], form_flows: ['notify', 'gone'] };
	const NONE_ALLOWED = { ...SETTINGS, form_schemas: [], form_flows: [] };
	const FORM_SCHEMAS = [
		{ name: 'form_submissions', label: 'Form submissions' },
		{ name: 'contact_messages', label: 'Contact messages' },
	];
	const flowList = (flows: unknown[], over: Record<string, unknown> = {}) => ({ ok: true, value: { flows, complete: true, eventKnown: true, ...over } });
	const FLOWS = [
		{ slug: 'notify', name: 'Notify sales', status: 'disabled', formTrigger: true },
		{ slug: 'quiet', name: 'Quiet', status: 'disabled', formTrigger: true },
		{ slug: 'nightly', name: 'Nightly report', status: 'active', formTrigger: false },
	];
	const PRESET = { ok: true, value: true };

	function formsCard(): HTMLFormElement {
		return document.querySelector('form[action="?/setting"] input[name="field"][value="forms"]')?.closest('form') as HTMLFormElement;
	}

	function notes(): string[] {
		return [...document.querySelectorAll('[data-testid="flow-notes"] li')].map((li) => (li.textContent ?? '').replace(/\s+/g, ' ').trim());
	}

	it('offers the content types and only the flows a form can start, and warns only beside allowed flows', () => {
		render(Page, { props: props({ settings: { ok: true, value: FORM_SETTINGS }, formSchemas: FORM_SCHEMAS, flows: flowList(FLOWS) }) });
		const card = formsCard();
		expect(card.textContent).toContain('Form submissions');
		expect(card.textContent).toContain('Notify sales');
		expect(card.textContent).not.toContain('Nightly report');
		expect(notes()).toEqual([
			'Notify sales: This flow is not active, so forms that send to it start nothing.',
			'gone: This flow no longer exists. Untick it, then save.',
		]);
		expect(card.querySelector('input[name="form_schemas_offered"]')).not.toBeNull();
		expect(card.querySelector('input[name="form_flows_offered"]')).not.toBeNull();
	});

	it('warns the same way when the flow list is long', () => {
		const many = Array.from({ length: 14 }, (_, i) => ({ slug: `flow-${i}`, name: `Flow ${i}`, status: 'active', formTrigger: true }));
		const allowed = { ...SETTINGS, form_schemas: ['form_submissions'], form_flows: ['flow-1', 'a-very-long-flow-slug-that-names-nothing-any-more'] };
		render(Page, { props: props({ settings: { ok: true, value: allowed }, formSchemas: FORM_SCHEMAS, flows: flowList([...many, ...FLOWS]) }) });
		expect(document.querySelector('#form-flows')).not.toBeNull();
		expect(notes()).toEqual(['a-very-long-flow-slug-that-names-nothing-any-more: This flow no longer exists. Untick it, then save.']);
		// A long slug wraps instead of widening the page.
		expect(document.querySelector('[data-testid="flow-notes"] .font-mono')?.className).toContain('break-all');
	});

	it('says the content types failed in the forms card in its own words', () => {
		render(Page, {
			props: props({
				settings: { ok: true, value: FORM_SETTINGS },
				schemasGate: { state: 'error', message: 'Could not load content types. Pages keep showing the content types saved before.' },
			}),
		});
		expect(formsCard().textContent).toContain('Could not load content types. Forms keep sending to the content types saved before.');
		expect(formsCard().textContent).not.toContain('Pages keep showing');
	});

	it('draws a failed flow list as a failure with a way to try again, and saves no flow list', () => {
		render(Page, {
			props: props({
				settings: { ok: true, value: FORM_SETTINGS },
				formSchemas: FORM_SCHEMAS,
				flows: { ok: false, gate: { state: 'error', message: 'Could not load flows.' } },
			}),
		});
		expect(said()).toContain('Could not load flows.');
		expect(said()).toContain('Try again');
		expect(said()).not.toContain('No flow starts from a builder form yet.');
		expect(formsCard().querySelector('input[name="form_flows_offered"]')).toBeNull();
	});

	it('says an older flow plugin cannot offer flows, and keeps the allowed ones', () => {
		render(Page, { props: props({ settings: { ok: true, value: FORM_SETTINGS }, formSchemas: FORM_SCHEMAS, flows: flowList(FLOWS, { eventKnown: false }) }) });
		expect(said()).toContain('Choosing flows needs a newer version of the flow plugin.');
		expect(said()).not.toContain('This flow no longer exists.');
		expect(formsCard().querySelector('input[name="form_flows_offered"]')).toBeNull();
	});

	it('says the flow plugin is not running instead of offering no flows', () => {
		render(Page, { props: props({ settings: { ok: true, value: FORM_SETTINGS }, formSchemas: FORM_SCHEMAS }) });
		expect(said()).toContain('The flow plugin is not running on this engine, so forms cannot start flows.');
	});

	it('names a type forms can no longer send to by its label', () => {
		render(Page, {
			props: props({
				settings: { ok: true, value: { ...FORM_SETTINGS, form_schemas: ['form_submissions', 'posts'] } },
				formSchemas: FORM_SCHEMAS,
				schemaLabels: { posts: 'Blog posts' },
			}),
		});
		expect(said()).toContain('Forms cannot send to Blog posts any more.');
	});

	it('carries the forms anchor a builder links to, on the card that offers the preset', () => {
		render(Page, { props: props({ settings: { ok: true, value: NONE_ALLOWED }, formsPreset: PRESET }) });
		const anchor = document.getElementById('forms');
		expect(anchor?.textContent).toContain('Where forms can send');
		expect(anchor?.querySelector('[data-testid="forms-preset"]')).not.toBeNull();
	});

	it('offers the forms preset while its submissions type is absent', () => {
		render(Page, { props: props({ settings: { ok: true, value: NONE_ALLOWED }, formsPreset: PRESET }) });
		const preset = document.querySelector('[data-testid="forms-preset"]');
		expect(preset?.textContent).toContain('Add the Forms and Form submissions content types');
		expect(preset?.querySelector('form[action="?/formsPreset"]')).not.toBeNull();
	});

	it('offers to allow the submissions type that exists already, whatever the catalog', () => {
		render(Page, { props: props({ settings: { ok: true, value: NONE_ALLOWED }, formSchemas: FORM_SCHEMAS, submissions: 'private' }) });
		expect(said()).toContain('Let forms save posts into the Form submissions content type you already have.');
		expect(document.querySelector('form[action="?/formsPreset"]')).not.toBeNull();
	});

	it('says why instead of offering the preset when the submissions type is public', () => {
		render(Page, { props: props({ settings: { ok: true, value: NONE_ALLOWED }, submissions: 'public', formsPreset: PRESET }) });
		expect(said()).toContain(SUBMISSIONS_PUBLIC);
		expect(document.querySelector('form[action="?/formsPreset"]')).toBeNull();
		expect([...document.querySelectorAll('a[href="/admin/schema"]')].map((a) => a.textContent)).toEqual(['schema builder']);
	});

	it('says why instead of offering the preset when a forms type of the tenant is in the way', () => {
		render(Page, { props: props({ settings: { ok: true, value: NONE_ALLOWED }, formsTypeTaken: true, formsPreset: PRESET }) });
		expect(said()).toContain(FORMS_TYPE_TAKEN);
		expect(document.querySelector('form[action="?/formsPreset"]')).toBeNull();
		expect(document.querySelector('[data-testid="forms-type-taken"] a')?.getAttribute('href')).toBe('/admin/schema');
	});

	it('draws a failed preset catalog as a failure', () => {
		render(Page, {
			props: props({
				settings: { ok: true, value: NONE_ALLOWED },
				formsPreset: { ok: false, gate: { state: 'error', message: 'Could not load the content type presets.' } },
			}),
		});
		expect(said()).toContain('Could not load the content type presets.');
		expect(document.querySelector('[data-testid="forms-preset-link"]')).toBeNull();
	});

	it('links the schema builder when the preset answered 404', () => {
		render(Page, { props: props({ settings: { ok: true, value: NONE_ALLOWED }, formsPreset: PRESET }, { presetMissing: true }) });
		expect(document.querySelector('form[action="?/formsPreset"]')).toBeNull();
		expect(document.querySelector('[data-testid="forms-preset-link"] a')?.getAttribute('href')).toBe('/admin/schema');
	});

	it('names what was created when the preset is applied', async () => {
		render(Page, { props: props({ settings: { ok: true, value: FORM_SETTINGS }, formSchemas: FORM_SCHEMAS }, { presetApplied: { created: true, settings: FORM_SETTINGS } }) });
		await frames();
		expect(said()).toContain('The Forms and Form submissions content types were created. Forms can send to Form submissions now.');
	});

	it.each([
		[{ presetCreated: true, presetError: 'created' }, 1],
		[{ presetError: 'refused' }, 0],
	])('reloads the page data only when setup created the types and the save after them failed', async (data, reloads) => {
		vi.mocked(invalidateAll).mockClear();
		render(Page, { props: props({ settings: { ok: true, value: NONE_ALLOWED }, formsPreset: PRESET }) });
		const submit = forms.submits.get('?/formsPreset');
		const after = (await submit?.({ cancel: vi.fn(), formData: new FormData() })) as (opts: unknown) => Promise<void>;
		const update = vi.fn(async () => {});
		await after({ result: { type: 'failure', status: 422, data }, update });
		expect(update).toHaveBeenCalledTimes(1);
		expect(invalidateAll).toHaveBeenCalledTimes(reloads);
	});

	it('offers no preset once its submissions type is allowed', () => {
		render(Page, { props: props({ settings: { ok: true, value: FORM_SETTINGS }, formSchemas: FORM_SCHEMAS, formsPreset: PRESET }) });
		expect(document.querySelector('[data-testid="forms-preset"]')).toBeNull();
	});
});

describe('static sites', () => {
	const A = '0a9e2c4e-1d4b-4c9a-9f3e-5b1c2d3e4f50';
	const B = '7f1b2a3c-4d5e-4f60-8a9b-0c1d2e3f4a5b';
	const GONE = '11111111-2222-4333-8444-555555555555';
	const STATIC = { ...SETTINGS, form_schemas: [], form_flows: [], form_static_sites: [A, GONE] };
	const SITES = { ok: true, value: [{ id: A, name: 'Agency' }, { id: B, name: 'Shop' }] };

	function formsCard(): HTMLFormElement {
		return document.querySelector('form[action="?/setting"] input[name="field"][value="forms"]')?.closest('form') as HTMLFormElement;
	}

	function chosen(): string[] {
		return [...formsCard().querySelectorAll('input[name="form_static_sites"]')].map((i) => (i as HTMLInputElement).value);
	}

	it('offers the tenant\'s sites in the forms card and saves the list it offered', () => {
		render(Page, { props: props({ settings: { ok: true, value: STATIC }, sites: SITES }) });
		const card = formsCard();
		expect(card.querySelector('#form-static-sites')).not.toBeNull();
		expect(card.textContent).toContain('Static sites');
		expect(card.querySelector('input[name="form_static_sites_offered"]')).not.toBeNull();
		// A site deleted since it was chosen is not offered, so the next save drops it.
		expect(chosen()).toEqual([A]);
	});

	it('says how to get a site when the tenant has none', () => {
		render(Page, { props: props({ settings: { ok: true, value: STATIC }, sites: { ok: true, value: [] } }) });
		expect(formsCard().textContent).toContain('No sites yet. Create a site in the builder to choose it here.');
		expect(formsCard().querySelector('#form-static-sites')).toBeNull();
	});

	it('draws a failed site list as a failure with a way to try again, and saves no site list', () => {
		const message = 'Could not load sites. The static sites saved before stay as they are.';
		render(Page, { props: props({ settings: { ok: true, value: STATIC }, sites: { ok: false, gate: { state: 'error', message } } }) });
		expect(formsCard().textContent).toContain(message);
		expect(said()).toContain('Try again');
		expect(formsCard().querySelector('input[name="form_static_sites_offered"]')).toBeNull();
		expect(chosen()).toEqual([]);
	});

	it('lands a refused site list on its field, once', () => {
		render(Page, {
			props: props(
				{ settings: { ok: true, value: STATIC }, sites: SITES },
				{ settingError: { field: 'form_static_sites', message: STATIC_SITES_REFUSED } },
			),
		});
		expect(said().split(STATIC_SITES_REFUSED)).toHaveLength(2);
		expect(formsCard().textContent).toContain(STATIC_SITES_REFUSED);
	});
});
