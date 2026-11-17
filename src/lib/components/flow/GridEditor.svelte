<script lang="ts">
	import { Button, Input, Table } from '@lyeve-labs/ui-kit';
	import { Plus, Trash2 } from '@lucide/svelte';
	import { ICON } from '#lib/icon.ts';

	/**
	 * A small table typed in place: editable column headers and cells, rows
	 * and columns added and removed. It writes `columns` and `rows` as the
	 * inline data node stores them and never parses anything. The preview
	 * line under it is the row count the engine will hand on.
	 */
	interface Props {
		columns: string[];
		rows: string[][];
		idPrefix?: string;
		onchange: (next: { columns: string[]; rows: string[][] }) => void;
	}

	let { columns, rows, idPrefix = 'grid', onchange }: Props = $props();

	/** A row padded or cut to the column count, so a removed column never leaves a stray cell. */
	function fit(row: string[], width: number): string[] {
		return Array.from({ length: width }, (_, i) => row[i] ?? '');
	}

	function emit(nextColumns: string[], nextRows: string[][]) {
		onchange({ columns: nextColumns, rows: nextRows.map((r) => fit(r, nextColumns.length)) });
	}

	function renameColumn(i: number, name: string) {
		emit(
			columns.map((c, j) => (j === i ? name : c)),
			rows
		);
	}

	function addColumn() {
		emit([...columns, `column_${columns.length + 1}`], rows);
	}

	function removeColumn(i: number) {
		emit(
			columns.filter((_, j) => j !== i),
			rows.map((r) => r.filter((_, j) => j !== i))
		);
	}

	function addRow() {
		emit(columns, [...rows, fit([], columns.length)]);
	}

	function removeRow(i: number) {
		emit(
			columns,
			rows.filter((_, j) => j !== i)
		);
	}

	function setCell(r: number, c: number, text: string) {
		emit(
			columns,
			rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? text : cell)) : row))
		);
	}
</script>

<div class="flex flex-col gap-2" data-testid="grid-editor">
	{#if columns.length === 0}
		<p class="text-sm text-muted">No columns yet. Add one to start the table.</p>
	{:else}
		<Table label="Inline table" cell="auto">
			<thead>
				<tr>
					{#each columns as name, c (c)}
						<th scope="col">
							<div class="flex items-center gap-1">
								<Input
									id="{idPrefix}-col-{c}"
									aria-label="Column {c + 1} name"
									value={name}
									class="min-w-24"
									oninput={(e) => renameColumn(c, e.currentTarget.value)}
								/>
								<Button variant="ghost" size="sm" aria-label="Remove column {name || c + 1}" onclick={() => removeColumn(c)}>
									<Trash2 size={ICON.sm} class="text-danger" />
								</Button>
							</div>
						</th>
					{/each}
					<th scope="col"><span class="sr-only">Row actions</span></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row, r (r)}
					<tr>
						{#each columns as _, c (c)}
							<td>
								<Input
									id="{idPrefix}-cell-{r}-{c}"
									aria-label="Row {r + 1} {columns[c] || `column ${c + 1}`}"
									value={row[c] ?? ''}
									class="min-w-24"
									oninput={(e) => setCell(r, c, e.currentTarget.value)}
								/>
							</td>
						{/each}
						<td>
							<Button variant="ghost" size="sm" aria-label="Remove row {r + 1}" onclick={() => removeRow(r)}>
								<Trash2 size={ICON.sm} class="text-danger" />
							</Button>
						</td>
					</tr>
				{/each}
			</tbody>
		</Table>
	{/if}
	<div class="flex flex-wrap items-center gap-2">
		<Button variant="secondary" size="sm" onclick={addColumn}>
			<Plus size={ICON.sm} />
			Add column
		</Button>
		<Button variant="secondary" size="sm" onclick={addRow} disabled={columns.length === 0}>
			<Plus size={ICON.sm} />
			Add row
		</Button>
		<span class="ml-auto text-xs text-muted" data-testid="grid-preview">
			Preview: {rows.length} row{rows.length === 1 ? '' : 's'}, {columns.length} column{columns.length === 1 ? '' : 's'}
		</span>
	</div>
</div>
