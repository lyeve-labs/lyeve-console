<script lang="ts">
	import { Alert, Badge, Button, Collapsible, Modal } from '@lyeve-labs/ui-kit';
	import type { Change } from '#lib/schema/editor.ts';
	import type { DryRunStatement } from '../+page.server';

	/**
	 * The preview action's answer, drawn one of two ways. A save that renames,
	 * retypes or drops a column asks first with the risk dialog. A look at the
	 * DDL from the toolbar is the read-only preview. Null draws neither.
	 */
	let {
		statements,
		error,
		risk,
		change,
		rowsAtRisk,
		table,
		saving,
		onclose,
		onsave,
	}: {
		statements: DryRunStatement[] | null;
		error: string;
		risk: boolean;
		change: Change;
		// Undefined while the count is unknown, which is never shown as 0.
		rowsAtRisk: number | undefined;
		table: string | undefined;
		saving: boolean;
		onclose: () => void;
		onsave: () => void;
	} = $props();
</script>

<!-- A previewed statement's number and description. One the engine marks
     destructive is queued by the save rather than run, and says so. -->
{#snippet statementHead(stmt: DryRunStatement, i: number)}
	<p class="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
		<span>{i + 1}. {stmt.description}</span>
		{#if stmt.destructive}
			<Badge tone="warn" size="sm">Queued</Badge>
		{/if}
	</p>
	{#if stmt.destructive}
		<p class="mb-1 text-xs text-muted">
			This statement drops data. Saving queues it, and it runs only when a super admin applies it from History.
		</p>
	{/if}
{/snippet}

<!-- The save that moves data asks first, with what it moves and how much. -->
{#if risk && statements !== null}
	{@const list = statements}
	<Modal open size="lg" title="This save changes columns that hold data" {onclose}>
		<div class="flex flex-col gap-4" data-testid="save-risk">
			<Alert tone={change.drops.length + change.systemDrops.length > 0 ? 'danger' : 'warn'}>
				{#snippet children()}
					{#if rowsAtRisk === undefined}
						Could not count the rows in {table ?? 'this table'}. Assume it has data.
					{:else}
						{table ?? 'This table'} has {rowsAtRisk} {rowsAtRisk === 1 ? 'row' : 'rows'}.
					{/if}
					<ul class="mt-1 space-y-0.5">
						{#each change.renames as r (r.from)}
							<li>Renames <span class="font-mono">{r.from}</span> to <span class="font-mono">{r.to}</span>. The data moves with it.</li>
						{/each}
						{#each change.retypes as r (r.name)}
							<li>Changes <span class="font-mono">{r.name}</span> from {r.from} to {r.to}. A value that does not convert is lost.</li>
						{/each}
						{#each [...change.drops, ...change.systemDrops] as name (name)}
							<li>Removes <span class="font-mono">{name}</span> from the definition. The column and its data stay in the table until the queued change is applied from History. When another tenant defines the same field, the column stays and only this tenant's values are cleared.</li>
						{/each}
					</ul>
				{/snippet}
			</Alert>
			{#if error}
				<Alert tone="danger">{error}</Alert>
			{:else if list.length === 0}
				<p class="text-sm text-muted">
					{change.renames.length > 0 ? 'Besides the renames, the table already matches this definition.' : 'The table already matches this definition.'}
				</p>
			{:else}
				{#if change.renames.length > 0}
					<p class="text-sm text-muted">The renames run first. Then:</p>
				{/if}
				<div class="flex flex-col gap-3">
					{#each list as stmt, i (stmt.description + i)}
						<div data-testid="ddl-statement" data-destructive={stmt.destructive ? 'true' : undefined}>
							{@render statementHead(stmt, i)}
							<pre class="overflow-x-auto rounded bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap text-fg">{stmt.sql}</pre>
						</div>
					{/each}
				</div>
			{/if}
		</div>
		{#snippet footer()}
			<Button variant="secondary" onclick={onclose}>Cancel</Button>
			<Button
				variant={change.drops.length + change.systemDrops.length > 0 ? 'danger' : 'primary'}
				loading={saving}
				disabled={Boolean(error)}
				onclick={onsave}
			>
				Save
			</Button>
		{/snippet}
	</Modal>
{:else if statements !== null}
	{@const list = statements}
	<Modal open size="lg" title="Preview DDL" {onclose}>
		<!-- A save runs each rename through its own route before the definition,
		     so the engine previews the rest under the old names and never lists
		     a rename. It is named here, ahead of what the engine answered. -->
		{#if change.renames.length > 0}
			<ul class="mb-4 space-y-0.5 text-sm" data-testid="ddl-renames">
				{#each change.renames as r (r.from)}
					<li>Renames <span class="font-mono">{r.from}</span> to <span class="font-mono">{r.to}</span>. The data moves with it.</li>
				{/each}
			</ul>
		{/if}
		{#if error}
			<Alert tone="danger">{error}</Alert>
		{:else if list.length === 0}
			<p class="text-sm text-muted">
				{change.renames.length > 0 ? 'Besides the renames, the table already matches this definition.' : 'No DDL changes. The table already matches this definition.'}
			</p>
		{:else}
			{#if change.renames.length > 0}
				<p class="mb-2 text-sm text-muted">The renames run first. Then:</p>
			{/if}
			<div class="flex flex-col gap-4">
				{#each list as stmt, i (stmt.description + i)}
					<div data-testid="ddl-statement" data-destructive={stmt.destructive ? 'true' : undefined}>
						{@render statementHead(stmt, i)}
						<pre class="overflow-x-auto rounded bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap text-fg">{stmt.sql}</pre>
						{#if stmt.down_sql}
							<Collapsible label="Down SQL" class="mt-1">
								<pre class="mt-1 overflow-x-auto rounded bg-surface-2/60 p-3 font-mono text-xs whitespace-pre-wrap text-muted">{stmt.down_sql}</pre>
							</Collapsible>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
		{#snippet footer()}
			<Button variant="secondary" onclick={onclose}>Close</Button>
		{/snippet}
	</Modal>
{/if}
