// @vitest-environment jsdom
import { tick } from 'svelte';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ refreshAll: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => nav);

import SetupPage from './+page.svelte';
import type { SetupModeStatus } from '#lib/api/setup.ts';

// A live region reads its text only after it has been in the page for two
// frames, the way the kit's notices do.
async function twoFrames(): Promise<void> {
	await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
	await tick();
}

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	nav.refreshAll.mockClear();
});

type State = 'unreachable' | 'setup_mode' | 'needs_admin';

function data(state: State, tokenSource: 'env' | 'log' | null = 'log') {
	return { state, tokenSource, next: null, brand: null };
}

const fullStatus: SetupModeStatus = {
	mode: 'setup',
	missing: [
		{ env: 'DATABASE_URL', yaml: 'database.url', generated: false },
		{ env: 'JWT_SECRET', yaml: 'jwt.secret', generated: true },
		{ env: 'ENCRYPTION_KEY', yaml: 'encryption.key', generated: true },
	],
	secrets_included: true,
	env: 'DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/lyeve\nJWT_SECRET=aaaa1111\nENCRYPTION_KEY=bbbb2222\n',
	yaml: 'database:\n  url: "postgres://USER:PASSWORD@HOST:5432/lyeve"\njwt:\n  secret: "aaaa1111"\n',
	restart: [
		{ label: 'Docker Compose', command: 'docker compose up -d' },
		{ label: 'Kubernetes', command: 'kubectl rollout restart deployment/<engine deployment>' },
	],
};

describe('Setup page: engine unreachable', () => {
	it('says it is waiting and polls the engine', async () => {
		vi.useFakeTimers();
		const { container } = render(SetupPage, { props: { data: data('unreachable'), form: null } });

		expect(container.querySelector('[data-state="unreachable"]')).toBeTruthy();
		expect(container.textContent).toContain('CORE_INTERNAL_URL');
		expect(container.querySelector('form')).toBeNull();

		await vi.advanceTimersByTimeAsync(3000);
		expect(nav.refreshAll).toHaveBeenCalled();
	});
});

// Orca reads nothing from a status role, and a region created holding its
// text is not announced, so the wait is spoken from a polite region that
// fills once it has been in the page for two frames.
describe('Setup page: the wait is announced', () => {
	it.each([
		['unreachable', null, 'Checking again every few seconds.'],
		['setup_mode', { status: fullStatus }, 'Waiting for the engine to restart with its settings.'],
	] as const)('speaks the %s wait from a polite region and draws no status role', async (state, form, said) => {
		const { container, getByTestId } = render(SetupPage, { props: { data: data(state), form: form as never } });
		expect(container.querySelector('[role="status"]')).toBeNull();
		const live = getByTestId('setup-live');
		expect(live.getAttribute('aria-live')).toBe('polite');
		expect(live.textContent).toBe('');
		await twoFrames();
		expect(live.textContent).toBe(said);
	});
});

describe('Setup page: setup mode', () => {
	it('asks for the token before showing what to set', () => {
		const { container } = render(SetupPage, { props: { data: data('setup_mode'), form: null } });

		const form = container.querySelector('form');
		expect(form?.getAttribute('action')).toBe('?/status');
		expect(container.querySelector('#setup_token')).toBeTruthy();
		expect(container.querySelector('#email')).toBeNull();
		expect(container.querySelector('[data-block="env"]')).toBeNull();
	});

	it('does not poll before the operator has read the status', async () => {
		vi.useFakeTimers();
		render(SetupPage, { props: { data: data('setup_mode'), form: null } });
		await vi.advanceTimersByTimeAsync(6000);
		expect(nav.refreshAll).not.toHaveBeenCalled();
	});

	it('shows a missing database with the env lines, the YAML and the restart commands', () => {
		const status: SetupModeStatus = {
			...fullStatus,
			missing: [fullStatus.missing[0]],
			secrets_included: false,
			env: 'DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/lyeve\n',
		};
		const { container } = render(SetupPage, { props: { data: data('setup_mode'), form: { status } as never } });

		expect(container.querySelector('[data-missing="database"]')).toBeTruthy();
		expect(container.querySelector('[data-missing="secret"]')).toBeNull();
		expect(container.querySelector('[data-block="env"]')?.textContent).toContain('DATABASE_URL=');
		expect(container.querySelector('[data-block="yaml"]')?.textContent).toContain('database:');
		expect(container.textContent).toContain('docker compose up -d');
		expect(container.textContent).not.toContain('shown once');
	});

	it('shows freshly generated secrets once, with a warning to copy them now', () => {
		const { container } = render(SetupPage, {
			props: { data: data('setup_mode'), form: { status: fullStatus } as never },
		});

		expect(container.querySelectorAll('[data-missing="secret"]').length).toBe(2);
		expect(container.querySelector('[data-block="env"]')?.textContent).toContain('JWT_SECRET=aaaa1111');
		expect(container.textContent).toContain('These secrets are shown only once');
		expect(container.textContent).toContain('The engine does not save them');
	});

	it('says the secrets were already shown when the engine withholds them', () => {
		const status = { ...fullStatus, secrets_included: false, env: 'JWT_SECRET=<shown once>\n' };
		const { container } = render(SetupPage, { props: { data: data('setup_mode'), form: { status } as never } });
		expect(container.textContent).toContain('already shown once');
		expect(container.textContent).not.toContain('These secrets are shown only once');
	});

	it('waits for the restart by polling once the status is on screen', async () => {
		vi.useFakeTimers();
		const { container } = render(SetupPage, {
			props: { data: data('setup_mode'), form: { status: fullStatus } as never },
		});
		expect(container.querySelector('[data-state="waiting"]')).toBeTruthy();
		await vi.advanceTimersByTimeAsync(3000);
		expect(nav.refreshAll).toHaveBeenCalled();
	});

	it('warns when the engine holds no token at all', () => {
		const { container } = render(SetupPage, { props: { data: data('setup_mode', null), form: null } });
		expect(container.textContent).toContain('has no setup token');
	});
});

