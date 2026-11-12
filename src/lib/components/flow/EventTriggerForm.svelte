<script lang="ts">
	import { SegmentedControl } from '@lyeve-labs/ui-kit';
	import { Database, Webhook } from '@lucide/svelte';
	import NodeConfigForm from './NodeConfigForm.svelte';
	import type { JsonSchema, SchemaOption, SystemEvent } from '$lib/flow/types';
	import type { ValidationError } from '$lib/api/flows';
	import { eventKindOf, kindSchema, switchKind, type EventKind } from '$lib/flow/events';

	/**
	 * The event trigger: a choice between a content event, which names a
	 * schema and a change, and a system event, which names the hook a plugin
	 * publishes and an optional filter. The kind is a segmented row rather
	 * than a select because there are two of them and the choice redraws the
	 * form below it.
	 */
	interface Props {
		schema: JsonSchema;
		value: Record<string, unknown>;
		path?: string;
		errors?: ValidationError[];
		idPrefix?: string;
		schemas?: SchemaOption[];
		events?: SystemEvent[];
		onchange: (value: Record<string, unknown>) => void;
	}

	let { schema, value, path = '/trigger/config', errors = [], idPrefix = 'trigger', schemas = [], events = [], onchange }: Props = $props();

	const KINDS: { value: EventKind; label: string; icon: typeof Database }[] = [
		{ value: 'content', label: 'Content', icon: Database },
		{ value: 'system', label: 'System', icon: Webhook },
	];

	const KIND_HINTS: Record<EventKind, string> = {
		content: 'A record of a content type was created, updated or deleted.',
		system:
			'A hook a plugin publishes, such as a flow run that failed. The schema narrows it to one publisher, such as a flow slug, and the filter must be true for the run to start.',
	};

	const kind = $derived(eventKindOf(value));
	const shown = $derived(kindSchema(schema, kind));

	function pickKind(next: EventKind) {
		if (next !== kind) onchange(switchKind(schema, value, next));
	}
</script>

<div class="flex flex-col gap-3" data-testid="event-trigger-form">
	<SegmentedControl label="Kind" options={KINDS} value={kind} size="sm" onchange={pickKind} hint={KIND_HINTS[kind]} />
	<NodeConfigForm schema={shown} {value} {path} {errors} {idPrefix} {schemas} {events} {onchange} />
</div>
