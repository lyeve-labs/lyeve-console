// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import CaptchaPage from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const instance = { provider: 'turnstile', site_key: 'inst', enabled: true };

const props = (settings: Record<string, unknown> | null, over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: { gate: { state: 'ok' }, settings, ...over } as never,
	form: form as never,
});

describe('captcha settings', () => {
	it("always says signing in to the console uses this engine's captcha", () => {
		const { container } = render(CaptchaPage, {
			props: props({ source: 'instance', tenant: null, instance, licensed: true }),
		});
		expect(said(container)).toContain("Signing in to the console always uses this engine's captcha");
		expect(screen.getByTestId('captcha-source').textContent).toContain("this engine's Turnstile");
	});

	it('never shows a stored secret and says an empty field keeps it', () => {
		const { container } = render(CaptchaPage, {
			props: props({
				source: 'tenant',
				tenant: { provider: 'hcaptcha', site_key: 'tenant-site', has_secret: true, score_floor: null },
				instance,
				licensed: true,
			}),
		});
		expect(screen.getByTestId('captcha-source').textContent).toContain('hCaptcha with its own keys');
		expect(said(container)).toContain('A secret is stored and is never shown');
		expect((screen.getByLabelText('Secret key') as HTMLInputElement).value).toBe('');
	});

	it('carries the stored failure threshold into the save, so a save keeps it', () => {
		const { container } = render(CaptchaPage, {
			props: props({
				source: 'tenant',
				tenant: { provider: 'hcaptcha', site_key: 's', has_secret: true, score_floor: null, failure_threshold: 9 },
				instance,
				licensed: true,
			}),
		});
		const form = container.querySelector('form#captcha-form') as HTMLFormElement;
		expect(new FormData(form).get('failure_threshold')).toBe('9');
	});

	it('asks for the score floor only for reCAPTCHA', () => {
		render(CaptchaPage, {
			props: props({
				source: 'tenant',
				tenant: { provider: 'recaptcha', site_key: 's', has_secret: true, score_floor: 0.6 },
				instance,
				licensed: true,
			}),
		});
		expect((screen.getByLabelText('Score floor') as HTMLInputElement).value).toBe('0.6');
		cleanup();
		render(CaptchaPage, { props: props({ source: 'instance', tenant: null, instance, licensed: true }) });
		expect(screen.queryByLabelText('Score floor')).toBeNull();
	});

	it('says what an unlicensed install keeps', () => {
		const { container } = render(CaptchaPage, {
			props: props({ source: 'instance', tenant: null, instance, licensed: false }),
		});
		expect(said(container)).toContain('Tenant captcha settings are not enabled on this engine.');
	});

	it('turns the save off on an unlicensed install and points it at the reason', () => {
		const { container } = render(CaptchaPage, {
			props: props({ source: 'instance', tenant: null, instance, licensed: false }),
		});
		const save = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save');
		expect(save?.hasAttribute('disabled')).toBe(true);
		expect(save?.getAttribute('aria-describedby')).toBe('captcha-license-note');
	});

	it('renders a refused save through the refusal notice', () => {
		render(CaptchaPage, {
			props: props(
				{ source: 'instance', tenant: null, instance, licensed: false },
				{},
				{ error: 'x', refused: { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' } },
			),
		});
		expect(screen.getByTestId('refusal-notice')).toBeTruthy();
	});

	it('reports a failed read rather than an empty form', () => {
		const { container } = render(CaptchaPage, {
			props: props(null, { gate: { state: 'error', message: 'The captcha settings could not be read.' } }),
		});
		expect(said(container)).toContain('could not be read');
		expect(screen.queryByLabelText('Site key')).toBeNull();
	});
});

describe('a refused captcha write', () => {
	// The banner arrives inside a region that was mounted before the failure,
	// which is what a screen reader reliably announces.
	it('says the failure inside a live region that was there before it', () => {
		const settings = { source: 'instance', tenant: null, instance, licensed: true };
		const { rerender } = render(CaptchaPage, { props: props(settings) });
		const region = document.querySelector('[aria-live="assertive"][aria-atomic="true"].contents');
		expect(region).not.toBeNull();
		rerender(props(settings, {}, { error: 'Could not save the captcha settings. Try again.' }));
		expect(region?.textContent).toContain('Could not save the captcha settings. Try again.');
	});
});
