// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RunViewer from './RunViewer.svelte';
import { fixtureRun } from '#lib/flow/fixtures.ts';
import type { FlowRun, RunStep } from '#lib/api/flows.ts';

afterEach(cleanup);

const steps = fixtureRun.steps as RunStep[];

const stepButton = (id: string) => screen.getAllByRole('button').find((b) => b.getAttribute('aria-pressed') !== null && b.textContent?.includes(id)) as HTMLElement;

describe('RunViewer', () => {
	it('asks for a test run before there is one', () => {
		render(RunViewer, { props: { run: null } });
		expect(screen.getByText('No run yet. Press Run test to execute the draft.')).toBeTruthy();
	});

	it('opens on the failed step and prints its error once, with the run banner pointing to it', () => {
		const { container } = render(RunViewer, { props: { run: fixtureRun } });
		expect(stepButton('join').getAttribute('aria-pressed')).toBe('true');
		expect(screen.getByText('join failed')).toBeTruthy();
		expect(container.textContent?.match(/right_key missing on 3 rows/g)).toHaveLength(1);
		expect(container.textContent).toContain('Run failed at join');
		expect(container.textContent).not.toContain('join: right_key missing on 3 rows');
	});

	// The plugin serves a run whose values the reader may not see with
	// withheld set and every input, output and error emptied.
	it('says the values are withheld and still shows that the run failed', () => {
		const withheld: FlowRun = {
			...fixtureRun,
			withheld: true,
			input: null,
			output: null,
			error: '',
			steps: steps.map((s) => ({ ...s, input: null, output: null, error: '' })),
		};
		const { container } = render(RunViewer, { props: { run: withheld } });
		expect(screen.getByTestId('run-withheld').textContent).toContain('Your role cannot see the data this run used');
		expect(screen.getByTestId('run-failure').textContent).toContain('Run failed at join');
		expect(container.textContent).toContain('Withheld from you.');
		expect(container.textContent).not.toContain('null');
		expect(screen.queryByRole('button', { name: /^Copy (step|input|output)$/ })).toBeNull();
	});

	it('offers to copy a step and its values when they are not withheld', () => {
		render(RunViewer, { props: { run: fixtureRun } });
		for (const name of ['Copy step', 'Copy input', 'Copy output']) expect(screen.getByRole('button', { name })).toBeTruthy();
	});

	it('leads back to the failed step from another one', async () => {
		render(RunViewer, { props: { run: fixtureRun, focus: 'orders' } });
		expect(stepButton('orders').getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(screen.getByRole('button', { name: 'Show the step' }));
		expect(stepButton('join').getAttribute('aria-pressed')).toBe('true');
	});

	it('shows the step a reader picks', async () => {
		const { container } = render(RunViewer, { props: { run: fixtureRun } });
		await fireEvent.click(stepButton('shipments'));
		expect(container.textContent).toContain('"sh1"');
	});

	it('prints the run error itself when no step owns it', () => {
		const run: FlowRun = { ...fixtureRun, error: 'run timed out after 30 s', steps: steps.slice(0, 1) };
		render(RunViewer, { props: { run } });
		expect(screen.getByText('run timed out after 30 s')).toBeTruthy();
	});

	it('marks a step that only pretended to act as a dry run', () => {
		const run: FlowRun = { ...fixtureRun, error: '', status: 'succeeded', steps: [{ ...steps[0], dry_run: true }] };
		render(RunViewer, { props: { run } });
		expect(stepButton('orders').textContent).toContain('dry-run');
	});

	it('shows raw JSON once asked, and runs the test again', async () => {
		const onrerun = vi.fn();
		const { container } = render(RunViewer, { props: { run: fixtureRun, focus: 'orders', onrerun } });
		await fireEvent.click(screen.getByRole('radio', { name: 'Raw' }));
		expect([...container.querySelectorAll('pre')].map((p) => p.textContent).join('\n')).toContain('"total": 12');
		await fireEvent.click(screen.getByRole('button', { name: /Run again/ }));
		expect(onrerun).toHaveBeenCalledTimes(1);
	});
});
