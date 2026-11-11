import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { asked } from '$lib/server/asked';
import { listPeople } from '$lib/server/people';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { type Gate, section, type Section } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import {
	ADMIN_ENDPOINT,
	allowMcpAgent,
	CONTENT_ENDPOINT,
	disconnectMcpAgent,
	getMcpSettings,
	listMcpAgents,
	putMcpSettings,
	type McpAgents,
	type McpSettings,
} from '$lib/api/mcp';

const ABSENT: Gate = { state: 'absent' };

/** What a refused write says. The plugin's routes admit an admin and a super admin. */
function writeError(err: unknown, fallback: string): string {
	if (err instanceof ApiError && err.status === 403) return 'Only an admin or a super admin can change this.';
	return actionError(err, fallback);
}

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	// The addresses an agent calls. The proxy in front of the console serves
	// both listeners from the address the reader opened the console on.
	const endpoints = {
		content: new URL(CONTENT_ENDPOINT, event.url.origin).href,
		admin: new URL(ADMIN_ENDPOINT, event.url.origin).href,
	};
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.mcp)) {
		return {
			endpoints,
			settings: { ok: false, gate: ABSENT } as Section<McpSettings>,
			agents: { ok: false, gate: ABSENT } as Section<McpAgents>,
			people: {} as Record<string, string>,
		};
	}
	const client = authedClient(event);
	const [settings, agents, people] = await Promise.all([
		section(getMcpSettings(client), couldNotLoad('the MCP server setting')),
		section(listMcpAgents(client), couldNotLoad('the connected agents')),
		// Emails beside the account ids are a courtesy. An id stands in for
		// any account the read does not return.
		listPeople(client).catch(() => []),
	]);
	return {
		endpoints,
		settings,
		agents,
		people: Object.fromEntries(people.map((p) => [p.id, p.email])) as Record<string, string>,
	};
};

export const actions: Actions = {
	toggle: async (event) => {
		const form = await event.request.formData();
		const raw = String(form.get('enabled') ?? '');
		if (raw !== 'true' && raw !== 'false') {
			return fail(400, { action: 'toggle', error: 'This form is missing its setting. Reload the page and try again.' });
		}
		try {
			const settings = await putMcpSettings(authedClient(event), { enabled: raw === 'true' });
			return { action: 'toggle', settings };
		} catch (err) {
			return fail(400, { action: 'toggle', error: writeError(err, 'Could not save the setting. Try again.') });
		}
	},

	keepOut: async (event) => {
		const form = await event.request.formData();
		const raw = String(form.get('keep_disconnected_out') ?? '');
		if (raw !== 'true' && raw !== 'false') {
			return fail(400, { action: 'keepOut', error: 'This form is missing its setting. Reload the page and try again.' });
		}
		try {
			const settings = await putMcpSettings(authedClient(event), { keep_disconnected_out: raw === 'true' });
			return { action: 'keepOut', settings };
		} catch (err) {
			return fail(400, { action: 'keepOut', error: writeError(err, 'Could not save the setting. Try again.') });
		}
	},

	roles: async (event) => {
		const form = await event.request.formData();
		// No box ticked posts no role, which leaves new agents to a super admin.
		const roles = form.getAll('agent_roles').map(String);
		try {
			const settings = await putMcpSettings(authedClient(event), { agent_roles: roles });
			return { action: 'roles', settings };
		} catch (err) {
			return fail(400, { action: 'roles', error: writeError(err, 'Could not save the roles. Try again.') });
		}
	},

	allow: async (event) => {
		const form = await event.request.formData();
		const kind = String(form.get('kind') ?? '');
		const credential = String(form.get('credential') ?? '');
		if (!kind || !credential) {
			return fail(400, { action: 'allow', error: 'This form is missing its agent. Reload the page and try again.' });
		}
		try {
			await allowMcpAgent(authedClient(event), kind, credential);
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) {
				return fail(404, { action: 'allow', error: 'This agent is no longer disconnected.' });
			}
			return fail(400, { action: 'allow', error: writeError(err, 'Could not allow the agent. Try again.') });
		}
		return { action: 'allow', allowed: credential };
	},

	disconnect: asked(
		{
			question: 'Disconnect this agent?',
			detail: 'Its key or account still works outside the MCP server.',
			label: 'Disconnect',
		},
		async (event) => {
			const form = await event.request.formData();
			const kind = String(form.get('kind') ?? '');
			const credential = String(form.get('credential') ?? '');
			if (!kind || !credential) {
				return fail(400, { action: 'disconnect', error: 'This form is missing its agent. Reload the page and try again.' });
			}
			try {
				await disconnectMcpAgent(authedClient(event), kind, credential);
			} catch (err) {
				if (err instanceof ApiError && err.status === 404) {
					return fail(404, { action: 'disconnect', error: 'This agent is no longer connected.' });
				}
				return fail(400, { action: 'disconnect', error: writeError(err, 'Could not disconnect the agent. Try again.') });
			}
			return { action: 'disconnect', disconnected: credential };
		},
	),
};
