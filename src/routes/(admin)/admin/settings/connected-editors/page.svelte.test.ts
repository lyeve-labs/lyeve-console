// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Submit = (input: { cancel: () => void; action: URL }) => Promise<unknown>;
const forms = vi.hoisted(() => ({ submits: new Map<string, unknown>() }));
vi.mock('$app/forms', () => ({
	enhance: (form: HTMLFormElement, submit: unknown) => {
		forms.submits.set(form.getAttribute('action') ?? '', submit);
		return { destroy() {} };
	},
}));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));
const app = vi.hoisted(() => ({
	page: { url: new URL('http://admin/admin/settings/connected-editors') },
	navigating: { to: null as null | { url: URL } },
}));
vi.mock('$app/state', () => app);

const kit = vi.hoisted(() => ({ confirm: vi.fn(async (_t: string, _b?: string, _o?: unknown) => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, confirm: kit.confirm };
});

import Page from './+page.svelte';
import { SAID, type Connection, type ConnectionRequest } from '$lib/api/connected-editors';

afterEach(cleanup);
beforeEach(() => {
	forms.submits.clear();
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
	app.navigating.to = null;
	Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

function said(): string {
	return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

function connection(over: Partial<Connection> = {}): Connection {
	return {
		id: 'c1',
		approver_email: 'tom@example.com',
		fingerprint: 'B704:E15D:22C8:91AF',
		label: 'Tom laptop',
		origin: 'https://builder.example',
		approved_at: '2026-10-02T10:00:00Z',
		last_used_at: '2026-10-09T10:00:00Z',
		expires_at: '2026-12-31T10:00:00Z',
		status: 'approved',
		...over,
	};
}

const REQUEST: ConnectionRequest = {
	fingerprint: '3FA2:9C11:5B07:E48D',
	label: 'Maria laptop',
	origin: 'https://builder.example',
	requested_at: '2026-10-30T10:00:00Z',
	code_expires_at: '2099-01-01T00:00:00Z',
	would_expire_at: '2099-04-01T00:00:00Z',
	lifetime_days: 90,
	requester_network: '203.0.113.7',
	approver_address: '203.0.113.7',
	same_network: true,
};

const SETTINGS = { allowed: true, lifetime_days: 90, show_schemas: ['posts', 'gone'], writes_per_minute: 120, max_writes_per_minute: 120 };

function props(over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: {
			connections: [connection()],
			total: 1,
			limit: 50,
			offset: 0,
			hasMore: false,
			gate: { state: 'ok' },
			owner: true,
			email: 'maria@example.com',
			roles: ['admin'],
			tenant: '',
			openApprove: false,
			mfaEnrolled: false,
			settings: { ok: true, value: SETTINGS },
			schemas: ['posts', 'products'],
			formSchemas: [],
			flows: null,
			formsPreset: false,
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

describe('the list', () => {
	it('shows the first-run words when no connection exists', () => {
		render(Page, { props: props({ connections: [], total: 0 }) });
		expect(said()).toContain('No builder connections yet');
		expect(said()).toContain('Connect from the builder, then approve the connection here with the code it shows.');
	});

	it('shows five skeleton rows while the list loads', () => {
		app.navigating.to = { url: new URL('http://admin/admin/settings/connected-editors?offset=50') };
		const { container } = render(Page, { props: props() });
		expect(container.querySelectorAll('[data-testid="connections-loading"] > *')).toHaveLength(5);
		expect(container.querySelector('[data-testid="settings-loading"]')).not.toBeNull();
	});

	it('names each column and each status in words', () => {
		render(Page, {
			props: props({
				connections: [connection(), connection({ id: 'c2', status: 'expired', approver_email: '' })],
				total: 2,
			}),
		});
		const heads = [...document.querySelectorAll('thead th')].map((t) => t.textContent?.trim());
		expect(heads).toEqual(['Person', 'Key', 'Approved', 'Last used', 'Expires', 'Status', 'Revoke']);
		expect(said()).toContain('Active');
		expect(said()).toContain('Expired');
		expect(said()).toContain('Removed person');
		// Only a live connection offers Revoke.
		expect(document.querySelectorAll('tbody button[aria-label^="Revoke"]')).toHaveLength(1);
	});

	it('never reads a last use in the future', () => {
		const ahead = new Date(Date.now() + 5 * 60_000).toISOString();
		render(Page, { props: props({ connections: [connection({ last_used_at: ahead })] }) });
		expect(said()).toContain('just now');
	});

	it('renders a hostile name as text, cut, with the full name in its title', () => {
		const name = `<img src=x onerror=alert(1)>${'x'.repeat(80)}`;
		render(Page, { props: props({ connections: [connection({ label: name })] }) });
		const cell = document.querySelector('tbody [dir="auto"]') as HTMLElement;
		expect(cell.getAttribute('title')).toBe(name);
		expect(Array.from(cell.textContent ?? '')).toHaveLength(60);
		expect(document.querySelector('tbody img')).toBeNull();
	});
});

describe('the gates', () => {
	it.each([
		[{ state: 'error', message: 'Could not load builder connections.' }, 'Could not load builder connections.'],
		[
			{ state: 'unavailable' },
			'The engine is unavailable, so builder connections did not load. Try again in a moment.',
		],
		[{ state: 'busy' }, 'Too many requests'],
		[{ state: 'absent' }, 'Builder connections are not included in this build.'],
		[{ state: 'forbidden' }, 'Your role cannot open builder connections.'],
		[
			{ state: 'withheld' },
			'A super admin turned off builder connections for this tenant. Ask them to turn it back on.',
		],
	])('draws a refused read as its gate, never as an empty list', (gate, words) => {
		render(Page, { props: props({ gate, connections: [] }) });
		expect(said()).toContain(words);
		expect(said()).not.toContain('No builder connections yet');
	});

	it('offers Try again on a gate a retry can change', () => {
		render(Page, { props: props({ gate: { state: 'unavailable' }, connections: [] }) });
		expect(said()).toContain('Try again');
	});

	it('offers nothing to press to a role that cannot read', () => {
		render(Page, { props: props({ gate: { state: 'forbidden' }, connections: [] }) });
		expect(said()).not.toContain('Try again');
	});

	it.each(['absent', 'forbidden', 'unavailable', 'withheld'])(
		'opens no approve dialog from the builder link while the gate is %s',
		async (state) => {
			render(Page, { props: props({ gate: { state }, connections: [], openApprove: true }) });
			await tick();
			expect(document.querySelector('[role="dialog"]')).toBeNull();
			expect(document.querySelector('#connected-editors-code')).toBeNull();
		},
	);

	it('opens the approve dialog from the builder link while the gate is ok', async () => {
		render(Page, { props: props({ openApprove: true }) });
		await tick();
		expect(document.querySelector('[role="dialog"]')).not.toBeNull();
	});
});

describe('revoking', () => {
	it("asks before it revokes, naming whose connection it is", async () => {
		render(Page, { props: props() });
		const cancel = vi.fn();
		await (forms.submits.get('?/revoke') as Submit)({ cancel, action: new URL('http://a/?/revoke') });
		expect(kit.confirm).toHaveBeenCalledWith(
			"Revoke tom@example.com's builder connection?",
			'That browser stops editing immediately.',
			{ confirmLabel: 'Revoke' },
		);
		expect(cancel).toHaveBeenCalled();
	});

	it('says whose connection was revoked, and lets the words clear themselves', async () => {
		render(Page, { props: props({}, { revoked: 'tom@example.com' }) });
		await frames();
		expect(said()).toContain("tom@example.com's connection revoked.");
		const alert = [...document.querySelectorAll('[aria-live="polite"]')].find((a) => a.textContent?.includes('connection revoked'));
		expect(alert).toBeTruthy();
	});

	it('shows a refused revoke as a failure', () => {
		render(Page, { props: props({}, { revokeError: SAID.revokeOutage }) });
		expect(said()).toContain(SAID.revokeOutage);
	});
});

describe('revoke all', () => {
	const revokeAllButton = () =>
		[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Revoke all') as HTMLButtonElement;

	it('is offered to owners only', () => {
		render(Page, { props: props({ owner: false, settings: null }) });
		expect(revokeAllButton()).toBeUndefined();
	});

	it('is disabled when no connection is active', () => {
		render(Page, { props: props({ connections: [connection({ status: 'revoked' })] }) });
		expect(revokeAllButton().disabled).toBe(true);
	});

	it('asks the question the page promises', async () => {
		render(Page, { props: props() });
		expect(revokeAllButton().disabled).toBe(false);
		const cancel = vi.fn();
		await (forms.submits.get('?/revokeAll') as Submit)({ cancel, action: new URL('http://a/?/revokeAll') });
		expect(kit.confirm).toHaveBeenCalledWith(
			'Revoke all builder connections?',
			'Every connected browser stops editing immediately, and every waiting request is declined.',
			{ confirmLabel: 'Revoke all', cancelLabel: 'Cancel' },
		);
	});

	it('counts what it revoked', async () => {
		render(Page, { props: props({}, { revokedAll: 3 }) });
		await frames();
		expect(said()).toContain('3 builder connections revoked.');
	});

	it('keeps a failure on screen with a way to try again', () => {
		render(Page, { props: props({}, { revokeAllFailed: true }) });
		expect(said()).toContain('Could not revoke the connections. Check their status in the list, then try again.');
		expect(said()).toContain('Try again');
	});
});

describe('offline', () => {
	it('says so and holds every write until the connection returns', async () => {
		render(Page, { props: props() });
		window.dispatchEvent(new Event('offline'));
		await tick();
		expect(said()).toContain("You're offline. Changes on this page wait until you reconnect.");
		expect((document.querySelector('tbody button[aria-label^="Revoke"]') as HTMLButtonElement).disabled).toBe(true);
		const all = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Revoke all') as HTMLButtonElement;
		expect(all.disabled).toBe(true);
		window.dispatchEvent(new Event('online'));
		await tick();
		expect(said()).not.toContain("You're offline.");
	});
});

describe('the approve drawer', () => {
	const approve = () =>
		[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Approve') as HTMLButtonElement;

	it('opens from the builder link with the warning first and no Approve until a request is found', async () => {
		render(Page, { props: props({ openApprove: true }) });
		await tick();
		expect(said()).toContain(
			'Approve only a code you started in the builder in the last 10 minutes. If someone sends you a code, they are asking for access to your pages.',
		);
		expect(approve()).toBeUndefined();
		await waitFor(() => expect(document.activeElement?.id).toBe('connected-editors-code'));
	});

	it('says under the code what to do, and beside a disabled Approve what it waits for', async () => {
		render(Page, { props: props({ openApprove: true }) });
		await tick();
		const reason = 'Enter the code the builder shows, then choose Find request.';
		const code = document.getElementById('connected-editors-code') as HTMLInputElement;
		expect(document.querySelector('label[for="connected-editors-code"]')?.textContent?.trim()).toBe('Code');
		expect(document.getElementById(code.getAttribute('aria-describedby') ?? '')?.textContent).toBe(reason);
		cleanup();
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', request: REQUEST } }) });
		await tick();
		expect(approve().getAttribute('aria-describedby')).toBeNull();
		window.dispatchEvent(new Event('offline'));
		await tick();
		expect(approve().disabled).toBe(true);
		expect(document.getElementById(approve().getAttribute('aria-describedby') ?? '')?.textContent).toBe("You're offline.");
		window.dispatchEvent(new Event('online'));
	});

	it('closes on Cancel without deciding anything', async () => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', request: REQUEST } }) });
		await tick();
		const cancel = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancel') as HTMLButtonElement;
		expect(cancel.getAttribute('type')).toBe('button');
		await fireEvent.click(cancel);
		await waitFor(() => expect(said()).not.toContain('3FA2:9C11:5B07:E48D'));
	});

	it('shows the request a lookup found and lets the person approve', async () => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', request: REQUEST } }) });
		await tick();
		expect(said()).toContain('3FA2:9C11:5B07:E48D');
		expect(said()).toContain('Check that the builder shows the same key.');
		expect(said()).toContain('Sent by the browser and not verified.');
		expect(said()).toContain('read and write pages, sections and the theme, and listed data only with consent');
		expect(said()).toContain('Browser name');
		expect(document.querySelector('#connected-editors-step-up-password')).not.toBeNull();
		expect(approve().disabled).toBe(false);
	});

	it('asks for the MFA code from an account that has one', async () => {
		render(Page, { props: props({ mfaEnrolled: true }, { drawer: { code: 'K7F3-A2M9', request: REQUEST } }) });
		await tick();
		expect(document.querySelector('#connected-editors-step-up-code')).not.toBeNull();
	});

	it('offers only the lifetimes the tenant allows', async () => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', request: { ...REQUEST, lifetime_days: 30 } } }) });
		await tick();
		const segments = [...document.querySelectorAll('[role="radiogroup"]')]
			.find((g) => g.closest('form')?.getAttribute('action') === '?/approve')
			?.querySelectorAll('[role="radio"]');
		expect(segments).toHaveLength(1);
		expect(segments?.[0].textContent).toContain('30 days');
	});

	it('warns about a request from another network and still lets the person approve', async () => {
		render(Page, {
			props: props({}, { drawer: { code: 'K7F3-A2M9', request: { ...REQUEST, same_network: false, requester_network: '198.51.100.4' } } }),
		});
		await tick();
		expect(said()).toContain('This request came from a different network than this browser. Approve it only if you started it yourself.');
		expect(said()).toContain('198.51.100.4');
		expect(said()).toContain('203.0.113.7');
		expect(approve().disabled).toBe(false);
	});

	it.each([
		[{ codeError: SAID.malformed }, SAID.malformed],
		[{ codeError: SAID.unknown }, SAID.unknown],
		[{ expired: true }, SAID.expired],
		[{ decided: true }, SAID.decided],
		[{ withheld: true }, SAID.withheld],
	])('offers no Approve and says why', async (drawer, words) => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', ...drawer } }) });
		await tick();
		expect(said()).toContain(words);
		expect(approve()).toBeUndefined();
	});

	it('keeps Find request in the code row when the code is refused', async () => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', codeError: SAID.unknown } }) });
		await tick();
		const code = document.getElementById('connected-editors-code') as HTMLInputElement;
		const find = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Find request');
		expect(code.getAttribute('aria-invalid')).toBe('true');
		expect(document.getElementById(code.getAttribute('aria-describedby') ?? '')?.textContent).toBe(SAID.unknown);
		// The error sits inside the input's own column, never between the label and the row.
		expect(find?.parentElement).toBe(code.parentElement?.parentElement);
	});

	it('makes Approve the approve form\'s only submit button, so Enter in the password approves', async () => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', request: REQUEST, checkUnavailable: true } }) });
		await tick();
		const form = document.getElementById('connected-editors-approve') as HTMLFormElement;
		const submits = [...form.elements].filter((e) => e instanceof HTMLButtonElement && e.type === 'submit');
		// The form's default button is its first submit button, which is the one
		// implicit submission from a text field presses.
		expect(submits).toEqual([approve()]);
		expect(form.getAttribute('action')).toBe('?/approve');
		expect(form.contains(document.querySelector('#connected-editors-step-up-password'))).toBe(true);
	});

	it('declines from a form of its own that never carries the password', async () => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', request: REQUEST } }) });
		await tick();
		const decline = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Decline');
		const form = document.getElementById('connected-editors-decline') as HTMLFormElement;
		expect(decline?.getAttribute('form')).toBe('connected-editors-decline');
		expect(decline?.hasAttribute('formaction')).toBe(false);
		expect(form.getAttribute('action')).toBe('?/decline');
		expect([...new FormData(form).keys()].sort()).toEqual(['code', 'code_expires_at']);
		expect(new FormData(form).get('code')).toBe('K7F3-A2M9');
	});

	it.each(['approve', 'decline'])('clears the password after a refused %s', async (kind) => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', request: REQUEST } }) });
		await tick();
		const password = document.querySelector('#connected-editors-step-up-password') as HTMLInputElement;
		await fireEvent.input(password, { target: { value: 'hunter2-hunter2' } });
		expect(password.value).toBe('hunter2-hunter2');
		const done = (await (forms.submits.get(`?/${kind}`) as Submit)({ cancel: vi.fn(), action: new URL(`http://a/?/${kind}`) })) as (
			o: unknown,
		) => Promise<void>;
		await done({ result: { type: 'failure', status: 503, data: {} }, update: async () => {} });
		await tick();
		expect(password.value).toBe('');
	});

	it('reloads the list when someone else decided the request first', async () => {
		const { invalidateAll } = await import('$app/navigation');
		vi.mocked(invalidateAll).mockClear();
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', request: REQUEST } }) });
		await tick();
		const done = (await (forms.submits.get('?/approve') as Submit)({ cancel: vi.fn(), action: new URL('http://a/?/approve') })) as (
			o: unknown,
		) => Promise<void>;
		await done({ result: { type: 'failure', status: 409, data: { drawer: { code: 'K7F3-A2M9', decided: true } } }, update: async () => {} });
		expect(invalidateAll).toHaveBeenCalledTimes(1);
	});

	it('does not draw an answer over a code it did not answer', async () => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', codeError: SAID.unknown, withheld: true } }) });
		await tick();
		expect(said()).toContain(SAID.unknown);
		const cancel = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancel') as HTMLButtonElement;
		await fireEvent.click(cancel);
		await tick();
		const open = [...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Approve a connection') as HTMLAnchorElement;
		await fireEvent.click(open);
		await tick();
		expect((document.querySelector('#connected-editors-code') as HTMLInputElement).value).toBe('');
		expect(said()).not.toContain(SAID.unknown);
		expect(said()).not.toContain(SAID.withheld);
	});

	it('shows the new key after the key changed', async () => {
		const fresh = { ...REQUEST, fingerprint: 'AAAA:BBBB:CCCC:DDDD' };
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', keyChanged: true, request: fresh } }) });
		await tick();
		expect(said()).toContain(SAID.keyChanged);
		expect(said()).toContain('AAAA:BBBB:CCCC:DDDD');
	});

	it('asks for the lifetime again after an owner shortened it', async () => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', lifetimeChanged: true, request: { ...REQUEST, lifetime_days: 30 } } }) });
		await tick();
		expect(said()).toContain(SAID.lifetime);
	});

	it('puts a refused confirmation on the field', async () => {
		render(Page, {
			props: props({}, { drawer: { code: 'K7F3-A2M9', request: REQUEST, stepUp: { field: 'That password is not right.', needsMfa: false } } }),
		});
		await tick();
		expect(said()).toContain('That password is not right.');
	});

	it('says approval is unavailable in place of the confirmation', async () => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', request: REQUEST, approvalUnavailable: true } }) });
		await tick();
		expect(said()).toContain('Approving connections is not available on this engine.');
		expect(document.querySelector('#connected-editors-step-up-password')).toBeNull();
		expect(approve().disabled).toBe(true);
	});

	it('tells a failed check and a store outage apart from approval being unavailable', async () => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', request: REQUEST, checkUnavailable: true } }) });
		await tick();
		expect(said()).toContain(SAID.checkUnavailable);
		expect(said()).not.toContain('Approving connections is not available on this engine.');
		cleanup();
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', request: REQUEST, error: SAID.approveOutage } }) });
		await tick();
		expect(said()).toContain(SAID.approveOutage);
		expect(said()).not.toContain(SAID.checkUnavailable);
	});

	it('looks the code up once the eighth character lands', async () => {
		const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
		render(Page, { props: props({ openApprove: true }) });
		await tick();
		const input = document.querySelector('#connected-editors-code') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'k7f3 a2m' } });
		expect(submit).not.toHaveBeenCalled();
		await fireEvent.input(input, { target: { value: 'k7f3 a2m9' } });
		await tick();
		expect(input.value).toBe('K7F3-A2M9');
		expect(submit).toHaveBeenCalledTimes(1);
		submit.mockRestore();
	});

	it('names the tenant the approval binds when the engine runs tenants', async () => {
		render(Page, { props: props({ tenant: 'northwind' }, { drawer: { code: 'K7F3-A2M9', request: REQUEST } }) });
		await tick();
		expect(said()).toContain('northwind');
	});
});

