import type { PageServerLoad } from './$types';
import { authedClient } from '#lib/server/authz.ts';
import { aiGate } from '#lib/server/ai-load.ts';
import { GATE_OK, section } from '#lib/api/gate.ts';
import { listPrompts } from '#lib/api/ai.ts';

export const load: PageServerLoad = async (event) => {
	const client = authedClient(event);
	const prompts = await section(listPrompts(client), (err) => aiGate(err, event, 'prompts'));
	return { gate: prompts.ok ? GATE_OK : prompts.gate, prompts: prompts.ok ? prompts.value : [] };
};
