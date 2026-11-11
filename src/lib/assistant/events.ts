/**
 * The assistant's event stream, read into typed events.
 *
 * The AI plugin answers a prompt with server-sent events: message, plan,
 * step, proposal, usage, done and error. The console's own route passes the
 * stream through unchanged, and the panel reads it here. Every text in it is
 * shown as plain text, never as Markdown or HTML, so nothing in a reply can
 * load an image or open a link on its own.
 */

export type PlanStatus = 'now' | 'next' | 'done';

export interface PlanEntry {
	status: PlanStatus;
	title: string;
	detail?: string;
}

export interface Step {
	id: string;
	title: string;
	operation_id?: string;
	effect?: string;
	status: 'running' | 'done' | 'failed';
}

/** A call the assistant may not make itself, waiting for the person. */
export interface ApiProposal {
	id: string;
	kind: 'api';
	operation_id: string;
	method: string;
	path: string;
	query?: Record<string, unknown>;
	body?: unknown;
	effect: string;
}

/** Values the assistant suggests for the form the person has open. */
export interface FormProposal {
	id: string;
	kind: 'form';
	values: { name: string; value: unknown; reason?: string }[];
}

export type Proposal = ApiProposal | FormProposal;

export interface Usage {
	model: string;
	tokens_in: number;
	tokens_out: number;
	cost: string;
}

export type AssistantEvent =
	| { type: 'message'; text: string }
	| { type: 'plan'; entries: PlanEntry[] }
	| { type: 'step'; step: Step }
	| { type: 'proposal'; proposal: Proposal }
	| { type: 'usage'; usage: Usage }
	| { type: 'done'; conversationId: string }
	| { type: 'error'; message: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** One event's data, or null when it is not one the panel shows. */
export function readEvent(name: string, data: unknown): AssistantEvent | null {
	if (!isObject(data)) return null;
	switch (name) {
		case 'message':
			return typeof data.text === 'string' ? { type: 'message', text: data.text } : null;
		case 'plan': {
			if (!Array.isArray(data.entries)) return null;
			const entries = data.entries.filter(isObject).map((e) => ({
				status: (['now', 'next', 'done'].includes(str(e.status)) ? e.status : 'next') as PlanStatus,
				title: str(e.title),
				...(typeof e.detail === 'string' && e.detail ? { detail: e.detail } : {}),
			}));
			return { type: 'plan', entries: entries.filter((e) => e.title !== '') };
		}
		case 'step': {
			const status = str(data.status);
			if (!data.id || !['running', 'done', 'failed'].includes(status)) return null;
			return {
				type: 'step',
				step: {
					id: str(data.id),
					title: str(data.title),
					status: status as Step['status'],
					...(data.operation_id ? { operation_id: str(data.operation_id) } : {}),
					...(data.effect ? { effect: str(data.effect) } : {}),
				},
			};
		}
		case 'proposal':
			if (data.kind === 'api' && typeof data.method === 'string' && typeof data.path === 'string') {
				return {
					type: 'proposal',
					proposal: {
						id: str(data.id),
						kind: 'api',
						operation_id: str(data.operation_id),
						method: data.method.toUpperCase(),
						path: data.path,
						...(isObject(data.query) ? { query: data.query } : {}),
						...(data.body !== undefined ? { body: data.body } : {}),
						effect: str(data.effect) || 'write',
					},
				};
			}
			if (data.kind === 'form' && Array.isArray(data.values)) {
				const values = data.values
					.filter(isObject)
					.filter((v) => typeof v.name === 'string' && v.name !== '')
					.map((v) => ({ name: str(v.name), value: v.value, ...(typeof v.reason === 'string' && v.reason ? { reason: v.reason } : {}) }));
				return { type: 'proposal', proposal: { id: str(data.id), kind: 'form', values } };
			}
			return null;
		case 'usage':
			return {
				type: 'usage',
				usage: {
					model: str(data.model),
					tokens_in: Number(data.tokens_in) || 0,
					tokens_out: Number(data.tokens_out) || 0,
					cost: str(data.cost),
				},
			};
		case 'done':
			return { type: 'done', conversationId: str(data.conversation_id) };
		case 'error':
			return { type: 'error', message: str(data.message) };
		default:
			return null;
	}
}

/**
 * Reads server-sent events out of chunks that may split an event anywhere.
 * An event ends at a blank line, and its data may span several data lines.
 */
export class EventReader {
	#buffer = '';

	push(chunk: string): AssistantEvent[] {
		this.#buffer += chunk.replace(/\r\n?/g, '\n');
		const out: AssistantEvent[] = [];
		let end: number;
		while ((end = this.#buffer.indexOf('\n\n')) !== -1) {
			const block = this.#buffer.slice(0, end);
			this.#buffer = this.#buffer.slice(end + 2);
			let name = 'message';
			const data: string[] = [];
			for (const line of block.split('\n')) {
				if (line.startsWith('event:')) name = line.slice(6).trim();
				else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
			}
			if (data.length === 0) continue;
			try {
				const event = readEvent(name, JSON.parse(data.join('\n')));
				if (event) out.push(event);
			} catch {
				// A block that is not JSON is not an event the plugin sends.
			}
		}
		return out;
	}
}
