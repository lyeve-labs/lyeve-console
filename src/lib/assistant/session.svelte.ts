/**
 * One conversation with the assistant, as the panel shows it.
 *
 * This is the one place the panel reaches the network, and only the console's
 * own routes: a form action answers once, and the assistant answers as a
 * stream. The console's route calls the engine as the person, so the browser
 * never holds the session.
 *
 * A proposal that targets the open form goes into that form as suggestions,
 * which the person accepts or rejects field by field and the page's own Save
 * posts. Any other proposal waits in the panel, shown in full, until the
 * person runs or rejects it.
 */

import type { AssistValue, FormAssistController } from '@lyeve-labs/ui-kit';
import { EventReader, type ApiProposal, type PlanEntry, type Step, type Usage } from './events';
import { formContext, type AssistantRequest } from './request';
import type { RefusalKind } from './refusal';

export const ASK_URL = '/admin/assistant';
export const RUN_URL = '/admin/assistant/run';

export type Turn =
	| { kind: 'person'; id: number; text: string }
	| { kind: 'message'; id: number; text: string }
	| {
			kind: 'proposal';
			id: number;
			proposal: ApiProposal;
			state: 'waiting' | 'running' | 'done' | 'failed' | 'rejected';
			outcome?: string;
	  }
	| {
			kind: 'form';
			id: number;
			form: string;
			values: { name: string; value: unknown; reason?: string }[];
			applied: string[];
			skipped: string[];
	  }
	| { kind: 'failure'; id: number; text: string };

/** A turn before it has an id, one shape per kind. */
type NewTurn = Turn extends infer T ? (T extends Turn ? Omit<T, 'id'> : never) : never;

/**
 * idle: nothing asked yet or the last answer finished. working: an answer is
 * streaming. stopped: the person stopped it. failed: the answer broke off.
 * refused: the route turned the request away, with `refusal` saying why.
 */
export type Status = 'idle' | 'working' | 'stopped' | 'failed' | 'refused';

export interface PageContext {
	path: string;
	title: string;
}

interface Deps {
	fetch?: typeof fetch;
	/** The form the panel works on, when one is open. */
	form?: () => FormAssistController | undefined;
	/** Whether the browser has a connection. */
	online?: () => boolean;
}

export class AssistantSession {
	turns = $state<Turn[]>([]);
	plan = $state<PlanEntry[]>([]);
	steps = $state<Step[]>([]);
	status = $state<Status>('idle');
	refusal = $state<RefusalKind | 'offline' | null>(null);
	usage = $state<Usage | null>(null);
	lastPrompt = $state('');

	#conversation = '';
	#abort: AbortController | null = null;
	#next = 0;
	readonly #fetch: typeof fetch;
	readonly #form: () => FormAssistController | undefined;
	readonly #online: () => boolean;

	constructor(deps: Deps = {}) {
		this.#fetch = deps.fetch ?? ((input, init) => fetch(input, init));
		this.#form = deps.form ?? (() => undefined);
		this.#online = deps.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
	}

	get working(): boolean {
		return this.status === 'working';
	}

	#push(turn: NewTurn): void {
		this.turns = [...this.turns, { ...turn, id: this.#next++ } as Turn];
	}

	/** Starts a new conversation. */
	reset(): void {
		this.stop();
		this.turns = [];
		this.plan = [];
		this.steps = [];
		this.usage = null;
		this.status = 'idle';
		this.refusal = null;
		this.#conversation = '';
	}

	stop(): void {
		if (!this.#abort) return;
		this.#abort.abort();
		this.#abort = null;
		this.status = 'stopped';
	}

	/** Sends a prompt with the page and the form open on it, and reads the answer as it streams. */
	async ask(prompt: string, page: PageContext): Promise<void> {
		const text = prompt.trim();
		if (text === '' || this.working) return;
		this.lastPrompt = text;
		this.#push({ kind: 'person', text });
		this.status = 'working';
		this.refusal = null;
		this.steps = [];

		const form = this.#form();
		const body: AssistantRequest = {
			prompt: text,
			page,
			...(this.#conversation ? { conversation_id: this.#conversation } : {}),
			...(form ? { form: formContext(form) } : {}),
		};
		const abort = new AbortController();
		this.#abort = abort;
		let res: Response;
		try {
			res = await this.#fetch(ASK_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
				body: JSON.stringify(body),
				signal: abort.signal,
			});
		} catch {
			if (abort.signal.aborted) return;
			this.#refuse(this.#online() ? 'outage' : 'offline');
			return;
		}
		if (!res.ok || !res.body) {
			const answer = (await res.json().catch(() => null)) as { refusal?: RefusalKind } | null;
			this.#refuse(answer?.refusal ?? 'failed');
			return;
		}
		await this.#read(res.body, form?.label, abort);
	}

	#refuse(kind: RefusalKind | 'offline'): void {
		this.#abort = null;
		this.refusal = kind;
		this.status = 'refused';
	}

