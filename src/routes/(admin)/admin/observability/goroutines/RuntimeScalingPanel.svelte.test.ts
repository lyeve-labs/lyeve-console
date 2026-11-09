// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RuntimeScalingPanel from './RuntimeScalingPanel.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/observability/goroutines') } }));

afterEach(cleanup);

const GIB = 1024 * 1024 * 1024;

const setting = (value: unknown, over: Record<string, unknown> = {}) => ({
	value,
	source: 'default',
	pinned: false,
	live: false,
	start_only: false,
	...over,
});

function answer(over: Record<string, unknown> = {}) {
	return {
		available: true,
		licensed: true,
		stored: true,
		revision: 4,
		settings: {
			cpu: setting(2, { mode: 'automatic', source: 'container', live: true }),
			memory: setting(0.85 * GIB, { mode: 'automatic', ratio: 0.85, source: 'container', live: true }),
			gc_percent: setting(100),
			database_max_connections: setting(25),
			replica_max_connections: setting(30, { start_only: true }),
			backpressure: setting(512, { source: 'environment', variable: 'BACKPRESSURE_MAX_INFLIGHT', start_only: true }),
			pooler: setting('none', { start_only: true }),
		},
		facts: {
			cpu_limit: { value: 1.5, known: true, source: 'container' },
			host_cores: { value: 8, known: true, source: 'machine' },
			memory_limit: { value: GIB, known: true, source: 'container' },
			database_cores: {
				value: null,
				known: false,
				source: 'database',
				reason: 'this database does not report its CPU count to a client',
				reason_code: 'not_over_sql',
			},
			connection_limit: {
				value: null,
				known: false,
				source: 'database',
				reason: 'the database account is not a member of pg_read_all_stats',
				reason_code: 'missing_grant',
				grant: 'pg_read_all_stats',
			},
		},
		replicas: { count: 1, known: false, attached: false, applied: 1 },
		...over,
	};
}

const RECOMMENDATIONS = {
	facts: {},
	presets: {
		one_server: {
			cpu: { value: { mode: 'automatic' }, rule: 'R1', reason: '' },
			memory: { value: { mode: 'ratio', ratio: 0.85 }, rule: 'R2', reason: '' },
			gc_percent: { value: 200, rule: 'R3', reason: '' },
			database_max_connections: { value: 40, rule: 'R4', reason: '' },
		},
		several_replicas: {
			cpu: { value: { mode: 'automatic' }, rule: 'R1', reason: '' },
			memory: { value: { mode: 'ratio', ratio: 0.85 }, rule: 'R2', reason: '' },
			gc_percent: { value: 100, rule: 'R3', reason: '' },
			database_max_connections: { value: 12, rule: 'R4', reason: '' },
		},
	},
	recommended: {
		cpu: { value: { mode: 'automatic' }, rule: 'R1', reason: "Automatic uses Go's default.", reason_code: 'cpu_automatic', params: {} },
		memory: {
			value: { mode: 'ratio', ratio: 0.85 },
			rule: 'R2',
			reason: 'Leaves 15% of the memory limit for memory the Go runtime does not count.',
			reason_code: 'memory_share',
			params: { share_percent: 85, headroom_percent: 15, limit_bytes: GIB, limit_source: 'container' },
		},
		gc_percent: {
			value: 200,
			rule: 'R3',
			reason: 'One server with a soft memory limit can collect half as often, and the limit bounds the heap.',
			reason_code: 'gc_one_server_with_limit',
			params: { gc_percent: 200, default_percent: 100 },
		},
		database_max_connections: {
			value: 22,
			rule: 'R4',
			reason: "Each replica takes an equal share of 80% of the database's connections, within what its cores can serve.",
			reason_code: 'pool_share',
			params: { pool: 22, server_share_percent: 80, connection_limit: 30, replicas: 1, reserved_sessions: 2 },
		},
	},
	warnings: [
		{
			code: 'pool_crowds_database',
			params: { pool: 22, connection_limit: 30 },
			message: 'This pool takes more than a third of the connections the database accepts, which leaves little room for other clients.',
		},
		{ code: 'cache_per_replica', params: { replicas: 3 }, message: 'Each replica keeps its own cache, so sign-in lockouts and rate limits count per replica.' },
	],
};

