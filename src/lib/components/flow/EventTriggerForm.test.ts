// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import EventTriggerForm from './EventTriggerForm.svelte';
import { fixtureCatalog, fixtureSchemas } from '$lib/flow/fixtures';
import type { JsonSchema } from '$lib/flow/types';

afterEach(cleanup);

const schema = fixtureCatalog.find((s) => s.type === 'trigger.event')?.config_schema as JsonSchema;

function setup(value: Record<string, unknown>) {
	const onchange = vi.fn();
	const result = render(EventTriggerForm, { props: { schema, value, schemas: fixtureSchemas, onchange } });
	return { ...result, onchange };
}

describe('EventTriggerForm', () => {
	it('reads a config that names no kind as a content event', () => {
		const { container } = setup({ schema: 'customers', event: 'after_create' });
		expect(screen.getByRole('radio', { name: 'Content' }).getAttribute('aria-checked')).toBe('true');
		expect(container.textContent).toContain('A record of a content type was created, updated or deleted.');
		expect(container.textContent).not.toContain('Hook');
	});

	it('names the kind hint as the description of the kind group', () => {
		setup({ kind: 'system', name: 'flow.run.failed' });
		const group = screen.getByRole('radiogroup', { name: 'Kind' });
		const hint = document.getElementById(group.getAttribute('aria-describedby') ?? '');
		expect(hint?.textContent).toContain('A hook a plugin publishes');
	});

	it('switches to a system event and drops what belonged to the content event', async () => {
		const { onchange } = setup({ kind: 'content', schema: 'customers', event: 'after_create', filter: 'true' });
		await fireEvent.click(screen.getByRole('radio', { name: 'System' }));
		expect(onchange).toHaveBeenCalledWith({ kind: 'system' });
	});

	it('changes nothing when the current kind is picked again', async () => {
		const { onchange } = setup({ kind: 'content', schema: 'customers' });
		await fireEvent.click(screen.getByRole('radio', { name: 'Content' }));
		expect(onchange).not.toHaveBeenCalled();
	});

	it('names the schema field as the publisher key under a system event', () => {
		const { container } = setup({ kind: 'system', name: 'flow.run.failed' });
		expect(container.textContent).toContain('A hook a plugin publishes');
		expect(container.textContent).toContain('Scope (content type or publisher key)');
		expect(container.textContent).toContain('Hook');
	});
});
