/**
 * The storage plugin's admin routes.
 *
 * A provider is one place objects can be written: S3, GCS, Azure, MinIO or a
 * local directory. More than one can be configured, and priority decides which
 * receives a new upload.
 *
 * Two settings on a provider are dangerous in a way the row has to show.
 * Credentials that no longer decrypt leave a provider that looks configured
 * and fails every write. The engine marks those rows rather than hiding them.
 * And a local provider set to hand out unsigned URLs is serving every object
 * to anyone holding the key, with no expiry, which is a deliberate choice for
 * a CDN in front of the directory and a data leak anywhere else.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import type { HttpClient } from '@lyeve-labs/client';
import { checked } from '$lib/checkbox';
import { inSentence } from './gate';
import type { ListEnvelope } from './list';

const PROVIDERS_URL = '/api/admin/storage/providers';

export const PROVIDER_TYPES = ['s3', 'gcs', 'azure_blob', 'minio', 'local'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const PROVIDER_LABELS: Readonly<Record<string, string>> = {
	s3: 'Amazon S3',
	gcs: 'Google Cloud Storage',
	azure_blob: 'Azure Blob Storage',
	minio: 'MinIO',
	local: 'Local directory',
};

export interface StorageProvider {
	id: string;
	tenant_id: string;
	provider_type: string;
	name: string;
	region?: string;
	bucket?: string;
	endpoint?: string;
	cdn_base_url?: string;
	use_ssl: boolean;
	path_style: boolean;
	cost_weight: number;
	priority: number;
	enabled: boolean;
	/** A local provider handing out unsigned, never-expiring URLs. */
	local_public_unsigned: boolean;
	/** The engine sets this when the stored secrets will not decrypt. */
	credentials_unavailable?: boolean;
	created_at: string;
	updated_at: string;
}

/** What the storage plugin answers for a ping: whether the provider answered, and why not. */
export interface TestResult {
	provider_id?: string;
	provider_type?: string;
	provider_name?: string;
	healthy?: boolean;
	latency_ms?: number;
	/** Empty when the provider answered. */
	error?: string;
}

export async function listProviders(client: HttpClient): Promise<ListEnvelope<StorageProvider>> {
	return client.get<ListEnvelope<StorageProvider>>(PROVIDERS_URL);
}

export async function testProvider(client: HttpClient, id: string): Promise<TestResult> {
	return client.post<TestResult>(`${PROVIDERS_URL}/${encodeURIComponent(id)}/test`, {});
}