/** Every English sentence the fixtures carry, none of which may reach the page. */
const ENGLISH = [
	answer().facts.database_cores.reason,
	answer().facts.connection_limit.reason,
	...Object.values(RECOMMENDATIONS.recommended).map((r) => r.reason),
	...RECOMMENDATIONS.warnings.map((w) => w.message),
];

function runtime(over: Record<string, unknown> = {}, opts: { superAdmin?: boolean; recommendations?: unknown } = {}) {
	const a = answer(over);
	const recommendations =
		'recommendations' in opts ? opts.recommendations : a.licensed ? { ok: true, value: RECOMMENDATIONS } : null;
	return { settings: { ok: true, value: a }, recommendations, inputs: {}, superAdmin: opts.superAdmin ?? true };
}

function setup(rt: unknown, form: Record<string, unknown> | null = null) {
	return render(RuntimeScalingPanel, { props: { runtime: rt as never, form: form as never } });
}

const fieldset = (c: HTMLElement, key: string) => c.querySelector(`[data-testid="runtime-field-${key}"]`) as HTMLFieldSetElement;
const posted = (c: HTMLElement) =>
	[...c.querySelectorAll('form[action="?/runtime"] [name]')].map((el) => el.getAttribute('name'));
const SETTINGS = ['cpu', 'memory', 'gc_percent', 'database_max_connections'];

