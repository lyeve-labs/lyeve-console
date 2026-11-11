import { confirm, toast } from '@lyeve-labs/ui-kit';
import type { SubmitFunction } from '@sveltejs/kit';
import { invalidate } from '$app/navigation';
import { MIGRATIONS_DEPENDENCY } from '$lib/api/migrate';
import { appliedMessage } from '$lib/schema/editor';
import type { HistoryEntry } from '../+page.server';

export type HistoryView = { name: string; entries: HistoryEntry[]; pending: number; limit: number };

/** What the history reads from the page: the table on screen, the role, and the row counts. */
export type HistorySource = {
	table: () => string | undefined;
	isSuperAdmin: () => boolean;
	rowCounts: () => Record<string, number>;
};

/**
 * The table's history: what each save ran and what it queued. Read when
 * the History tab is first shown, so opening a schema costs no extra request.
 *
 * The page owns the two hidden forms that read and apply it, and the editor
 * draws the tab. Both hold this one object, so the section keeps its
 * state when the editor moves between the list and the canvas.
 *
 * Construct it while a component initializes: it registers its effects there.
 */
export class DdlHistory {
	form = $state<HTMLFormElement>();
	applyForm = $state<HTMLFormElement>();
	open = $state(false);
	view = $state<HistoryView | null>(null);
	error = $state('');
	// Kept apart from the read's failure: the read that follows an apply
	// clears that one, and a failed apply would vanish with it.
	applyError = $state('');
	loading = $state(false);
	applying = $state(false);

	#source: HistorySource;

	constructor(source: HistorySource) {
		this.#source = source;

		$effect(() => {
			// A different schema's history is not this one's.
			if (this.view && this.view.name !== this.#source.table()) {
				this.view = null;
				this.error = '';
				this.applyError = '';
			}
		});

		$effect(() => {
			if (this.open && this.#source.table() && !this.view && !this.loading && !this.error) this.load();
		});
	}

	load = () => {
		if (!this.#source.table() || !this.#source.isSuperAdmin()) return;
		this.form?.requestSubmit();
	};

	submit: SubmitFunction = () => {
		this.loading = true;
		this.error = '';
		return async ({ result }) => {
			this.loading = false;
			if (result.type === 'success' && result.data && 'entries' in result.data) {
				const d = result.data as HistoryView;
				this.view = { name: d.name, entries: d.entries, pending: d.pending, limit: d.limit };
			} else if (result.type === 'failure') {
				this.error = String((result.data as { error?: string })?.error ?? 'Try again in a moment.');
			} else if (result.type === 'error') {
				this.error = 'Try again in a moment.';
			}
		};
	};

	applyQueued = async () => {
		const table = this.#source.table();
		if (!table || !this.view?.pending) return;
		const rows = this.#source.rowCounts()[table];
		const held = rows === undefined ? 'Could not count the rows in the table. It may have data' : `The table has ${rows} ${rows === 1 ? 'row' : 'rows'}`;
		const ok = await confirm(
			`Apply ${this.view.pending} queued ${this.view.pending === 1 ? 'change' : 'changes'} to ${table}?`,
			`Saving queued these changes instead of running them: a column or table drop, or clearing one tenant's values in a column other tenants still use. ${held}, and every tenant that defines ${table} shares it, so the data in a dropped column is gone for all of them. If a definition uses a column again, its change is canceled instead of run.`,
			{ confirmLabel: 'Apply' },
		);
		if (ok) this.applyForm?.requestSubmit();
	};

	submitApply: SubmitFunction = () => {
		this.applying = true;
		this.applyError = '';
		return async ({ result }) => {
			this.applying = false;
			if (result.type === 'success' && result.data && 'applied' in result.data) {
				toast.success(appliedMessage(Number(result.data.applied), Number((result.data as { canceled?: number }).canceled ?? 0)));
				this.load();
			} else if (result.type === 'failure') {
				this.applyError = String((result.data as { error?: string })?.error ?? 'Could not apply the queued changes. Try again.');
				this.load();
			}
			// A failed apply can still have run the statements before the one that
			// failed, so the header's count is read again either way.
			if (result.type === 'success' || result.type === 'failure') await invalidate(MIGRATIONS_DEPENDENCY);
		};
	};
}
