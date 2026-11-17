// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Protection } from '#lib/api/rate-limit.ts';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import ProtectionDrawer from './ProtectionDrawer.svelte';

afterEach(cleanup);

const protection = {
	name: 'POST /api/admin/auth/login',
	plugin: 'rate-limit',
	description: 'Sign-in attempts per address.',
	route: true,
	requests: 10,
	window_seconds: 1800,
	default_requests: 5,
	default_window_seconds: 900,
	customized: true,
} as Protection;

const form = () => document.body.querySelector('form#rate-protection-form') as HTMLFormElement | null;
const field = (name: string) => (form() ? new FormData(form()!).get(name) : null);

describe('the protection drawer', () => {
	it('stays shut until the page opens it', () => {
		render(ProtectionDrawer, { props: { error: '' } });
		expect(form()).toBeNull();
	});

	it('opens on the protection, names it, and posts its window in minutes', () => {
		const { component } = render(ProtectionDrawer, { props: { error: '' } });
		component.openProtection(protection);
		flushSync();
		expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('POST /api/admin/auth/login');
		expect(form()?.getAttribute('action')).toBe('?/protection');
		expect(field('name')).toBe('POST /api/admin/auth/login');
		expect(field('requests')).toBe('10');
		expect(field('window_minutes')).toBe('30');
		expect(form()?.textContent).toContain('Sign-in attempts per address.');
	});

	it('shows its failure first in its form', () => {
		const { component } = render(ProtectionDrawer, { props: { error: 'Could not save the protection. Try again.' } });
		component.openProtection(protection);
		flushSync();
		expect(form()?.firstElementChild?.firstElementChild?.textContent).toContain('Could not save the protection. Try again.');
	});

	it('shows a failure that arrives while it is open', async () => {
		const { component, rerender } = render(ProtectionDrawer, { props: { error: '' } });
		component.openProtection(protection);
		flushSync();
		expect(form()?.textContent).not.toContain('Could not save the protection. Try again.');
		await rerender({ error: 'Could not save the protection. Try again.' });
		expect(form()?.firstElementChild?.firstElementChild?.textContent).toContain('Could not save the protection. Try again.');
	});
});
