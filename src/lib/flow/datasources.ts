/**
 * The TLS modes each database driver accepts, the first one the default. The
 * engine hands the value to the driver as a string, so a boolean would reach
 * Postgres as `sslmode=true`, which it refuses, and MySQL as a tls name it
 * does not know.
 */

export type SqlKind = 'postgres' | 'mysql' | 'mssql';

export interface SslMode {
	value: string;
	label: string;
}

export const SSL_MODES: Record<SqlKind, SslMode[]> = {
	postgres: [
		{ value: 'require', label: 'Require TLS' },
		{ value: 'prefer', label: 'Prefer TLS' },
		{ value: 'disable', label: 'No TLS' },
	],
	mysql: [
		{ value: 'true', label: 'Require TLS' },
		{ value: 'skip-verify', label: 'TLS without verifying the certificate' },
		{ value: 'false', label: 'No TLS' },
	],
	mssql: [
		{ value: 'true', label: 'Require TLS' },
		{ value: 'false', label: 'No TLS' },
	],
};

export function isSqlKind(kind: string | null | undefined): kind is SqlKind {
	return kind === 'postgres' || kind === 'mysql' || kind === 'mssql';
}

/** The default mode for a kind, and the stored one when it is still a mode the kind accepts. */
export function sslModeFor(kind: SqlKind, stored: unknown): string {
	const modes = SSL_MODES[kind];
	const value = typeof stored === 'string' ? stored : '';
	return modes.some((m) => m.value === value) ? value : modes[0].value;
}

/**
 * The credential an http datasource sends. `none` is the absence of the
 * block on the wire. The other three each carry one secret the engine
 * encrypts and never returns.
 */
export type AuthType = 'none' | 'bearer' | 'basic' | 'oauth2_client_credentials';

export const AUTH_TYPES: { value: AuthType; label: string }[] = [
	{ value: 'none', label: 'None' },
	{ value: 'bearer', label: 'Bearer token' },
	{ value: 'basic', label: 'Basic' },
	{ value: 'oauth2_client_credentials', label: 'OAuth2 client credentials' },
];

export function isAuthType(v: unknown): v is AuthType {
	return AUTH_TYPES.some((t) => t.value === v);
}

/** The key of the secret each scheme carries. None for `none`. */
export const SECRET_KEY: Record<Exclude<AuthType, 'none'>, 'token' | 'password' | 'client_secret'> = {
	bearer: 'token',
	basic: 'password',
	oauth2_client_credentials: 'client_secret',
};

/** The non-secret half of the auth block, as the form edits it. */
export interface AuthFields {
	type: AuthType;
	user: string;
	token_url: string;
	client_id: string;
	/** Space separated in the form. A list on the wire. */
	scopes: string;
	audience: string;
}

export const EMPTY_AUTH: AuthFields = { type: 'none', user: '', token_url: '', client_id: '', scopes: '', audience: '' };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The stored auth block as form fields. An absent or unknown block reads as none. */
export function authFieldsOf(config: Record<string, unknown>): AuthFields {
	const raw = config.auth;
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_AUTH };
	const auth = raw as Record<string, unknown>;
	const type = isAuthType(auth.type) ? auth.type : 'none';
	const scopes = Array.isArray(auth.scopes) ? auth.scopes.map(String).join(' ') : str(auth.scopes);
	return {
		type,
		user: str(auth.user),
		token_url: str(auth.token_url),
		client_id: str(auth.client_id),
		scopes,
		audience: str(auth.audience),
	};
}

/**
 * Whether the secret field may stay blank: the datasource already holds a
 * secret for this very scheme, so the engine keeps it. A new datasource, a
 * datasource with no secret, or a scheme change all need one typed.
 */
export function secretKept(stored: { has_secret: boolean; type: AuthType } | null, type: AuthType): boolean {
	return type !== 'none' && stored !== null && stored.has_secret && stored.type === type;
}

export interface AuthBody {
	/** The block for `config.auth`, or undefined for none, so the wire omits it. */
	auth?: Record<string, unknown>;
	/** The secret entry, when one was typed. */
	secret?: Partial<Record<'token' | 'password' | 'client_secret', string>>;
}

/**
 * The auth block out of the datasource form, split into the clear half and
 * the secret, or the reason it cannot be sent. A blank secret is left out
 * rather than sent empty, which on an update means the stored one stays.
 */
export function authFromForm(data: FormData): AuthBody | string {
	const type = String(data.get('auth_type') ?? 'none').trim() || 'none';
	if (!isAuthType(type)) return 'Choose an authentication type.';
	if (type === 'none') return {};
	const field = (key: string) => String(data.get(key) ?? '').trim();
	const auth: Record<string, unknown> = { type };
	if (type === 'basic') {
		auth.user = field('auth_user');
		if (!auth.user) return 'Enter a user for basic authentication.';
	}
	if (type === 'oauth2_client_credentials') {
		auth.token_url = field('auth_token_url');
		auth.client_id = field('auth_client_id');
		if (!auth.token_url || !auth.client_id) return 'Enter a token URL and a client id for OAuth2.';
		const scopes = field('auth_scopes').split(/[\s,]+/).filter(Boolean);
		if (scopes.length > 0) auth.scopes = scopes;
		const audience = field('auth_audience');
		if (audience) auth.audience = audience;
	}
	const key = SECRET_KEY[type];
	const value = String(data.get(`auth_${key}`) ?? '');
	return { auth, secret: value ? { [key]: value } : undefined };
}