describe('decisions', () => {
	it('says an approval went through, and lets the words clear themselves', async () => {
		render(Page, { props: props({}, { approved: { expires_at: '2027-01-28T00:00:00Z' } }) });
		await frames();
		expect(said()).toContain('Connection approved. That browser can edit pages now.');
		expect([...document.querySelectorAll('[aria-live="polite"]')].some((a) => a.textContent?.includes('Connection approved.'))).toBe(true);
	});

	it('says a decline went through', async () => {
		render(Page, { props: props({}, { declined: true }) });
		await frames();
		expect(said()).toContain('Request declined.');
	});
});

describe('the settings card', () => {
	it('is not drawn for a person below owner', () => {
		render(Page, { props: props({ owner: false, settings: null }) });
		expect(said()).not.toContain('Writes a minute for each connection');
	});

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
		expect(allowSwitch().getAttribute('aria-label')).toBe('Allow the builder');
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
		// The switch, the limits, and where forms can send, each saved on its own.
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
		render(Page, { props: props({ schemas: [], schemasFailed: true }) });
		expect(said()).toContain('Could not load schemas. Pages keep showing the schemas saved before.');
		expect(said()).toContain('Try again');
		expect(said()).not.toContain('Create a schema');
		// Nothing offered, so a Save clears no stored schema.
		expect(document.querySelector('input[name="schemas_offered"]')).toBeNull();
	});

	it('says how to offer a schema when there is none', () => {
		render(Page, { props: props({ schemas: [] }) });
		expect(said()).toContain('Create a schema to show its entries on pages.');
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
	const FORM_SCHEMAS = [
		{ name: 'form_submissions', label: 'Form submissions' },
		{ name: 'contact_messages', label: 'Contact messages' },
	];
	const FLOWS = [
		{ id: 'f1', slug: 'notify', name: 'Notify sales', status: 'disabled', formTrigger: true },
		{ id: 'f2', slug: 'nightly', name: 'Nightly report', status: 'active', formTrigger: false },
	];

	function formsCard(): HTMLFormElement {
		return document.querySelector('form[action="?/setting"] input[name="field"][value="forms"]')?.closest('form') as HTMLFormElement;
	}

	it('offers the content types and only the flows a form can start, with the reason beside each that starts nothing', () => {
		render(Page, { props: props({ settings: { ok: true, value: FORM_SETTINGS }, formSchemas: FORM_SCHEMAS, flows: { ok: true, value: FLOWS } }) });
		const card = formsCard();
		expect(card.textContent).toContain('Form submissions');
		expect(card.textContent).toContain('Notify sales');
		expect(card.textContent).toContain('This flow is not active, so forms that send to it start nothing.');
		expect(card.textContent).toContain('No flow uses this slug any more. Clear it, then save.');
		expect(card.textContent).not.toContain('Nightly report');
		expect(card.querySelector('input[name="form_schemas_offered"]')).not.toBeNull();
		expect(card.querySelector('input[name="form_flows_offered"]')).not.toBeNull();
	});

	it('draws a failed flow read as a failure and saves no flow list', () => {
		render(Page, {
			props: props({
				settings: { ok: true, value: FORM_SETTINGS },
				formSchemas: FORM_SCHEMAS,
				flows: { ok: false, gate: { state: 'error', message: 'Could not load flows.' } },
			}),
		});
		expect(said()).toContain('Could not load flows.');
		expect(formsCard().querySelector('input[name="form_flows_offered"]')).toBeNull();
	});

	it('says the flow plugin is not running instead of offering no flows', () => {
		render(Page, { props: props({ settings: { ok: true, value: FORM_SETTINGS }, formSchemas: FORM_SCHEMAS }) });
		expect(said()).toContain('The flow plugin is not running on this instance, so forms cannot start flows.');
	});

	it('offers the forms preset while its submissions type is not allowed', () => {
		render(Page, { props: props({ settings: { ok: true, value: { ...SETTINGS, form_schemas: [], form_flows: [] } }, formsPreset: true }) });
		const preset = document.querySelector('[data-testid="forms-preset"]');
		expect(preset?.textContent).toContain('Add the Forms and Form submissions content types');
		expect(preset?.querySelector('form[action="?/formsPreset"]')).not.toBeNull();
	});

	it('only offers to allow the submissions type when it exists already', () => {
		render(Page, {
			props: props({ settings: { ok: true, value: { ...SETTINGS, form_schemas: [], form_flows: [] } }, formSchemas: FORM_SCHEMAS, formsPreset: true }),
		});
		expect(said()).toContain('Let forms save posts into the Form submissions content type you already have.');
	});

	it('links the schema builder when the preset is not offered or answered 404', () => {
		const empty = { settings: { ok: true, value: { ...SETTINGS, form_schemas: [], form_flows: [] } } };
		render(Page, { props: props({ ...empty, formsPreset: true }, { presetMissing: true }) });
		expect(document.querySelector('form[action="?/formsPreset"]')).toBeNull();
		expect(document.querySelector('[data-testid="forms-preset-link"] a')?.getAttribute('href')).toBe('/admin/schema');
	});

	it('offers no preset once its submissions type is allowed', () => {
		render(Page, { props: props({ settings: { ok: true, value: FORM_SETTINGS }, formSchemas: FORM_SCHEMAS, formsPreset: true }) });
		expect(document.querySelector('[data-testid="forms-preset"]')).toBeNull();
	});
});