describe('RuntimeScalingPanel', () => {
	it('shows the values in force read-only on an unlicensed engine and says tuning and recommendations are not enabled', () => {
		const { container } = setup(runtime({ licensed: false }));
		for (const key of SETTINGS) expect(fieldset(container, key).disabled).toBe(true);
		expect(container.querySelector('[data-testid="runtime-license-note"]')?.textContent).toContain(
			'Tuning the runtime settings and seeing recommendations for them is not enabled on this engine. You can still see the values in force below.',
		);
		// The locked state names no license and links to none.
		expect(container.querySelector('[data-testid="runtime-license-note"] a')).toBeNull();
		expect(container.textContent).not.toContain('license');
		expect(container.textContent).toContain('Container limit');
		expect(container.textContent).not.toContain('Start from');
		expect(container.querySelector('[data-testid="runtime-recommendations"]')).toBeNull();
	});

	it('draws the CPU and memory controls disabled with the fields around them', () => {
		const segments = (c: HTMLElement, key: string) => [...fieldset(c, key).querySelectorAll('[role="radio"]')];
		const { container } = setup(runtime({ licensed: false }));
		for (const key of ['cpu', 'memory']) {
			expect(segments(container, key).length).toBeGreaterThan(0);
			for (const radio of segments(container, key)) expect(radio.hasAttribute('disabled')).toBe(true);
			expect(fieldset(container, key).querySelector('[role="radiogroup"]')?.classList.contains('opacity-50')).toBe(true);
		}
		cleanup();
		const open = setup(runtime());
		for (const key of ['cpu', 'memory']) {
			for (const radio of segments(open.container, key)) expect(radio.hasAttribute('disabled')).toBe(false);
		}
	});

	it('keeps every segmented label short enough for one line at 390 pixels', () => {
		const { getByRole } = setup(runtime());
		const labels = (name: string) => [...getByRole('radiogroup', { name }).querySelectorAll('[role="radio"]')].map((r) => r.querySelector('span > span:not([aria-hidden])')?.textContent);
		expect(labels('Start from')).toEqual(['In force', 'One server', 'Replicas']);
		expect(labels('CPU threads')).toEqual(['Automatic', 'Fixed']);
		expect(labels('Soft memory limit')).toEqual(['Automatic', 'Share', 'Fixed', 'None']);
	});

	it('offers presets, recommendations and editable fields to a licensed super admin', () => {
		const { container, getByRole } = setup(runtime());
		for (const key of SETTINGS) expect(fieldset(container, key).disabled).toBe(false);
		expect(getByRole('radio', { name: 'One server' })).toBeTruthy();
		expect(getByRole('radio', { name: 'Replicas' })).toBeTruthy();
		expect(container.textContent).toContain(
			'Recommended: 200%. On one server with a soft memory limit, 200% collects less often than the default of 100%, and the limit still caps memory use.',
		);
		expect(container.textContent).toContain(
			'Your 3 replicas each have their own cache, so sign-in lockouts and rate limits count separately on each one.',
		);
		expect((getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('shows one sentence and no settings to an admin who is not a super admin', () => {
		const { container } = setup({ settings: { ok: false, gate: { state: 'forbidden' } }, recommendations: null, inputs: {}, superAdmin: false });
		expect(container.querySelector('[data-testid="runtime-forbidden"]')?.textContent).toBe('Only a super admin can see the runtime settings.');
		expect(container.querySelector('form')).toBeNull();
		expect(container.querySelector('[data-testid="runtime-facts"]')).toBeNull();
		expect(container.querySelector('[data-testid="runtime-start-only"]')).toBeNull();
	});

	it('draws a 403 from either read as the same sentence', () => {
		const forbidden = { ok: false, gate: { state: 'forbidden' } };
		for (const rt of [
			{ settings: forbidden, recommendations: null, inputs: {}, superAdmin: true },
			runtime({}, { recommendations: forbidden }),
		]) {
			const { container } = setup(rt);
			expect(container.querySelector('[data-testid="runtime-forbidden"]')?.textContent).toBe('Only a super admin can see the runtime settings.');
			expect(container.querySelector('form')).toBeNull();
			expect(container.querySelector('[data-testid="runtime-facts"]')).toBeNull();
			expect(container.textContent).not.toContain('Your role cannot open');
			cleanup();
		}
	});

	it('asks for the replica count when no roster reports it', () => {
		const { container } = setup(runtime());
		expect(container.querySelector('[data-testid="runtime-replicas-unknown"]')?.textContent).toContain(
			'Recommendations assume one replica. Enter the number of replicas you run if you run more.',
		);
		const replicas = container.querySelector('#rt-replicas') as HTMLInputElement;
		expect(replicas.getAttribute('name')).toBe('replicas');
		expect(replicas.closest('form')?.getAttribute('method')).toBe('GET');
		expect(container.querySelector('[data-testid="runtime-replicas"]')).toBeNull();
	});

	it('says how many replicas run and how many hold the latest change', async () => {
		const { container } = setup(runtime({ replicas: { count: 3, known: true, attached: true, applied: 2 } }));
		expect(container.querySelector('[data-testid="runtime-replicas"]')?.textContent).toContain('3 replicas are running.');
		await vi.waitFor(() => expect(container.textContent).toContain('Applied on 2 of 3 replicas.'));
		expect(container.querySelector('#rt-replicas')).toBeNull();
	});

	it('draws a fact that cannot be read as not available, with its reason', () => {
		const { container } = setup(runtime());
		const facts = container.querySelector('[data-testid="runtime-facts"]') as HTMLElement;
		expect(facts.textContent).toContain('Not available');
		expect(facts.textContent).toContain('This database does not report this value.');
		expect(facts.textContent).toContain('Grant pg_read_all_stats to the database account to show this value.');
		expect(facts.textContent).not.toContain('Host memory');
		expect(container.querySelector('#rt-database-cores')?.getAttribute('name')).toBe('database_cores');
	});

	it('disables a field the deployment pins and says where to change it', () => {
		const { container } = setup(
			runtime({
				settings: {
					...answer().settings,
					database_max_connections: setting(10, { source: 'environment', variable: 'DATABASE_MAX_CONNECTIONS', pinned: true }),
				},
			}),
		);
		expect(fieldset(container, 'database_max_connections').disabled).toBe(true);
		expect(fieldset(container, 'gc_percent').disabled).toBe(false);
		expect(container.querySelector('[data-testid="runtime-pinned-database_max_connections"]')?.textContent).toBe(
			'Set by DATABASE_MAX_CONNECTIONS. Change it where the engine is deployed, then restart the engine.',
		);
		expect(container.textContent).toContain('Environment variable DATABASE_MAX_CONNECTIONS');
	});

	it('says a configuration file pins a field and where to change it', () => {
		const { container } = setup(
			runtime({
				settings: {
					...answer().settings,
					gc_percent: setting(150, { source: 'file', variable: 'runtime.gc_percent', pinned: true }),
				},
			}),
		);
		expect(fieldset(container, 'gc_percent').disabled).toBe(true);
		expect(container.querySelector('[data-testid="runtime-pinned-gc_percent"]')?.textContent).toBe(
			'Set by runtime.gc_percent in the configuration file. Change it there, then restart the engine.',
		);
		expect(container.textContent).toContain('Configuration file key runtime.gc_percent');
	});

	it('opens the CPU and memory fields on the modes in force', () => {
		const { container, getByRole } = setup(
			runtime({
				settings: {
					...answer().settings,
					cpu: setting(4, { mode: 'fixed', source: 'console' }),
					memory: setting(0.7 * GIB, { mode: 'ratio', ratio: 0.7, source: 'console', live: true }),
				},
			}),
		);
		expect(within(fieldset(container, 'cpu')).getByRole('radio', { name: 'Fixed' }).getAttribute('aria-checked')).toBe('true');
		expect((container.querySelector('#rt-cpu-threads') as HTMLInputElement).value).toBe('4');
		expect(getByRole('radio', { name: 'Share' }).getAttribute('aria-checked')).toBe('true');
		expect((container.querySelector('#rt-memory-percent') as HTMLInputElement).value).toBe('70');
		expect(posted(container)).toEqual(['revision']);
	});

	it('draws an unknown fact as a note, never in the figure face', () => {
		const { container } = setup(runtime());
		const facts = container.querySelector('[data-testid="runtime-facts"]') as HTMLElement;
		for (const figure of facts.querySelectorAll('.font-mono')) expect(figure.textContent).not.toContain('Not available');
		const notes = [...facts.querySelectorAll('[data-testid="runtime-fact-unknown"]')].map((n) => n.textContent?.replace(/\s+/g, ' ').trim());
		expect(notes).toEqual([
			'Database connection limit Not available. Grant pg_read_all_stats to the database account to show this value.',
			'Database cores Not available. This database does not report this value.',
		]);
	});

	it('shows the values that apply only at start as read-only', () => {
		const { container } = setup(runtime());
		const start = container.querySelector('[data-testid="runtime-start-only"]') as HTMLElement;
		expect(start.querySelector('input')).toBeNull();
		expect(start.textContent).toContain('Set by BACKPRESSURE_MAX_INFLIGHT. Applies when the engine starts.');
		expect(start.textContent).toContain('Default. Applies when the engine starts.');
		expect(start.textContent).toContain('None');
		expect(start.textContent).not.toContain('none');
	});

	it('posts nothing but the revision until a field changes', () => {
		const { container } = setup(runtime());
		expect(posted(container)).toEqual(['revision']);
	});

	it('fills the fields from a preset without saving', async () => {
		const { container, getByRole } = setup(runtime());
		await fireEvent.click(getByRole('radio', { name: 'Replicas' }));
		await tick();
		expect((container.querySelector('#rt-pool') as HTMLInputElement).value).toBe('12');
		expect(posted(container)).toContain('database_max_connections');
		expect(container.textContent).not.toContain('Settings saved.');
		await fireEvent.click(getByRole('radio', { name: 'In force' }));
		await tick();
		expect((container.querySelector('#rt-pool') as HTMLInputElement).value).toBe('25');
		expect(posted(container)).toEqual(['revision']);
	});

	it('compares the fields against the values in force after a save', async () => {
		const gcAt = (gc: number, revision: number) => runtime({ revision, settings: { ...answer().settings, gc_percent: setting(gc, { source: 'console' }) } });
		const { container, rerender } = setup(gcAt(200, 9));
		const gc = () => container.querySelector('#rt-gc-percent') as HTMLInputElement;
		await fireEvent.input(gc(), { target: { value: '120' } });
		expect(posted(container)).toContain('gc_percent');

		// The save reloads the page data at the next revision.
		await rerender({ runtime: gcAt(120, 10) as never, form: { form: 'runtime', saved: true, stored: true } as never });
		expect(gc().value).toBe('120');
		expect(posted(container)).toEqual(['revision']);

		// The value the page opened with is a change again, and only it is posted.
		await fireEvent.input(gc(), { target: { value: '200' } });
		expect(posted(container)).toEqual(['revision', 'gc_percent']);

		// A reload at the same revision keeps the edit in progress.
		await rerender({ runtime: gcAt(120, 10) as never, form: null as never });
		expect(gc().value).toBe('200');
	});

	it('leaves the bounds to its own check and shows a refused value on its field', () => {
		const sentence = 'Enter between 5 and 10,000 connections.';
		const { container } = setup(runtime(), { form: 'runtime', fields: { database_max_connections: sentence } });
		expect(container.querySelector('form[action="?/runtime"]')?.hasAttribute('novalidate')).toBe(true);
		const pool = container.querySelector('#rt-pool') as HTMLInputElement;
		expect(pool.getAttribute('aria-invalid')).toBe('true');
		expect(container.querySelector(`#${pool.getAttribute('aria-describedby')}`)?.textContent).toBe(sentence);
		expect(container.textContent).toContain('1 field needs attention.');
		expect((container.querySelector('#rt-gc-percent') as HTMLInputElement).hasAttribute('aria-invalid')).toBe(false);
	});

	it('confirms a save that is stored', async () => {
		const { container } = setup(runtime(), { form: 'runtime', saved: true, stored: true });
		await vi.waitFor(() => expect(container.textContent).toContain('Settings saved.'));
	});

	it('warns in its own words when the saved pool takes a large share of the database', async () => {
		const sentence = "The database pool now uses more than a third of your database's connection limit. Lower it if other applications need to connect.";
		const { container } = setup(runtime(), { form: 'runtime', saved: true, stored: true, poolWarning: true });
		await vi.waitFor(() => expect(container.textContent).toContain(sentence));
		const dismiss = [...container.querySelectorAll('button[aria-label="Close"]')].find((b) => b.parentElement?.textContent?.includes(sentence));
		await fireEvent.click(dismiss as HTMLButtonElement);
		await vi.waitFor(() => expect(container.textContent).not.toContain(sentence));
	});

	it('shows no pool warning after a save that raised none', () => {
		const { container } = setup(runtime(), { form: 'runtime', saved: true, stored: true, poolWarning: false });
		expect(container.textContent).not.toContain("The database pool now uses more than a third of your database's connection limit.");
	});

	it('says a change on an engine without a database lasts until it restarts, until you dismiss it', async () => {
		const sentence = 'Applied. This engine runs without a database, so the change lasts until the engine restarts.';
		const { container } = setup(runtime({ stored: false }), { form: 'runtime', saved: true, stored: false });
		expect(container.textContent).toContain(sentence);
		expect(container.textContent).not.toContain('Settings saved.');
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(container.textContent).toContain(sentence);
		const dismiss = [...container.querySelectorAll('button[aria-label="Close"]')].find((b) => b.parentElement?.textContent?.includes(sentence));
		await fireEvent.click(dismiss as HTMLButtonElement);
		await vi.waitFor(() => expect(container.textContent).not.toContain(sentence));
	});

	it('shows the stale revision sentence the action returns', () => {
		const stale = 'Someone changed these settings after you opened them. Reload them to see the latest version.';
		const { container } = setup(runtime(), { form: 'runtime', error: stale });
		expect(container.textContent).toContain(stale);
	});

	it('words every recommendation, warning and fact from its code', () => {
		const { container } = setup(runtime());
		for (const sentence of [
			'Recommended: Automatic. Automatic matches the threads to the CPUs available to the engine and follows them as they change.',
			"Recommended: 85% of the limit. Using 85% of the container's 1.0 GB memory limit leaves 15% for memory the garbage collector does not count.",
			"Recommended: 22. The engine gets 80% of the database's 30 connections, minus 2 for the engine's own sessions.",
			"A pool of 22 uses more than a third of the database's 30 connections. Lower it if other applications need to connect.",
		]) {
			expect(container.textContent).toContain(sentence);
		}
	});

	it('never shows the English the routes send beside each code', () => {
		const { container } = setup(runtime());
		for (const english of ENGLISH) expect(container.textContent).not.toContain(english);
	});

	it('shows the fallback for each kind when a code is unknown', () => {
		const recommendations = {
			...RECOMMENDATIONS,
			recommended: { gc_percent: { value: 150, rule: 'R9', reason: 'A rule from a newer plugin.', reason_code: 'gc_something_new', params: {} } },
			warnings: [{ code: 'something_new', params: {}, message: 'A caution from a newer plugin.' }],
		};
		const facts = { cpu_limit: { value: null, known: false, reason: 'A reason from a newer host.', reason_code: 'something_new' } };
		const { container } = setup(runtime({ facts }, { recommendations: { ok: true, value: recommendations } }));
		expect(container.textContent).toContain('Recommended: 150%. This value fits the machine and the database this engine uses.');
		expect(container.textContent).toContain('Review these recommendations before you save them.');
		expect(container.querySelector('[data-testid="runtime-facts"]')?.textContent).toContain('Could not read this value.');
		for (const english of ['A rule from a newer plugin.', 'A caution from a newer plugin.', 'A reason from a newer host.']) {
			expect(container.textContent).not.toContain(english);
		}
	});

	it('ignores an answer meant for another form', () => {
		const { container } = setup(runtime(), { form: 'pool', error: 'Pool size must be between 1 and 4096.' });
		expect(container.textContent).not.toContain('Pool size must be');
	});

	it('says a failed read failed instead of drawing empty settings', () => {
		const { container } = setup({
			settings: { ok: false, gate: { state: 'error', message: 'Could not load runtime settings.' } },
			recommendations: null,
			inputs: {},
			superAdmin: true,
		});
		expect(container.textContent).toContain('Could not load runtime settings.');
		expect(container.querySelector('[data-testid="runtime-settings"]')).toBeNull();
	});

	it('shows only a sentence on an engine that offers no runtime settings', () => {
		const { container } = setup(runtime({ available: false }, { recommendations: null }));
		expect(container.querySelector('[data-testid="runtime-unavailable"]')?.textContent).toBe(
			'Runtime settings are not available on this engine.',
		);
		expect(container.querySelector('form')).toBeNull();
		expect(container.querySelector('[data-testid="runtime-facts"]')).toBeNull();
		expect(container.querySelector('[data-testid="runtime-license-note"]')).toBeNull();
	});
});

// The console is open source and gates on the plugin's own boolean or its
// 402, so no file behind this page names what a license sells.
describe('the goroutine engine tab names no capability', () => {
	const files = [
		'src/routes/(admin)/admin/observability/goroutines/+page.svelte',
		'src/routes/(admin)/admin/observability/goroutines/+page.server.ts',
		'src/routes/(admin)/admin/observability/goroutines/RuntimeScalingPanel.svelte',
		'src/routes/(admin)/admin/observability/goroutines/GoroutineEnginePanel.svelte',
		'src/lib/api/runtime-settings.ts',
		'src/lib/api/runtime-words.ts',
		'src/lib/api/goroutine-engine.ts',
	];

	it.each(files)('%s', (file) => {
		const src = readFileSync(file, 'utf8');
		expect(src).not.toMatch(/[a-z]-pro\b|_pro\b|HasFeature|hasFeature|feature:[a-z]/);
	});

	it('renders no capability name on a licensed or an unlicensed install', () => {
		for (const licensed of [true, false]) {
			const { container } = setup(runtime({ licensed }));
			expect(container.textContent).not.toMatch(/[a-z]-pro\b|_pro\b/);
			cleanup();
		}
	});
});