describe('Setup page: create the first admin', () => {
	it('marks configure and restart done and create admin current', () => {
		const { container } = render(SetupPage, { props: { data: data('needs_admin'), form: null } });
		const circles = [...container.querySelectorAll('nav[aria-label="Progress"] li')];
		expect(circles.map((li) => li.querySelector('svg') !== null)).toEqual([true, true, false]);
		expect(circles[2].textContent).toContain('3');
	});

	it('reports the database reachable and does not poll', async () => {
		vi.useFakeTimers();
		const { container } = render(SetupPage, { props: { data: data('needs_admin'), form: null } });
		expect(container.textContent).toContain('database is reachable');
		expect(container.querySelector('form')?.getAttribute('action')).toBe('?/create');
		await vi.advanceTimersByTimeAsync(6000);
		expect(nav.refreshAll).not.toHaveBeenCalled();
	});

	// ui-kit marks a required field twice over: an aria-hidden asterisk and
	// `required` on the input, which is what assistive technology announces.
	it('marks every required field on its label and on the input', () => {
		const { container } = render(SetupPage, { props: { data: data('needs_admin'), form: null } });

		const markers = container.querySelectorAll('label span[aria-hidden="true"]');
		expect(markers.length).toBe(4);
		for (const marker of markers) {
			expect(marker.textContent?.trim()).toBe('*');
		}
		expect(container.querySelectorAll('input[required]').length).toBe(4);
	});

	it('keeps a message beside each empty field instead of leaving it to the browser', async () => {
		const { container } = render(SetupPage, { props: { data: data('needs_admin'), form: null } });

		await fireEvent.submit(container.querySelector('form')!);

		for (const field of ['setup_token', 'email', 'password', 'confirm']) {
			const input = container.querySelector(`#${field}`);
			const error = container.querySelector(`#${field}-error`);
			expect(error, `${field} must carry a message`).toBeTruthy();
			expect(input!.getAttribute('aria-invalid')).toBe('true');
			expect(input!.getAttribute('aria-describedby')).toBe(`${field}-error`);
		}
	});

	it('moves focus to the first rejected field', async () => {
		const { container } = render(SetupPage, { props: { data: data('needs_admin'), form: null } });
		await fireEvent.submit(container.querySelector('form')!);
		expect(document.activeElement?.id).toBe('setup_token');
	});

	it('sends nothing while a field is refused', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
		try {
			const { container } = render(SetupPage, { props: { data: data('needs_admin'), form: null } });
			await fireEvent.submit(container.querySelector('form')!);
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it('sends a form once every field passes', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
		try {
			const { container } = render(SetupPage, { props: { data: data('needs_admin'), form: null } });
			(container.querySelector('#setup_token') as HTMLInputElement).value = 'from-the-log';
			(container.querySelector('#email') as HTMLInputElement).value = 'a@b.test';
			(container.querySelector('#password') as HTMLInputElement).value = 'longenough1';
			(container.querySelector('#confirm') as HTMLInputElement).value = 'longenough1';
			await fireEvent.submit(container.querySelector('form')!);
			expect(fetchSpy).toHaveBeenCalledTimes(1);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	// The engine's hasher fails a password over 72 bytes without naming a rule,
	// so the page says the limit on the field and sends nothing.
	it('refuses a password over 72 bytes on its field', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
		try {
			const { container } = render(SetupPage, { props: { data: data('needs_admin'), form: null } });
			const long = 'é'.repeat(37);
			(container.querySelector('#setup_token') as HTMLInputElement).value = 'from-the-log';
			(container.querySelector('#email') as HTMLInputElement).value = 'a@b.test';
			(container.querySelector('#password') as HTMLInputElement).value = long;
			(container.querySelector('#confirm') as HTMLInputElement).value = long;
			await fireEvent.submit(container.querySelector('form')!);
			expect(container.querySelector('#password-error')?.textContent).toMatch(/at most 72 bytes/);
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
		}
	});

	// An install can change the engine's password policy, so the page states
	// no length of its own. The engine names the rule it refuses a password for.
	it('leaves the password rules to the engine', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
		try {
			const { container } = render(SetupPage, { props: { data: data('needs_admin'), form: null } });
			const password = container.querySelector('#password') as HTMLInputElement;
			expect(container.querySelector('#password-hint')?.textContent).toContain('password policy');
			expect(password.getAttribute('placeholder') ?? '').not.toMatch(/\d/);

			(container.querySelector('#setup_token') as HTMLInputElement).value = 'from-the-log';
			(container.querySelector('#email') as HTMLInputElement).value = 'a@b.test';
			password.value = 'short';
			(container.querySelector('#confirm') as HTMLInputElement).value = 'short';
			await fireEvent.submit(container.querySelector('form')!);

			expect(container.querySelector('#password-error')).toBeNull();
			expect(fetchSpy).toHaveBeenCalledTimes(1);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it('refuses a confirmation that does not match', async () => {
		const { container } = render(SetupPage, { props: { data: data('needs_admin'), form: null } });

		(container.querySelector('#setup_token') as HTMLInputElement).value = 'from-the-log';
		(container.querySelector('#email') as HTMLInputElement).value = 'a@b.test';
		(container.querySelector('#password') as HTMLInputElement).value = 'longenough1';
		(container.querySelector('#confirm') as HTMLInputElement).value = 'different1';

		await fireEvent.submit(container.querySelector('form')!);

		expect(container.querySelector('#confirm-error')?.textContent).toContain('The passwords do not match.');
		expect(container.querySelector('#email-error')).toBeNull();
	});

	it('asks the browser for new passwords and no saved secret for the token', () => {
		const { container } = render(SetupPage, { props: { data: data('needs_admin'), form: null } });
		for (const field of ['password', 'confirm']) {
			const input = container.querySelector(`#${field}`) as HTMLInputElement;
			expect(input.type).toBe('password');
			expect(input.getAttribute('autocomplete')).toBe('new-password');
		}
		const token = container.querySelector('#setup_token') as HTMLInputElement;
		expect(token.type).toBe('password');
		expect(token.getAttribute('autocomplete')).toBe('off');
	});

	it('tells the operator where to find the token', () => {
		const fromLog = render(SetupPage, { props: { data: data('needs_admin', 'log'), form: null } });
		expect(fromLog.container.querySelector('#setup_token-hint')?.textContent).toContain('setup_token');
		cleanup();
		const fromEnv = render(SetupPage, { props: { data: data('needs_admin', 'env'), form: null } });
		expect(fromEnv.container.querySelector('#setup_token-hint')?.textContent).toContain('LYEVE_SETUP_TOKEN');
	});

	it('shows a refused action as an error', () => {
		const { container } = render(SetupPage, {
			props: { data: data('needs_admin'), form: { error: 'The engine did not accept that setup token.' } as never },
		});
		expect(container.textContent).toContain('did not accept that setup token');
	});
});

describe('the restart commands', () => {
	// Each command is a value the reader copies, so it is the kit's copy
	// field: the whole command readable, and focusing it selects all of it.
	it('shows each restart command as a copy field named by how the engine runs', () => {
		const { getByLabelText } = render(SetupPage, { props: { data: data('setup_mode'), form: { status: fullStatus } as never } });
		const compose = getByLabelText('Docker Compose') as HTMLTextAreaElement;
		expect(compose.readOnly).toBe(true);
		expect(compose.value).toBe('docker compose up -d');
		expect((getByLabelText('Kubernetes') as HTMLTextAreaElement).value).toBe('kubectl rollout restart deployment/<engine deployment>');
	});
});
