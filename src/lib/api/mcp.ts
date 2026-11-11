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
	/**
	 * The roles whose credential may connect a new agent without the AI
	 * license. Absent from a plugin too old to have the setting.
	 */
	agentRoles?: string[];
	/**
	 * Whether a disconnected agent stays out until it is allowed again.
	 * Absent from a plugin too old to have the setting.
	 */
	keepDisconnectedOut?: boolean;
}

/** A save of the settings. Each field left out keeps its stored value. */
export interface McpSettingsPatch {
	enabled?: boolean;
	agent_roles?: string[];
	keep_disconnected_out?: boolean;
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
	/**
	 * When an administrator disconnected the agent and kept it out, null for
	 * a connected agent, and absent from a plugin too old to keep one out.
	 */
	disconnected_at?: string | null;
}

export interface McpAgents {
	/** How many agents the tenant may hold, 0 meaning no limit. */
	limit: number;
	/** The link that lifts the limit, empty when the answer carries none. */
	upgradeUrl: string;
	agents: McpAgent[];
}

type SettingsAnswer = { enabled?: unknown; agent_roles?: unknown; keep_disconnected_out?: unknown } | null;

/** The settings answer, with each newer field only when the plugin sends it. */
function readSettings(res: SettingsAnswer): McpSettings {
	const out: McpSettings = { enabled: res?.enabled === true };
	if (Array.isArray(res?.agent_roles)) out.agentRoles = res.agent_roles.filter((r): r is string => typeof r === 'string');
	if (typeof res?.keep_disconnected_out === 'boolean') out.keepDisconnectedOut = res.keep_disconnected_out;
	return out;
}

export async function getMcpSettings(client: HttpClient): Promise<McpSettings> {
	return readSettings(await client.get<SettingsAnswer>(SETTINGS_URL));
}

export async function putMcpSettings(client: HttpClient, patch: McpSettingsPatch): Promise<McpSettings> {
	return readSettings(await client.put<SettingsAnswer>(SETTINGS_URL, patch));
}

export async function listMcpAgents(client: HttpClient): Promise<McpAgents> {
	const res = await client.get<{ limit?: unknown; upgrade_url?: unknown; agents?: unknown } | null>(AGENTS_URL);
	const limit = typeof res?.limit === 'number' && Number.isFinite(res.limit) && res.limit > 0 ? res.limit : 0;
	const upgradeUrl = limit > 0 && typeof res?.upgrade_url === 'string' ? res.upgrade_url : '';
	return { limit, upgradeUrl, agents: Array.isArray(res?.agents) ? (res.agents as McpAgent[]) : [] };
}

export async function disconnectMcpAgent(client: HttpClient, kind: string, credential: string): Promise<void> {
	await client.delete(`${AGENTS_URL}/${encodeURIComponent(kind)}/${encodeURIComponent(credential)}`);
}

/** Lets a disconnected agent connect again. Its next call connects it as a new agent. */
export async function allowMcpAgent(client: HttpClient, kind: string, credential: string): Promise<void> {
	await client.post(`${AGENTS_URL}/${encodeURIComponent(kind)}/${encodeURIComponent(credential)}/allow`, {});
}

/** What a reader calls the credential an agent connected with. */
export function agentKindLabel(kind: string): string {
	if (kind === 'api_key') return 'API key';
	if (kind === 'session') return 'Signed-in account';
	return kind;
}
