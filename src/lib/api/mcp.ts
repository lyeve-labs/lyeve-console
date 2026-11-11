/**
 * The MCP plugin's admin routes: the tenant switch and the agents that
 * connected.
 *
 * An agent connects by calling the MCP endpoint with an API key or a signed-in
 * account's token, and the plugin records it on its first call. Without the AI
 * license a tenant holds one connected agent, and the agents answer says how
 * many it may hold.
 */
import type { HttpClient } from '@lyeve-labs/client';

const SETTINGS_URL = '/api/admin/mcp/settings';
const AGENTS_URL = `${SETTINGS_URL}/agents`;

/** The endpoint on the content API, which reaches content operations only. */
export const CONTENT_ENDPOINT = '/api/v1/mcp';

/** The endpoint on the admin API, which reaches admin operations as well. */
export const ADMIN_ENDPOINT = '/api/admin/mcp';

/** The cap a new agent past the ceiling is refused under. */
export const AGENTS_CAP = 'mcp.agents';

export interface McpSettings {
	enabled: boolean;
}

/** One credential that called the MCP server in this tenant. */
export interface McpAgent {
	/** `api_key` or `session`. */
	kind: string;
	/** The API key's id, or the account's id for a signed-in token. */
	credential_id: string;
	/** The account behind the credential. */
	person_id: string;
	first_used_at: string;
	last_used_at: string;
}

export interface McpAgents {
	/** How many agents the tenant may hold, 0 meaning no limit. */
	limit: number;
	agents: McpAgent[];
}

export function getMcpSettings(client: HttpClient): Promise<McpSettings> {
	return client.get<McpSettings>(SETTINGS_URL);
}

export function putMcpSettings(client: HttpClient, enabled: boolean): Promise<McpSettings> {
	return client.put<McpSettings>(SETTINGS_URL, { enabled });
}

export async function listMcpAgents(client: HttpClient): Promise<McpAgents> {
	const res = await client.get<Partial<McpAgents> | null>(AGENTS_URL);
	const limit = typeof res?.limit === 'number' && Number.isFinite(res.limit) && res.limit > 0 ? res.limit : 0;
	return { limit, agents: Array.isArray(res?.agents) ? res.agents : [] };
}

export async function disconnectMcpAgent(client: HttpClient, kind: string, credential: string): Promise<void> {
	await client.delete(`${AGENTS_URL}/${encodeURIComponent(kind)}/${encodeURIComponent(credential)}`);
}

/** What a reader calls the credential an agent connected with. */
export function agentKindLabel(kind: string): string {
	if (kind === 'api_key') return 'API key';
	if (kind === 'session') return 'Signed-in account';
	return kind;
}
