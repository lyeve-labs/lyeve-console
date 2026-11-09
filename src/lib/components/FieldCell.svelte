<script lang="ts">
	import { Badge } from '@lyeve-labs/ui-kit';
	import type { SchemaField } from '@lyeve-labs/client';
	import { formatDate, formatDateTime, plural } from '$lib/format';
	import { shortId } from '$lib/utils/entry-identity';

	let { field, value }: { field: SchemaField; value: unknown } = $props();

	// One marker for every empty cell. A bare hyphen reads as "dash" or as nothing
	// at all depending on the screen reader, and says nothing about the cell.
	const EMPTY_LABEL = 'Not set';

	// A falsy test would swallow the number 0 and the boolean false, which are values.
	function isBlank(v: unknown): boolean {
		return v === null || v === undefined || v === '';
	}

	/**
	 * Values that can be offered as a destination.
	 *
	 * A read comes back through the tenant's field rules, and a value those
	 * rules cover arrives masked or fully redacted: "j***@example.com" and
	 * "[redacted]" both still sit in an email column and read like an address.
	 * Linking one offers a destination that does not exist, so the click either
	 * does nothing or opens a message to a stranger, and an underline invites
	 * the click. Only a whole address, and only a URL with a scheme
	 * a browser will open, is a link. Everything else is text.
	 */
	const MAILABLE = /^[^\s*@[\]<>(),;:"]+@[^\s*@[\]<>(),;:"]+\.[^\s*@[\]<>(),;:"]+$/;
	const LINKABLE = /^https?:\/\/[^\s*[\]<>"]+$/;

	function stripHtml(html: string): string {
		return html.replace(/<[^>]*>/g, '').trim();
	}

	/*
	 * Both keep the stored value when it will not parse. A cell is the only
	 * place the reader can see what is actually in the column, and "Invalid
	 * Date" hides it.
	 */
	function cellDateTime(v: unknown): string {
		return formatDateTime(v as string, String(v));
	}

	function cellDate(v: unknown): string {
		return formatDate(v as string, String(v));
	}

	// Emptiness is decided once, above every field_type branch, so no branch can
	// render a chip for a cell that holds nothing.
	let empty = $derived.by((): boolean => {
		if (isBlank(value)) return true;
		// Markup with no text strips to nothing, so the cell would paint blank.
		if (field.field_type === 'rich_text') return stripHtml(String(value)) === '';
		return false;
	});

	// $derived.by, not $derived: a multi-statement body passed to $derived stores the
	// closure and memoizes nothing, because the value it recomputes is a new function.
	let display = $derived.by((): string => {
		switch (field.field_type) {
			case 'boolean':
				return '';
			case 'rich_text':
				return stripHtml(String(value)).slice(0, 120);
			case 'date':
				return cellDate(value);
			case 'datetime':
				return cellDateTime(value);
			case 'json':
				return typeof value === 'object' ? '{...}' : String(value).slice(0, 40);
			case 'relation': {
				if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
					const obj = value as Record<string, unknown>;
					const label =
						obj['title'] ?? obj['name'] ?? obj['label'] ?? obj['slug'] ??
						obj['email'] ?? obj['display_name'];
					return label != null ? String(label).slice(0, 60) : '{...}';
				}
				if (Array.isArray(value)) {
					return `${(value as unknown[]).length} ${plural((value as unknown[]).length, 'item')}`;
				}
				const s = String(value);
				return s.length > 12 ? `${shortId(s)}...` : s;
			}
			default:
				return String(value).slice(0, 100);
		}
	});
</script>

{#if empty}
	<span class="text-faint">{EMPTY_LABEL}</span>
{:else if field.field_type === 'boolean'}
	<Badge tone={value ? 'success' : 'neutral'}>
		{value ? 'true' : 'false'}
	</Badge>
{:else if field.field_type === 'url'}
	{#if LINKABLE.test(String(value))}
		<a
			href={String(value)}
			target="_blank"
			rel="noopener noreferrer"
			class="text-brand hover:text-brand underline truncate max-w-45 block"
			title={String(value)}
		>
			{String(value).replace(/^https?:\/\//, '').slice(0, 40)}
		</a>
	{:else}
		<span class="text-fg truncate max-w-45 block" title={String(value)}>
			{String(value).slice(0, 40)}
		</span>
	{/if}
{:else if field.field_type === 'email'}
	{#if MAILABLE.test(String(value))}
		<a href="mailto:{value}" class="text-brand hover:text-brand underline">
			{String(value).slice(0, 40)}
		</a>
	{:else}
		<span class="text-fg">{String(value).slice(0, 40)}</span>
	{/if}
{:else if field.field_type === 'json'}
	<span class="font-mono text-xs text-muted bg-surface-2 px-1.5 py-0.5 rounded">{'{...}'}</span>
{:else if field.field_type === 'rich_text'}
	<span class="text-muted italic text-xs" title={display}>{display}</span>
{:else if field.field_type === 'relation'}
	{#if Array.isArray(value)}
		<Badge tone="brand">{(value as unknown[]).length} {plural((value as unknown[]).length, 'item')}</Badge>
	{:else}
		<span class="text-fg font-mono text-xs">{display}</span>
	{/if}
{:else}
	<span class="text-fg">{display}</span>
{/if}
