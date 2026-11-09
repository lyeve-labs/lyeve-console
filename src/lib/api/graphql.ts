/**
 * The GraphQL plugin: the schema it generates from the content types, read
 * by introspection, and the persisted query allowlist it keeps per tenant.
 */
import type { HttpClient } from '@lyeve-labs/client';
import { couldNotLoad } from '../outage';

export const GRAPHQL_HTTP = '/api/v1/graphql';
export const GRAPHQL_WS = '/api/v1/graphql/ws';
const PERSISTED_URL = '/api/admin/graphql/persisted-queries';

export interface PersistedQuery {
	query_hash: string;
	query: string;
	operation_name: string;
	description: string;
	enabled: boolean;
	auto_registered?: boolean;
}

export interface RootField {
	name: string;
	description: string;
	args: string[];
}

/** The three root types, each empty when the schema defines none. */
export interface SchemaRoots {
	query: RootField[];
	mutation: RootField[];
	subscription: RootField[];
}

/** Asks for the root fields only, which is what the page lists. */
export const ROOTS_QUERY = `query Roots {
  __schema {
    queryType { fields { name description args { name } } }
    mutationType { fields { name description args { name } } }
    subscriptionType { fields { name description args { name } } }
  }
}`;

type IntrospectedType = { fields?: { name: string; description?: string | null; args?: { name: string }[] }[] } | null;

interface IntrospectionAnswer {
	data?: { __schema?: { queryType?: IntrospectedType; mutationType?: IntrospectedType; subscriptionType?: IntrospectedType } };
	errors?: { message: string }[];
}

function fieldsOf(t: IntrospectedType | undefined): RootField[] {
	return (t?.fields ?? [])
		.map((f) => ({ name: f.name, description: f.description ?? '', args: (f.args ?? []).map((a) => a.name) }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The schema's roots, or the reason there are none: GraphQL answers 200 and
 * puts a refusal in `errors`, so a refused introspection is not an empty
 * schema.
 */
export function readRoots(answer: IntrospectionAnswer): { roots: SchemaRoots | null; refused: string | null } {
	const schema = answer.data?.__schema;
	if (!schema) return { roots: null, refused: answer.errors?.[0]?.message ?? couldNotLoad('the GraphQL schema') };
	return {
		roots: { query: fieldsOf(schema.queryType), mutation: fieldsOf(schema.mutationType), subscription: fieldsOf(schema.subscriptionType) },
		refused: null,
	};
}

export async function introspect(client: HttpClient): Promise<{ roots: SchemaRoots | null; refused: string | null }> {
	return readRoots(await client.post<IntrospectionAnswer>(GRAPHQL_HTTP, { query: ROOTS_QUERY, operationName: 'Roots' }));
}

export async function listPersisted(
	client: HttpClient,
	limit: number,
	offset: number,
): Promise<{ data: PersistedQuery[]; total: number }> {
	const res = await client.get<{ data?: PersistedQuery[]; total?: number }>(`${PERSISTED_URL}?limit=${limit}&offset=${offset}`);
	return { data: res.data ?? [], total: res.total ?? 0 };
}

export async function registerPersisted(
	client: HttpClient,
	body: { query: string; operation_name: string; description: string },
): Promise<PersistedQuery> {
	return client.post<PersistedQuery>(PERSISTED_URL, body);
}

export async function deletePersisted(client: HttpClient, hash: string): Promise<void> {
	return client.delete<void>(`${PERSISTED_URL}/${encodeURIComponent(hash)}`);
}

export async function togglePersisted(client: HttpClient, hash: string): Promise<{ enabled: boolean }> {
	return client.patch<{ enabled: boolean }>(`${PERSISTED_URL}/${encodeURIComponent(hash)}/toggle`, {});
}