export async function deleteProvider(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${PROVIDERS_URL}/${encodeURIComponent(id)}`);
}

export function providerLabel(type: string): string {
	return PROVIDER_LABELS[type] ?? type;
}

/**
 * Whether the test route reported a healthy provider.
 *
 * The route answers 200 whether or not the provider answered the ping, so
 * the status says nothing. Only an explicit healthy is a pass.
 */
export function testPassed(result: TestResult | null | undefined): boolean {
	return result?.healthy === true;
}

/** Why a provider failed its test. The plugin sends an empty error on a pass. */
export function testMessage(result: TestResult | null | undefined): string {
	return result?.error?.trim() || 'The connection test failed, and the provider gave no reason.';
}

/**
 * The provider a new upload goes to.
 *
 * The plugin picks by cost before priority: among enabled providers, the
 * lowest cost weight above zero wins, and only when none carries a weight
 * does the lowest priority number win. The list says which one is actually
 * receiving writes rather than leaving somebody to work it out from a column
 * of integers.
 */
export function activeProvider(
	providers: readonly StorageProvider[]
): StorageProvider | null {
	const usable = providers.filter((p) => p.enabled && !p.credentials_unavailable);
	if (usable.length === 0) return null;
	const weighted = usable.filter((p) => p.cost_weight > 0);
	if (weighted.length > 0) {
		return weighted.reduce((best, p) =>
			p.cost_weight < best.cost_weight || (p.cost_weight === best.cost_weight && p.priority < best.priority) ? p : best,
		);
	}
	return usable.reduce((best, p) => (p.priority < best.priority ? p : best));
}

/**
 * Providers configured but unusable.
 *
 * A row whose secrets will not decrypt looks configured and fails every write.
 * Nothing else reports it, because a failed upload surfaces as a media error
 * far from this page.
 */
export function brokenCredentials(
	providers: readonly StorageProvider[]
): StorageProvider[] {
	return providers.filter((p) => p.credentials_unavailable);
}

/**
 * Providers serving objects to anyone holding the key.
 *
 * Deliberate with a CDN in front of the directory and a data leak anywhere
 * else, so it is named on the row rather than hidden in an edit form.
 */
export function publiclyReadable(
	providers: readonly StorageProvider[]
): StorageProvider[] {
	return providers.filter((p) => p.local_public_unsigned);
}

export function providerTone(
	p: StorageProvider
): StatusTone {
	if (p.credentials_unavailable) return 'danger';
	if (!p.enabled) return 'neutral';
	if (p.local_public_unsigned) return 'warn';
	return 'success';
}

export function providerState(p: StorageProvider): string {
	if (p.credentials_unavailable) return 'Credentials cannot be decrypted';
	if (!p.enabled) return 'Disabled';
	if (p.local_public_unsigned) return 'Serving unsigned URLs';
	return 'Ready';
}

/** Where a provider writes, as a reader would describe it. */
export function targetLabel(p: StorageProvider): string {
	if (p.bucket) return p.region ? `${p.bucket} (${p.region})` : p.bucket;
	if (p.endpoint) return p.endpoint;
	return 'Local directory';
}

/** The body POST and PUT on a provider take. An empty key or secret on an update keeps the stored one. */
export interface ProviderBody {
	provider_type: ProviderType;
	name: string;
	region?: string;
	bucket?: string;
	endpoint?: string;
	access_key?: string;
	secret_key?: string;
	cdn_base_url?: string;
	use_ssl: boolean;
	path_style: boolean;
	priority: number;
	/** The plugin replaces the row on a save, so an edit sends back the weight it read. */
	cost_weight?: number;
	enabled: boolean;
	local_public_unsigned: boolean;
}

export async function createProvider(client: HttpClient, body: ProviderBody): Promise<StorageProvider> {
	return client.post<StorageProvider>(PROVIDERS_URL, body);
}

export async function updateProvider(client: HttpClient, id: string, body: ProviderBody): Promise<StorageProvider> {
	return client.put<StorageProvider>(`${PROVIDERS_URL}/${encodeURIComponent(id)}`, body);
}

/** One field a provider type asks for, with the words its form shows. */
export interface ProviderField {
	key: 'region' | 'bucket' | 'endpoint' | 'access_key' | 'secret_key' | 'cdn_base_url';
	label: string;
	hint: string;
	required: boolean;
	secret?: boolean;
	multiline?: boolean;
	placeholder?: string;
}

/**
 * What each provider type asks for. It mirrors what the plugin refuses to
 * create without, so the form never offers a save the engine will reject for
 * a missing field.
 */
export const PROVIDER_FIELDS: Readonly<Record<ProviderType, readonly ProviderField[]>> = {
	s3: [
		{ key: 'bucket', label: 'Bucket', hint: 'The bucket objects are written to.', required: true, placeholder: 'my-uploads' },
		{ key: 'region', label: 'Region', hint: 'The bucket region, such as us-east-1. Cloudflare R2 takes auto.', required: true, placeholder: 'us-east-1' },
		{ key: 'endpoint', label: 'Endpoint', hint: 'Leave empty for Amazon S3. Set it for an S3-compatible service: Cloudflare R2, Wasabi, Backblaze B2 or DigitalOcean Spaces.', required: false, placeholder: 'https://<account>.r2.cloudflarestorage.com' },
		{ key: 'access_key', label: 'Access key ID', hint: 'An IAM key allowed to put, get and delete in this bucket only.', required: true },
		{ key: 'secret_key', label: 'Secret access key', hint: 'Stored encrypted and never shown again.', required: true, secret: true },
		{ key: 'cdn_base_url', label: 'CDN base URL', hint: 'Optional. A CDN in front of the bucket. Download links use it.', required: false, placeholder: 'https://cdn.example.com' },
	],
	minio: [
		{ key: 'endpoint', label: 'Endpoint', hint: 'The MinIO server, reachable from the engine on a public address.', required: true, placeholder: 'https://minio.example.com' },
		{ key: 'bucket', label: 'Bucket', hint: 'The bucket objects are written to.', required: true },
		{ key: 'region', label: 'Region', hint: 'The region the server is configured with, us-east-1 unless it says otherwise.', required: true, placeholder: 'us-east-1' },
		{ key: 'access_key', label: 'Access key', hint: 'A MinIO user or service account key.', required: true },
		{ key: 'secret_key', label: 'Secret key', hint: 'Stored encrypted and never shown again.', required: true, secret: true },
		{ key: 'cdn_base_url', label: 'CDN base URL', hint: 'Optional. A CDN in front of the bucket.', required: false },
	],
	gcs: [
		{ key: 'bucket', label: 'Bucket', hint: 'The Cloud Storage bucket objects are written to.', required: true },
		{ key: 'secret_key', label: 'Service account key', hint: 'The service account JSON, with Storage Object Admin on this bucket. Stored encrypted.', required: true, secret: true, multiline: true },
		{ key: 'cdn_base_url', label: 'CDN base URL', hint: 'Optional. A CDN in front of the bucket.', required: false },
	],
	azure_blob: [
		{ key: 'bucket', label: 'Container', hint: 'The blob container objects are written to.', required: true },
		{ key: 'access_key', label: 'Storage account name', hint: 'The account the container belongs to.', required: true },
		{ key: 'secret_key', label: 'Account key', hint: 'One of the account access keys. Stored encrypted.', required: true, secret: true },
		// The plugin stores what a save sends, so an endpoint missing from the
		// form would be erased by every save.
		{ key: 'endpoint', label: 'Endpoint', hint: "Optional. For a custom domain on a public address. Empty uses the account's default address.", required: false, placeholder: 'https://<account>.blob.core.windows.net' },
		{ key: 'cdn_base_url', label: 'CDN base URL', hint: 'Optional. A CDN in front of the container.', required: false },
	],
	local: [
		{ key: 'endpoint', label: 'Directory', hint: 'A directory on the engine host, absolute or relative to where it runs. Replicas need it on shared storage.', required: true, placeholder: '/var/lib/lyeve/uploads' },
		{ key: 'cdn_base_url', label: 'Public base URL', hint: 'Optional. Where a CDN or web server serves this directory.', required: false, placeholder: 'https://files.example.com' },
	],
};

/**
 * The provider body a form describes, or the reason it cannot be sent. A
 * secret left empty on an update keeps the stored one, so it is required on
 * create only.
 */
export function providerBodyFrom(form: FormData, creating: boolean): { body: ProviderBody } | { error: string } {
	const type = String(form.get('provider_type') ?? '') as ProviderType;
	if (!PROVIDER_TYPES.includes(type)) return { error: 'Choose a provider type.' };
	const name = String(form.get('name') ?? '').trim();
	if (!name) return { error: 'Give the provider a name.' };
	const body: ProviderBody = {
		provider_type: type,
		name,
		use_ssl: checked(form, 'use_ssl'),
		path_style: checked(form, 'path_style'),
		enabled: checked(form, 'enabled'),
		local_public_unsigned: type === 'local' && checked(form, 'local_public_unsigned'),
		priority: Math.max(0, Math.trunc(Number(form.get('priority') ?? 0)) || 0),
	};
	const cost = Number(form.get('cost_weight'));
	if (form.has('cost_weight') && Number.isFinite(cost) && cost >= 0) body.cost_weight = cost;
	for (const f of PROVIDER_FIELDS[type]) {
		const v = String(form.get(f.key) ?? '').trim();
		if (!v) {
			if (f.required && (creating || !isCredential(f))) return { error: `Enter ${inSentence(f.label)}.` };
			continue;
		}
		body[f.key] = v;
	}
	return { body };
}

/** A credential the list never returns, so an edit form cannot show it and an empty one keeps the stored value. */
export function isCredential(f: ProviderField): boolean {
	return f.secret === true || f.key === 'access_key';
}

/**
 * Every field any provider type shows, empty, with seed laid over it. The
 * drawer binds each field to its key, and a bound key that is missing is
 * undefined, which the kit's inputs refuse.
 */
export function providerValues(seed: Record<string, string> = {}): Record<string, string> {
	const blank: Record<string, string> = {};
	for (const list of Object.values(PROVIDER_FIELDS)) for (const f of list) blank[f.key] = '';
	return { ...blank, ...seed };
}
