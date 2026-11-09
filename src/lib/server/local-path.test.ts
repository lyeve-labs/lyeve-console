import { describe, it, expect } from 'vitest';
import { adminReturnPath, localPath } from './local-path';

describe('localPath', () => {
	it('keeps a path on this engine, query and all', () => {
		expect(localPath('/admin/media?limit=25&offset=50', '/admin')).toBe(
			'/admin/media?limit=25&offset=50'
		);
	});

	/*
	 * The value comes off a form, so it is whatever was posted. redirect()
	 * follows every one of these off the instance, which turns a control in the
	 * admin header into an open redirect.
	 */
	it('refuses a target that leaves the engine', () => {
		expect(localPath('https://evil.example/admin', '/admin')).toBe('/admin');
		expect(localPath('//evil.example/admin', '/admin')).toBe('/admin');
		expect(localPath('/\\evil.example/admin', '/admin')).toBe('/admin');
		expect(localPath('admin/media', '/admin')).toBe('/admin');
	});

	it('refuses a target that would split the Location header', () => {
		expect(localPath('/admin\r\nSet-Cookie: a=b', '/admin')).toBe('/admin');
		expect(localPath('/admin/media page', '/admin')).toBe('/admin');
	});

	it('falls back when the form sent nothing usable', () => {
		expect(localPath(null, '/admin')).toBe('/admin');
		expect(localPath(undefined, '/admin')).toBe('/admin');
		expect(localPath('', '/admin')).toBe('/admin');
		expect(localPath('   ', '/admin')).toBe('/admin');
		expect(localPath(new File([], 'x'), '/admin')).toBe('/admin');
	});
});

describe('adminReturnPath', () => {
	it('keeps an admin page, query and all', () => {
		expect(adminReturnPath('/admin/device?code=WDJB-MJHT', '/admin/schema')).toBe('/admin/device?code=WDJB-MJHT');
		expect(adminReturnPath('/admin', '/admin/schema')).toBe('/admin');
	});

	it('refuses anything that is not an admin page', () => {
		for (const raw of ['/login', '/adminx', '/api/admin/users', '//evil.example/admin', 'https://evil.example/admin', null]) {
			expect(adminReturnPath(raw, '/admin/schema'), String(raw)).toBe('/admin/schema');
		}
	});
});
