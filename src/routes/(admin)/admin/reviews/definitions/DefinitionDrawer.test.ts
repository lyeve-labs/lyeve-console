// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import DefinitionDrawer from './DefinitionDrawer.svelte';

afterEach(cleanup);

function props(over: Record<string, unknown> = {}) {
	return {
		open: true,
		schemas: { ok: true, value: ['article'] },
		people: {},
		stagesLocked: false,
		...over,
	} as never;
}

describe('the definition drawer', () => {
	it('serializes the drawer stages in order into one field', async () => {
		render(DefinitionDrawer, { props: props() });
		const hidden = () => JSON.parse((document.querySelector('input[name="stages"]') as HTMLInputElement).value);
		expect(hidden()).toEqual([
			{
				name: '',
				required_role: '',
				sla_duration_seconds: 0,
				quorum: 1,
				escalate_kind: 'none',
				escalate_to: '',
				condition_field: '',
				condition_op: 'equals',
				condition_value: '',
			},
		]);
		await fireEvent.input(screen.getByRole('textbox', { name: /Stage name/ }), { target: { value: 'Copy edit' } });
		await fireEvent.click(screen.getByRole('button', { name: 'New stage' }));
		const names = screen.getAllByRole('textbox', { name: /Stage name/ });
		await fireEvent.input(names[1], { target: { value: 'Sign-off' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Move stage 2 up' }));
		expect(hidden().map((s: { name: string }) => s.name)).toEqual(['Sign-off', 'Copy edit']);
		expect((document.querySelector('input[name="publish_on_approve"]') as HTMLInputElement).value).toBe('true');
	});

	it('closes the paid stage settings when the read says the install would refuse them', async () => {
		render(DefinitionDrawer, { props: props({ stagesLocked: true }) });
		const quorum = document.querySelector('input[id^="stage-quorum-"]') as HTMLInputElement;
		expect(quorum.disabled).toBe(true);
		expect(document.querySelector('[data-testid="stage-paid-settings"] [data-testid="not-enabled"]')).not.toBeNull();
	});

	it('opens them when it would take them', async () => {
		render(DefinitionDrawer, { props: props() });
		expect((document.querySelector('input[id^="stage-quorum-"]') as HTMLInputElement).disabled).toBe(false);
	});

	it('picks the escalation user by email and saves their id', async () => {
		render(DefinitionDrawer, { props: props({ people: { 'u-ada': 'ada@example.com', 'u-jon': 'jon@example.com' } }) });
		const sla = document.querySelector('input[id^="stage-sla-"]') as HTMLInputElement;
		await fireEvent.input(sla, { target: { value: '24' } });
		await fireEvent.click(screen.getByRole('radio', { name: 'A user' }));
		expect(screen.queryByRole('textbox', { name: /User id/ })).toBeNull();
		await fireEvent.click(screen.getByRole('combobox', { name: /^User/ }));
		await fireEvent.click(screen.getByRole('option', { name: 'jon@example.com' }));
		const stages = JSON.parse((document.querySelector('input[name="stages"]') as HTMLInputElement).value);
		expect(stages[0]).toMatchObject({ escalate_kind: 'user', escalate_to: 'u-jon' });
	});

	it('keeps the typed id when the page could not read the directory', async () => {
		render(DefinitionDrawer, { props: props() });
		await fireEvent.input(document.querySelector('input[id^="stage-sla-"]') as HTMLInputElement, { target: { value: '24' } });
		await fireEvent.click(screen.getByRole('radio', { name: 'A user' }));
		expect(screen.getByRole('textbox', { name: /User id/ })).toBeTruthy();
	});

	it('keeps the stage name beside its number and wraps the stage buttons as one group', async () => {
		render(DefinitionDrawer, { props: props() });
		const field = (document.body.querySelector('input[id^="stage-name-"]') as HTMLElement).closest('.min-w-48') as HTMLElement;
		expect(field.className).toContain('flex-1');
		const row = field.parentElement as HTMLElement;
		expect(row.className).toContain('flex-wrap');
		const group = (document.body.querySelector('[aria-label="Move stage 1 up"]') as HTMLElement).closest('.ms-auto') as HTMLElement;
		expect(group.parentElement).toBe(row);
		for (const name of ['Move stage 1 up', 'Move stage 1 down', 'Remove stage 1']) {
			expect(group.querySelector(`[aria-label="${name}"]`), name).not.toBeNull();
		}
	});
});
