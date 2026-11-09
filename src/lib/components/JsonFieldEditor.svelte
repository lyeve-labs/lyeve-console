<script lang="ts" module>
	export type JsonPair = { key: string; value: string };

	/**
	 * The pairs a JSON text reads as, or null when it is not a flat object.
	 *
	 * Only an object whose values are strings, numbers, booleans or null has a
	 * faithful key-value form. A nested value would have to be flattened or
	 * shown as text, and either one changes the document on the next save.
	 */
	export function pairsOf(text: string): JsonPair[] | null {
		const raw = text.trim();
		if (raw === '') return [];
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return null;
		}
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		const pairs: JsonPair[] = [];
		for (const [key, v] of Object.entries(parsed)) {
			if (v !== null && typeof v === 'object') return null;
			pairs.push({ key, value: typeof v === 'string' ? v : JSON.stringify(v) });
		}
		return pairs;
	}

	/**
	 * A typed cell back to its JSON value: a number, true, false and null keep
	 * their type, so a pair typed as 3 saves as 3 and not as "3". Anything else
	 * is a string.
	 */
	export function cellValue(text: string): unknown {
		const t = text.trim();
		if (t === 'true') return true;
		if (t === 'false') return false;
		if (t === 'null') return null;
		if (t !== '' && /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return Number(t);
		return text;
	}

	/** The JSON text for a set of pairs. A pair with no key is left out. */
	export function textOf(pairs: JsonPair[]): string {
		const out: Record<string, unknown> = {};
		for (const p of pairs) if (p.key.trim() !== '') out[p.key.trim()] = cellValue(p.value);
		return Object.keys(out).length === 0 ? '' : JSON.stringify(out, null, 2);
	}

	/** Why a JSON text does not parse, or null when it does or is empty. */
	export function parseError(text: string): string | null {
		if (text.trim() === '') return null;
		try {
			JSON.parse(text);
			return null;
		} catch (e) {
			return e instanceof Error ? e.message : 'Not valid JSON.';
		}
	}
</script>

<script lang="ts">
	import { Button, Collapsible, Input, SegmentedControl, Textarea } from '@lyeve-labs/ui-kit';
	import { Plus, Trash2 } from '@lucide/svelte';
	import { ICON } from '$lib/icon';

	type TextareaEv = Event & { currentTarget: HTMLTextAreaElement };
	type InputEv = Event & { currentTarget: HTMLInputElement };

	let {
		id,
		value = $bindable(''),
		error = undefined,
		errorKey = undefined,
		required = false,
	}: {
		id?: string;
		/** The document as JSON text, the form state's shape for a json field. */
		value?: string;
		error?: string;
		/** The key the error is about. Its row carries the message. */
		errorKey?: string;
		required?: boolean;
	} = $props();

	// A flat object opens as pairs, which is what most json fields hold and the
	// shape a person can edit without writing a brace. Anything else opens as text.
	let mode = $state<'pairs' | 'json'>(pairsOf(value) === null ? 'json' : 'pairs');
	// Each row keeps its own id, so removing one leaves the inputs below it
	// bound to the rows they were typed into.
	type Row = JsonPair & { id: number };
	let nextRow = 0;
	const row = (pair: JsonPair = { key: '', value: '' }): Row => ({ ...pair, id: nextRow++ });
	let pairs = $state<Row[]>(openingPairs(value));

	function openingPairs(text: string): Row[] {
		const read = pairsOf(text) ?? [];
		return read.length > 0 ? read.map((p) => row(p)) : [row()];
	}

	const invalid = $derived(parseError(value));
	const preview = $derived.by(() => {
		if (value.trim() === '' || invalid) return '';
		return JSON.stringify(JSON.parse(value), null, 2);
	});
	const pairable = $derived(pairsOf(value) !== null);

	const uid = $props.id();
	const base = $derived(id ?? uid);
	// The row that holds the refused key shows the message under its value,
	// which the kit marks invalid and describes. With no such row, the message
	// stays under the editor and the first key points at it.
	const marked = $derived(error && errorKey ? pairs.findIndex((p) => p.key.trim() === errorKey) : -1);
	const looseError = $derived(`${base}-error`);

	function syncFromPairs() {
		value = textOf(pairs);
	}

	function setMode(next: string) {
		if (next === 'pairs') {
			const read = pairsOf(value);
			if (read === null) return;
			pairs = read.length > 0 ? read.map((p) => row(p)) : [row()];
		}
		mode = next as 'pairs' | 'json';
	}

	function addPair() {
		pairs = [...pairs, row()];
	}

	function removePair(index: number) {
		pairs = pairs.filter((_, i) => i !== index);
		if (pairs.length === 0) pairs = [row()];
		syncFromPairs();
	}

	function tidy() {
		if (preview) value = preview;
	}
</script>

<div class="flex flex-col gap-3" data-testid="json-field">
	<SegmentedControl
		label="How to edit this value"
		labelHidden
		value={mode}
		options={[
			{ value: 'pairs', label: 'Keys and values' },
			{ value: 'json', label: 'JSON' },
		]}
		onchange={setMode}
		hint={mode === 'json' && !pairable && value.trim() !== ''
			? 'Keys and values works only for a flat object. This value is nested or is not an object, so edit it as JSON.'
			: undefined}
	/>

	{#if mode === 'pairs'}
		<div class="flex flex-col gap-2" role="group" aria-label="Keys and values">
			{#each pairs as pair, index (pair.id)}
				<div class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-start gap-2">
					<Input
						label="Key"
						id={index === 0 ? id : undefined}
						aria-invalid={marked === -1 && error && index === 0 ? 'true' : undefined}
						describedBy={marked === -1 && error && index === 0 ? looseError : undefined}
						value={pair.key}
						placeholder="key"
						class="[&_label]:sr-only"
						oninput={(e: InputEv) => { pairs[index].key = e.currentTarget.value; syncFromPairs(); }}
						mono
					/>
					<Input
						label="Value"
						id="{base}-value-{index}"
						error={index === marked ? error : undefined}
						value={pair.value}
						placeholder="value"
						class="[&_label]:sr-only"
						oninput={(e: InputEv) => { pairs[index].value = e.currentTarget.value; syncFromPairs(); }}
					/>
					<Button variant="ghost" size="sm" aria-label="Remove {pair.key || 'this pair'}" onclick={() => removePair(index)}>
						<Trash2 size={ICON.sm} />
					</Button>
				</div>
			{/each}
			<div>
				<Button variant="secondary" size="sm" onclick={addPair}>
					<Plus size={ICON.sm} /> Add row
				</Button>
			</div>
			<p class="text-xs text-faint">Numbers, true, false and null keep their type. Everything else is saved as text.</p>
		</div>
	{:else}
		<Textarea
			{id}
			{required}
			error={error ?? (invalid ? `Not valid JSON: ${invalid}` : undefined)}
			{value}
			rows={8}
			placeholder={'{\n  "key": "value"\n}'}
			class="[&_textarea]:text-xs"
			oninput={(e: TextareaEv) => { value = e.currentTarget.value; }}
			onblur={tidy}
			mono
		/>
	{/if}

	{#if mode === 'pairs' && error && marked === -1}
		<p id={looseError} class="text-xs text-danger">{error}</p>
	{/if}

	{#if preview}
		<Collapsible label="What is saved" open={mode === 'pairs'}>
			<pre class="max-h-64 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs text-fg" data-testid="json-preview">{preview}</pre>
		</Collapsible>
	{/if}
</div>
