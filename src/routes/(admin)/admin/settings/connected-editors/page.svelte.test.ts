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
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(async () => {}) }));
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
	});

	it('names each column and each status in words', () => {
		render(Page, {
			props: props({
				connections: [connection(), connection({ id: 'c2', status: 'expired', approver_email: '' })],
				total: 2,
			}),
		});
		const heads = [...document.querySelectorAll('thead th')].map((t) => t.textContent?.trim());
		expect(heads).toEqual(['Approved by', 'Key', 'Approved on', 'Last used', 'Expires', 'Status', 'Revoke']);
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

describe('the strip', () => {
	it('carries the strip with Connections marked for an owner, and no settings', () => {
		render(Page, { props: props() });
		const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.trim() === 'Connections');
		expect(tab?.getAttribute('aria-selected')).toBe('true');
		expect(said()).not.toContain('Writes a minute for each connection');
	});

	it('draws no strip for a person below owner, who has this page alone', () => {
		render(Page, { props: props({ owner: false }) });
		expect(document.querySelector('[role="tablist"]')).toBeNull();
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
		[{ state: 'withheld' }, SAID.withheld],
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
		render(Page, { props: props({ owner: false }) });
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
		render(Page, { props: props({}, { revokeAllError: SAID.revokeAllFailed }) });
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
		const reason = 'Eight characters, with or without the dash.';
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
		expect(said()).toContain('Read and write pages, sections and the theme, and read entries of the content types open to the builder.');
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
		const open = [...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Approve connection') as HTMLAnchorElement;
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
