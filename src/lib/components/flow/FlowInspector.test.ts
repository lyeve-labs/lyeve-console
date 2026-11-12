// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FlowInspector from './FlowInspector.svelte';
import { fixtureCatalog, fixtureEventTypes, fixtureGroupedEventTypes, fixtureSchemas, joinFlow, withLocked } from '$lib/flow/fixtures';
import type { ValidationError } from '$lib/api/flows';
import type { NodeSpec, SchemaOption, Selection } from '$lib/flow/types';

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/flows/f1') } }));

afterEach(cleanup);

function setup(selected: Selection, errors: ValidationError[]) {
	return render(FlowInspector, {
		props: { definition: joinFlow, catalog: fixtureCatalog, selected, errors, onchange: vi.fn(), onselect: vi.fn() },
	});
}

describe('FlowInspector validation errors', () => {
	it('shows a config error under its field and not in the list at the bottom', () => {
		const { container, queryByTestId } = setup({ kind: 'node', id: 'join' }, [
			{ node_id: 'join', path: '/config/left_key', message: 'required' },
		]);
		expect(container.textContent).toContain('required');
		expect(queryByTestId('orphan-errors')).toBeNull();
	});

	it('lists an error with no field of its own at the bottom with its full path', () => {
		const { getByTestId } = setup({ kind: 'node', id: 'join' }, [
			{ node_id: 'join', path: '/config/unknown_key', message: 'not allowed' },
			{ node_id: 'join', path: '/position/x', message: 'must be a number' },
		]);
		const list = getByTestId('orphan-errors');
		expect(list.textContent).toContain('/config/unknown_key: not allowed');
		expect(list.textContent).toContain('/position/x: must be a number');
		expect(list.compareDocumentPosition(getByTestId('flow-inspector').querySelector('button')!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
	});

	it('does the same for the trigger and flow settings when nothing is selected', () => {
		// The wire omits node_id on a flow-level error.
		const { getByTestId, container } = setup(null, [
			{ path: '/trigger/config/method', message: 'unknown method' },
			{ path: '/settings/timeout', message: 'not a duration' },
		]);
		expect(container.textContent).toContain('unknown method');
		const list = getByTestId('orphan-errors');
		expect(list.textContent).toContain('/settings/timeout: not a duration');
		expect(list.textContent).not.toContain('unknown method');
	});

	it('lists every error of a node whose type is not in the catalog', () => {
		const retired = { ...joinFlow, nodes: joinFlow.nodes.map((n) => (n.id === 'join' ? { ...n, type: 'data.retired' } : n)) };
		const { getByTestId } = render(FlowInspector, {
			props: {
				definition: retired,
				catalog: fixtureCatalog,
				selected: { kind: 'node', id: 'join' },
				errors: [{ node_id: 'join', path: '/type', message: 'unknown node type' }],
				onchange: vi.fn(),
				onselect: vi.fn(),
			},
		});
		expect(getByTestId('orphan-errors').textContent).toContain('/type: unknown node type');
	});
});

describe('FlowInspector editors', () => {
	it('renders the inline data editor for a node whose schema has that shape', () => {
		const withInline = {
			...joinFlow,
			nodes: [
				...joinFlow.nodes,
				{ id: 'seed', type: 'data.inline', position: { x: 0, y: 0 }, config: { format: 'table', columns: ['id'], rows: [['1']] } },
			],
		};
		const { getByTestId, queryByTestId } = render(FlowInspector, {
			props: { definition: withInline, catalog: fixtureCatalog, selected: { kind: 'node', id: 'seed' }, onchange: vi.fn(), onselect: vi.fn() },
		});
		expect(getByTestId('inline-data-editor')).toBeTruthy();
		expect(getByTestId('grid-editor')).toBeTruthy();
		expect(queryByTestId('node-config-form')).toBeNull();
	});

	it('lists datasources with their kind while nothing is selected', () => {
		const { container } = render(FlowInspector, {
			props: {
				definition: joinFlow,
				catalog: fixtureCatalog,
				selected: null,
				datasources: [{ id: 'd1', name: 'warehouse', kind: 'postgres' }],
				onchange: vi.fn(),
				onselect: vi.fn(),
			},
		});
		expect(container.textContent).toContain('warehouse');
		expect(container.textContent).toContain('postgres');
	});
});

describe('FlowInspector shape', () => {
	it('shows the name and the form, folds the id under Advanced, lists no ports and ends in a text delete', () => {
		const onchange = vi.fn();
		const onselect = vi.fn();
		const { container, getByRole, getByLabelText } = render(FlowInspector, {
			props: { definition: joinFlow, catalog: fixtureCatalog, selected: { kind: 'node', id: 'join' }, onchange, onselect },
		});
		const text = container.textContent ?? '';
		expect(text).not.toContain('Ports');
		expect(text).not.toContain('Inputs');
		expect(text).not.toContain('Outputs');
		expect(getByLabelText('Name')).toBeTruthy();
		const advanced = getByRole('button', { name: /Advanced/ });
		expect(advanced.getAttribute('aria-expanded')).toBe('false');
		const remove = getByRole('button', { name: 'Delete node' });
		expect(remove.className).toContain('text-danger');
		expect(remove.className).not.toContain('bg-danger');
		expect(container.querySelector('[data-testid="flow-inspector"]')?.lastElementChild?.contains(remove)).toBe(true);
	});

	it('folds the run limits under Advanced while nothing is selected, and opens them for an error there', () => {
		const closed = render(FlowInspector, {
			props: { definition: joinFlow, catalog: fixtureCatalog, selected: null, onchange: vi.fn(), onselect: vi.fn() },
		});
		expect(closed.getByRole('button', { name: /Advanced/ }).getAttribute('aria-expanded')).toBe('false');
		cleanup();
		const open = render(FlowInspector, {
			props: {
				definition: joinFlow,
				catalog: fixtureCatalog,
				selected: null,
				errors: [{ path: '/settings/timeout', message: 'not a duration' }],
				onchange: vi.fn(),
				onselect: vi.fn(),
			},
		});
		expect(open.getByRole('button', { name: /Advanced/ }).getAttribute('aria-expanded')).toBe('true');
		expect(open.getByLabelText('Run timeout')).toBeTruthy();
	});
});

describe('FlowInspector event trigger', () => {
	function withTrigger(config: Record<string, unknown>) {
		return { ...joinFlow, trigger: { type: 'trigger.event', config } };
	}

	it('shows the kind as a segmented row and the content fields by default', () => {
		const { getByRole, getByLabelText, queryByLabelText, getByTestId } = render(FlowInspector, {
			props: {
				definition: withTrigger({ schema: 'orders', event: 'after_create' }),
				catalog: fixtureCatalog,
				selected: null,
				schemas: fixtureSchemas,
				eventTypes: fixtureEventTypes,
				onchange: vi.fn(),
				onselect: vi.fn(),
			},
		});
		expect(getByTestId('event-trigger-form')).toBeTruthy();
		expect(getByRole('radio', { name: 'Content' }).getAttribute('aria-checked')).toBe('true');
		expect(getByRole('combobox', { name: /content type/i })).toBeTruthy();
		expect(getByRole('combobox', { name: /event/i })).toBeTruthy();
		expect(queryByLabelText(/^Hook/)).toBeNull();
		expect(queryByLabelText(/^filter/)).toBeNull();
		expect(getByLabelText('Trigger type')).toBeTruthy();
	});

	it('switches to a system event with only the kind kept', async () => {
		const onchange = vi.fn();
		const { getByRole } = render(FlowInspector, {
			props: {
				definition: withTrigger({ schema: 'orders', event: 'after_create' }),
				catalog: fixtureCatalog,
				selected: null,
				eventTypes: fixtureEventTypes,
				onchange,
				onselect: vi.fn(),
			},
		});
		await fireEvent.click(getByRole('radio', { name: 'System' }));
		expect(onchange).toHaveBeenCalledTimes(1);
		expect(onchange.mock.calls[0][0].trigger).toEqual({ type: 'trigger.event', config: { kind: 'system' } });
	});

	it('shows the grouped hook picker and the filter for a system event', async () => {
		const onchange = vi.fn();
		const { getByRole, getByLabelText, queryByRole, container } = render(FlowInspector, {
			props: {
				definition: withTrigger({ kind: 'system', name: 'flow.run_failed' }),
				catalog: fixtureCatalog,
				selected: null,
				eventTypes: { ...fixtureEventTypes, system: fixtureGroupedEventTypes },
				onchange,
				onselect: vi.fn(),
			},
		});
		expect(getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true');
		expect(queryByRole('combobox', { name: /event/i })).toBeNull();
		expect(getByRole('combobox', { name: /hook/i })).toBeTruthy();
		// The schema stays as an optional narrowing: a flow slug for a run hook.
		expect((getByLabelText(/^Scope \(content type or publisher key\)/) as HTMLInputElement).required).toBe(false);
		expect(container.textContent).toContain('A flow run ended failed.');
		await fireEvent.click(container.querySelector('#trigger-name') as HTMLElement);
		expect([...document.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label'))).toEqual(['example', 'flow']);
		await fireEvent.click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('example.opened')) as HTMLElement);
		expect(onchange.mock.calls[0][0].trigger.config).toEqual({ kind: 'system', name: 'example.opened' });
		await fireEvent.input(getByLabelText(/^filter/), { target: { value: '{{ trigger.data.error != "" }}' } });
		expect(onchange.mock.calls[1][0].trigger.config).toEqual({ kind: 'system', name: 'flow.run_failed', filter: '{{ trigger.data.error != "" }}' });
	});

	it('takes a typed hook name when the engine has no event-types route', () => {
		const { getByLabelText, container } = render(FlowInspector, {
			props: {
				definition: withTrigger({ kind: 'system' }),
				catalog: fixtureCatalog,
				selected: null,
				eventTypes: null,
				onchange: vi.fn(),
				onselect: vi.fn(),
			},
		});
		expect((getByLabelText(/^Hook/) as HTMLInputElement).tagName).toBe('INPUT');
		expect(container.textContent).toContain('No hooks to choose from');
	});

	it('shows a validation error on the hook under its field', () => {
		const { container, queryByTestId } = render(FlowInspector, {
			props: {
				definition: withTrigger({ kind: 'system', name: 'flow.run_failed' }),
				catalog: fixtureCatalog,
				selected: null,
				eventTypes: fixtureEventTypes,
				errors: [{ path: '/trigger/config/name', message: 'must match [a-z][a-z0-9_.:-]{0,79}' }],
				onchange: vi.fn(),
				onselect: vi.fn(),
			},
		});
		expect(container.textContent).toContain('must match');
		expect(queryByTestId('orphan-errors')).toBeNull();
	});
});

describe('FlowInspector contributed trigger', () => {
	function mount(definition = joinFlow, onchange = vi.fn()) {
		return render(FlowInspector, {
			props: { definition, catalog: fixtureCatalog, selected: null, schemas: fixtureSchemas, eventTypes: fixtureEventTypes, onchange, onselect: vi.fn() },
		});
	}

	it('lists the built-in kinds first, then a group per contributing plugin', async () => {
		const onchange = vi.fn();
		const { container } = mount(joinFlow, onchange);
		await fireEvent.click(container.querySelector('#trigger-type') as HTMLElement);
		const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim());
		expect(options.slice(0, 3)).toEqual(['HTTP request', 'Schedule', 'Event']);
		expect(options.at(-1)).toBe('Email bounced');
		expect([...document.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label'))).toEqual(['Email']);
		const group = document.querySelector('[role="group"]') as HTMLElement;
		expect(group.querySelector('[role="option"] svg')).toBeTruthy();
		await fireEvent.click(group.querySelector('[role="option"]') as HTMLElement);
		expect(onchange.mock.calls[0][0].trigger).toEqual({ type: 'email.bounced', config: { template: 'welcome' } });
	});

	it('renders a contributed trigger\'s config from its schema with the plugin mark beside the label', () => {
		const { getByTestId, getByLabelText, queryByTestId, container } = mount({
			...joinFlow,
			trigger: { type: 'email.bounced', config: { template: 'welcome' } },
		});
		const mark = getByTestId('trigger-plugin');
		expect(mark.textContent).toContain('Email bounced');
		expect(mark.textContent).toContain('plugin');
		expect(mark.textContent).toContain('Email');
		expect(mark.querySelector('svg')?.getAttribute('class')).toContain('text-muted');
		expect(queryByTestId('event-trigger-form')).toBeNull();
		expect((getByLabelText(/^Template/) as HTMLInputElement).value).toBe('welcome');
		expect(container.textContent).toContain('Starts the flow when a sent email bounces.');
	});

	it('shows no plugin mark on a built-in trigger', () => {
		const { queryByTestId } = mount();
		expect(queryByTestId('trigger-plugin')).toBeNull();
	});
});


describe('FlowInspector locked triggers', () => {
	it('groups the triggers the plugin locks after the others and marks the chosen one', async () => {
		const { container, getByTestId } = render(FlowInspector, {
			props: { definition: joinFlow, catalog: withLocked(fixtureCatalog, ['trigger.http']), selected: null, onchange: vi.fn(), onselect: vi.fn() },
		});
		expect(getByTestId('trigger-locked').textContent).toContain('not enabled on this instance');
		await fireEvent.click(container.querySelector('#trigger-type') as HTMLElement);
		const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim());
		expect(options.slice(0, 3)).toEqual(['Schedule', 'Event', 'HTTP request']);
		expect([...document.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label'))).toEqual(['Not enabled on this instance', 'Email']);
	});

	it('marks nothing when the trigger is enabled', () => {
		const { queryByTestId } = render(FlowInspector, {
			props: { definition: joinFlow, catalog: fixtureCatalog, selected: null, onchange: vi.fn(), onselect: vi.fn() },
		});
		expect(queryByTestId('trigger-locked')).toBeNull();
	});

	it('marks an address that exists through an option the plugin locks, and no other', () => {
		const catalog = fixtureCatalog.map((s) =>
			s.type === 'trigger.http'
				? { ...s, config_schema: { ...s.config_schema, properties: { ...s.config_schema.properties, path: { type: 'string', 'x-enabled': false }, protocols: { type: 'array', items: { type: 'string' } } } } }
				: s
		);
		const definition = { ...joinFlow, trigger: { type: 'trigger.http', config: { method: 'GET', auth: 'public', path: '/api/v1/orders', protocols: ['rest', 'grpc'] } } };
		const { queryByTestId } = render(FlowInspector, {
			props: { definition, catalog, selected: null, flowId: 'f1', origin: 'https://cms.example.com', onchange: vi.fn(), onselect: vi.fn() },
		});
		expect(queryByTestId('endpoint-locked-path')).not.toBeNull();
		expect(queryByTestId('endpoint-locked-grpc')).toBeNull();
		expect(queryByTestId('endpoint-locked-rest')).toBeNull();
		expect(queryByTestId('option-locked-path')).not.toBeNull();
	});
});

describe('FlowInspector slug and endpoints', () => {
	const origin = 'https://cms.example.com';

	it('shows the slug and the URLs the flow answers at, each with a copy control', () => {
		const { getByLabelText, getByTestId } = render(FlowInspector, {
			props: { definition: joinFlow, catalog: fixtureCatalog, selected: null, flowId: 'f1', savedSlug: joinFlow.slug, origin, onchange: vi.fn(), onselect: vi.fn() },
		});
		expect((getByLabelText('Slug') as HTMLInputElement).value).toBe(joinFlow.slug);
		const block = getByTestId('flow-endpoints');
		expect(block.textContent).toContain('REST URL');
		expect((getByLabelText('REST URL') as HTMLInputElement).value).toBe(`${origin}/api/v1/flows/${joinFlow.slug}`);
		expect(block.querySelector('button[aria-label^="Copy"]')).not.toBeNull();
	});

	it('writes a new slug into the definition and says what the old one stops answering', async () => {
		const onchange = vi.fn();
		const renamed = { ...joinFlow, slug: 'orders-v2' };
		const { getByLabelText, container } = render(FlowInspector, {
			props: { definition: renamed, catalog: fixtureCatalog, selected: null, flowId: 'f1', savedSlug: joinFlow.slug, origin, onchange, onselect: vi.fn() },
		});
		expect(container.textContent).toContain(`/api/v1/flows/${joinFlow.slug}`);
		expect(container.textContent).toContain('stop working');
		expect((getByLabelText('REST URL') as HTMLInputElement).value).toBe(`${origin}/api/v1/flows/orders-v2`);
		await fireEvent.input(getByLabelText('Slug'), { target: { value: 'orders-v3' } });
		expect(onchange).toHaveBeenCalledWith(expect.objectContaining({ slug: 'orders-v3' }));
	});

	it('marks a slug the engine would refuse', () => {
		const { container } = render(FlowInspector, {
			props: { definition: { ...joinFlow, slug: 'Not A Slug' }, catalog: fixtureCatalog, selected: null, flowId: 'f1', savedSlug: joinFlow.slug, origin, onchange: vi.fn(), onselect: vi.fn() },
		});
		expect(container.textContent).toContain('starting with a letter');
	});
});

describe('FlowInspector on error', () => {
	// Each choice changes what a failure does to the rest of the run, so each
	// says so beside it.
	it('offers stop and continue as choices that each say what they do', () => {
		const { getAllByRole, container } = setup(null, []);
		const radios = getAllByRole('radio').filter((r) => (r as HTMLInputElement).name === 'settings-on-error');
		expect(radios).toHaveLength(2);
		expect(container.textContent).toContain('The run ends at the first node that fails');
	});
});

describe('FlowInspector names that could not be read', () => {
	const flowView = (over: Record<string, unknown>) =>
		render(FlowInspector, {
			props: { definition: joinFlow, catalog: fixtureCatalog, selected: null, errors: [], onchange: vi.fn(), onselect: vi.fn(), ...over },
		});

	it('says the datasources could not be read, with Try again, instead of hiding them', () => {
		const { container, getByRole } = flowView({ variables: ['region'], datasourcesGate: { state: 'unavailable' } });
		expect(container.textContent).toContain('so datasources did not load');
		expect(getByRole('link', { name: /Try again/ })).toBeTruthy();
		expect(container.textContent).toContain('vars.region');
	});

	it('draws the section for a failed read even when nothing else was read', () => {
		const { container } = flowView({ variablesGate: { state: 'error', message: 'Could not load variables.' } });
		expect(container.textContent).toContain('Available names');
		expect(container.textContent).toContain('Could not load variables.');
	});

	// The names are admin routes, so a role refused them sees no section, as
	// it sees no shortcut to them.
	it('stays quiet for a role the names are refused to', () => {
		const { container } = flowView({ datasourcesGate: { state: 'forbidden' }, variablesGate: { state: 'forbidden' } });
		expect(container.textContent).not.toContain('Available names');
	});

	// A refused or unlicensed read listed nothing, which is not the same as none.
	it('draws no datasources row beside the variables when the datasources were refused or not enabled', () => {
		for (const state of ['forbidden', 'locked', 'absent'] as const) {
			const { container, unmount } = flowView({ variables: ['region'], datasourcesGate: { state } });
			const terms = Array.from(container.querySelectorAll('dt')).map((dt) => dt.textContent);
			expect(terms).toEqual(['Variables']);
			expect(container.textContent).toContain('vars.region');
			unmount();
		}
	});

	it('draws no variables row beside the datasources when the variables were refused', () => {
		const { container } = flowView({ datasources: [{ id: 'd1', name: 'warehouse', kind: 'postgres' }], variablesGate: { state: 'forbidden' } });
		expect(Array.from(container.querySelectorAll('dt')).map((dt) => dt.textContent)).toEqual(['Datasources']);
	});
});

describe('FlowInspector and the Fill fields with AI node', () => {
	it('offers the node only the fields it can fill', async () => {
		const fill: NodeSpec = {
			type: 'content.fill',
			category: 'data',
			label: 'Fill fields with AI',
			description: 'Fills the fields of a content type from the source.',
			inputs: [{ name: 'in' }],
			outputs: [{ name: 'out' }],
			config_schema: {
				type: 'object',
				properties: {
					schema: { type: 'string', 'x-source': 'content-schemas' },
					fields: { type: 'array', items: { type: 'string' }, 'x-source': 'content-fields' },
				},
				required: ['schema'],
			},
			example: { schema: 'posts' },
			side_effects: false,
			trigger: false,
		};
		const definition = {
			...joinFlow,
			nodes: [...joinFlow.nodes, { id: 'fill', type: 'content.fill', name: 'Fill', position: { x: 0, y: 0 }, config: { schema: 'posts' } }],
		};
		const schemas: SchemaOption[] = [
			{ name: 'posts', display_name: 'Posts', fields: ['title', 'body', 'author'], unfillable: { body: 'is marked No AI', author: 'is a relation field' } },
		];
		const { container } = render(FlowInspector, {
			props: { definition, catalog: [...fixtureCatalog, fill], selected: { kind: 'node', id: 'fill' }, schemas, onchange: vi.fn(), onselect: vi.fn() },
		});
		await fireEvent.click(container.querySelector('#node-fill-fields') as HTMLElement);
		const offered = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim());
		expect(offered).toEqual(['title']);
	});
});