	async #read(stream: ReadableStream<Uint8Array>, formLabel: string | undefined, abort: AbortController): Promise<void> {
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		const events = new EventReader();
		let failed = false;
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				for (const event of events.push(decoder.decode(value, { stream: true }))) {
					switch (event.type) {
						case 'message':
							this.#push({ kind: 'message', text: event.text });
							break;
						case 'plan':
							this.plan = event.entries;
							break;
						case 'step': {
							const at = this.steps.findIndex((s) => s.id === event.step.id);
							this.steps = at === -1 ? [...this.steps, event.step] : this.steps.map((s, i) => (i === at ? event.step : s));
							break;
						}
						case 'proposal':
							if (event.proposal.kind === 'api') this.#push({ kind: 'proposal', proposal: event.proposal, state: 'waiting' });
							else this.#fill(event.proposal.values, formLabel);
							break;
						case 'usage':
							this.usage = event.usage;
							break;
						case 'done':
							if (event.conversationId) this.#conversation = event.conversationId;
							break;
						case 'error':
							failed = true;
							this.#push({ kind: 'failure', text: event.message || 'The assistant could not answer. Try again in a moment.' });
							break;
					}
				}
			}
		} catch {
			if (abort.signal.aborted) return;
			failed = true;
			this.#push({
				kind: 'failure',
				text: this.#online() ? 'The answer stopped before it finished. Try again.' : "You're offline. Ask again once you reconnect.",
			});
		}
		if (abort.signal.aborted) return;
		this.#abort = null;
		this.status = failed ? 'failed' : 'idle';
	}

	/** Puts suggested values into the form the prompt was sent with, if it is still open. */
	#fill(values: { name: string; value: unknown; reason?: string }[], formLabel: string | undefined): void {
		const form = this.#form();
		const target = form && form.label === formLabel ? form : undefined;
		const result = target
			? target.suggest(Object.fromEntries(values.map((v) => [v.name, v.value as AssistValue])))
			: { applied: [], skipped: values.map((v) => ({ name: v.name })) };
		this.#push({
			kind: 'form',
			form: formLabel ?? '',
			values,
			applied: result.applied,
			skipped: result.skipped.map((s) => s.name),
		});
	}

	/** Rejects a proposed request. Nothing is sent. */
	reject(id: number): void {
		this.turns = this.turns.map((t) => (t.id === id && t.kind === 'proposal' && t.state === 'waiting' ? { ...t, state: 'rejected' } : t));
	}

	/** Runs a proposed request with the person's own session, once they approved it. */
	async run(id: number): Promise<void> {
		const turn = this.turns.find((t) => t.id === id);
		if (!turn || turn.kind !== 'proposal' || turn.state !== 'waiting') return;
		const set = (patch: Partial<Extract<Turn, { kind: 'proposal' }>>) => {
			this.turns = this.turns.map((t) => (t.id === id && t.kind === 'proposal' ? { ...t, ...patch } : t));
		};
		set({ state: 'running' });
		const { method, path, query, body } = turn.proposal;
		try {
			const res = await this.#fetch(RUN_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ method, path, query, body }),
			});
			const answer = (await res.json().catch(() => null)) as { ok?: boolean; status?: number; message?: string } | null;
			if (answer?.ok) set({ state: 'done', outcome: `Done, status ${answer.status}.` });
			else set({ state: 'failed', outcome: answer?.message || 'Could not run the request. Try again.' });
		} catch {
			set({
				state: 'failed',
				outcome: this.#online() ? 'Check whether your change was saved, then try again.' : "You're offline. Run it again once you reconnect.",
			});
		}
	}
}
