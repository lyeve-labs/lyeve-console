import { describe, expect, it } from 'vitest';
import {
	activeProvider,
	brokenCredentials,
	providerLabel,
	providerState,
	providerTone,
	publiclyReadable,
	targetLabel,
	testMessage,
	testPassed,
	type StorageProvider,
	PROVIDER_FIELDS,
	providerValues,
} from './storage';

function provider(over: Partial<StorageProvider> = {}): StorageProvider {
	return {
		id: 's1',
		tenant_id: 'default',
		provider_type: 's3',
		name: 'Primary',
		region: 'eu-west-1',
		bucket: 'media',
		use_ssl: true,
		path_style: false,
		cost_weight: 1,
		priority: 1,
		enabled: true,
		local_public_unsigned: false,
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

describe('which provider receives uploads', () => {
	// Lowest priority number wins among usable providers, which nobody should
	// have to work out from a column of integers.
	it('picks the lowest priority that can actually take a write', () => {
		const providers = [
			provider({ id: 'a', priority: 5 }),
			provider({ id: 'b', priority: 1 }),
		];
		expect(activeProvider(providers)?.id).toBe('b');
	});

	it('ranks a weighted provider by cost before priority, as the plugin does', () => {
		const providers = [
			provider({ id: 'first', priority: 1, cost_weight: 0.8 }),
			provider({ id: 'cheap', priority: 9, cost_weight: 0.2 }),
			provider({ id: 'unweighted', priority: 0, cost_weight: 0 }),
		];
		expect(activeProvider(providers)?.id).toBe('cheap');
		expect(activeProvider([provider({ id: 'a', priority: 4, cost_weight: 0 }), provider({ id: 'b', priority: 2, cost_weight: 0 })])?.id).toBe('b');
	});

	it('skips a provider whose credentials will not decrypt', () => {
		const providers = [
			provider({ id: 'broken', priority: 1, credentials_unavailable: true }),
			provider({ id: 'good', priority: 5 }),
		];
		expect(activeProvider(providers)?.id).toBe('good');
	});

	it('skips a disabled provider, and reports none when nothing can take a write', () => {
		expect(activeProvider([provider({ enabled: false })])).toBeNull();
		expect(activeProvider([])).toBeNull();
	});
});

describe('providers that look fine and are not', () => {
	// A row whose secrets will not decrypt fails every upload, and the failure
	// surfaces as a media error far from this page.
	it('finds the ones whose credentials will not decrypt', () => {
		const providers = [provider(), provider({ id: 'x', credentials_unavailable: true })];
		expect(brokenCredentials(providers).map((p) => p.id)).toEqual(['x']);
		expect(providerTone(provider({ credentials_unavailable: true }))).toBe('danger');
		expect(providerState(provider({ credentials_unavailable: true }))).toContain('cannot be decrypted');
	});

	// Deliberate with a CDN in front of the directory, a data leak otherwise.
	it('finds the ones serving unsigned URLs', () => {
		const open = provider({ provider_type: 'local', local_public_unsigned: true });
		expect(publiclyReadable([open])).toHaveLength(1);
		expect(providerTone(open)).toBe('warn');
		expect(providerState(open)).toContain('unsigned');
	});

	// Broken credentials outrank a warning: it cannot serve anything at all.
	it('lets unusable outrank unsigned', () => {
		const both = provider({ local_public_unsigned: true, credentials_unavailable: true });
		expect(providerTone(both)).toBe('danger');
	});
});

describe('the credentials test', () => {
	// The plugin answers 200 either way, with healthy and an error that is
	// empty on a pass.
	it('passes a provider the plugin reports healthy', () => {
		expect(testPassed({ provider_id: 's1', healthy: true, latency_ms: 12.5, error: '' })).toBe(true);
	});

	it('treats anything that is not an explicit healthy as a failure', () => {
		expect(testPassed({ healthy: false, latency_ms: 0, error: 'access denied' })).toBe(false);
		expect(testPassed({ error: '' })).toBe(false);
		expect(testPassed({})).toBe(false);
		expect(testPassed(null)).toBe(false);
	});

	it('relays the reason the plugin gives, and says when it gave none', () => {
		expect(testMessage({ healthy: false, error: 'access denied' })).toBe('access denied');
		expect(testMessage({ healthy: false, error: '' })).toBe('The connection test failed, and the provider gave no reason.');
		expect(testMessage({})).toBe('The connection test failed, and the provider gave no reason.');
	});
});

describe('presentation', () => {
	it('uses the vendor name, and prints an unknown type rather than hiding it', () => {
		expect(providerLabel('s3')).toBe('Amazon S3');
		expect(providerLabel('azure_blob')).toBe('Azure Blob Storage');
		expect(providerLabel('backblaze')).toBe('backblaze');
	});

	it('describes where a provider writes', () => {
		expect(targetLabel(provider())).toBe('media (eu-west-1)');
		expect(targetLabel(provider({ region: '' }))).toBe('media');
		expect(targetLabel(provider({ bucket: '', endpoint: 'http://minio:9000' }))).toBe('http://minio:9000');
		expect(targetLabel(provider({ bucket: '', endpoint: '' }))).toBe('Local directory');
	});
});

describe('providerValues', () => {
	it('carries every field of every provider type, so no bound box starts undefined', () => {
		const v = providerValues();
		for (const list of Object.values(PROVIDER_FIELDS)) for (const f of list) expect(v[f.key]).toBe('');
	});

	it('lays the seed over the blanks', () => {
		expect(providerValues({ bucket: 'b' }).bucket).toBe('b');
	});
});
