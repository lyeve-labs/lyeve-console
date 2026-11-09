import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROLES, ROLE_OPTIONS, roleTone, rolesInWords } from './roles';

const read = (rel: string) =>
	readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the role list', () => {
	it('offers the four roles this engine issues, least privileged first', () => {
		expect(ROLES).toEqual(['viewer', 'editor', 'admin', 'super_admin']);
	});

	// Without viewer, a read-only key could not be created from the admin.
	it('offers viewer, which is what a read-only credential is', () => {
		expect(ROLE_OPTIONS.map((o) => o.value)).toContain('viewer');
	});

	it('submits the role name the engine stores', () => {
		expect(ROLE_OPTIONS).toEqual(ROLES.map((role) => ({ value: role, label: role })));
	});
});

describe('roleTone', () => {
	it('rises with privilege', () => {
		expect(ROLES.map(roleTone)).toEqual(['neutral', 'brand', 'warn', 'danger']);
	});

	// An unknown role is neutral on every page, so one badge means one thing.
	it('leaves a role it does not know undecorated', () => {
		expect(roleTone('reviewer')).toBe('neutral');
		expect(roleTone('')).toBe('neutral');
	});
});

// A page that declares its own ROLE_OPTIONS can disagree with the others on
// order and on membership. Nothing but this assertion stops a second copy.
describe('the pages that pick roles', () => {
	const pages = [
		'../routes/(admin)/admin/users/+page.svelte',
		'../routes/(admin)/admin/api-keys/+page.svelte',
	];

	it('take the list from here rather than declaring one', () => {
		for (const page of pages) {
			const src = read(page);
			expect(src, page).toContain("from '$lib/roles'");
			expect(src, page).not.toMatch(/const ROLE_OPTIONS\s*=/);
		}
	});
});

describe('rolesInWords', () => {
	it('names the roles a check admits, least privileged first', () => {
		expect(rolesInWords(['super_admin', 'admin'])).toBe('an admin or a super admin');
		expect(rolesInWords(['super_admin', 'editor', 'admin'])).toBe('an editor, an admin or a super admin');
		expect(rolesInWords(['super_admin'])).toBe('a super admin');
	});
});
