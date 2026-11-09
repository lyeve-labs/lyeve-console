import type { PageServerLoad } from './$types';
import { authedClient } from '$lib/server/authz';
import { aiGate } from '$lib/server/ai-load';
import { GATE_OK, section } from '$lib/api/gate';
import { listPrompts } from '$lib/api/ai';

export const load: PageServerLoad = async (event) => {
	const client = authedClient(event);
	const prompts = await section(listPrompts(client), (err) => aiGate(err, event, 'prompts'));
	return { gate: prompts.ok ? GATE_OK : prompts.gate, prompts: prompts.ok ? prompts.value : [] };
};
