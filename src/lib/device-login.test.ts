import { describe, expect, it } from 'vitest';
import {
	canApprove,
	expiresIn,
	isStepUpRefusal,
	loginRedirect,
	normalizeUserCode,
	outcomeForRefusal,
	rolesLabel,
	sessionLength,
	tenantLabel,
} from './device-login';

describe('normalizeUserCode', () => {
	it('reads a code however it was typed', () => {
		expect(normalizeUserCode('WDJB-MJHT')).toBe('WDJB-MJHT');
		expect(normalizeUserCode('wdjbmjht')).toBe('WDJB-MJHT');
		expect(normalizeUserCode(' wdjb mjht ')).toBe('WDJB-MJHT');
	});

	it('refuses what cannot be a code', () => {
		for (const raw of ['', null, undefined, 'WDJB-MJH', 'WDJB-MJHTX', 'WDJB-MJH0', 'WDJB-MJHO', 'WDJB-MJH1', 'WDJB-MJHI', 'WDJB-MJHL', 'WDJB/MJHT']) {
			expect(normalizeUserCode(raw), String(raw)).toBeNull();
		}
	});
});

describe('outcomeForRefusal', () => {
	it('tells the three 404s apart by the engine message', () => {
		expect(outcomeForRefusal(404, 'No sign-in is waiting for this code.')).toBe('unknown');
		expect(outcomeForRefusal(404, 'This code has expired. Start the sign-in again on the device.')).toBe('expired');
		expect(outcomeForRefusal(404, 'This sign-in was already approved or denied.')).toBe('decided');
	});

	it('reads a second decision, a refused session and an outage', () => {
		expect(outcomeForRefusal(409, 'This sign-in was already approved or denied.')).toBe('decided');
		expect(outcomeForRefusal(403, 'insufficient permissions')).toBe('forbidden');
		expect(outcomeForRefusal(401, 'authentication required')).toBe('forbidden');
		expect(outcomeForRefusal(503, 'Could not read the sign-in.')).toBe('error');
		expect(outcomeForRefusal(404, 'something new')).toBe('unknown');
	});
});

describe('canApprove', () => {
	it('lets an admin or a super admin approve and nobody else', () => {
		expect(canApprove(['admin'])).toBe(true);
		expect(canApprove(['editor', 'super_admin'])).toBe(true);
		expect(canApprove(['editor'])).toBe(false);
		expect(canApprove([])).toBe(false);
		expect(canApprove(undefined)).toBe(false);
	});
});

describe('expiresIn', () => {
	const now = new Date('2026-09-26T12:00:00Z');
	it('counts whole minutes down', () => {
		expect(expiresIn('2026-09-26T12:09:30Z', now)).toBe('in 9 minutes');
		expect(expiresIn('2026-09-26T12:01:10Z', now)).toBe('in 1 minute');
		expect(expiresIn('2026-09-26T12:00:30Z', now)).toBe('in under a minute');
	});
	it('says when it has passed', () => {
		expect(expiresIn('2026-09-26T11:59:00Z', now)).toBe('expired');
		expect(expiresIn('not a date', now)).toBe('');
	});
});

describe('tenantLabel', () => {
	it('names the tenant, or says there is none', () => {
		expect(tenantLabel('acme')).toBe('acme');
		expect(tenantLabel('')).toBe('No tenant (engine-wide account)');
		expect(tenantLabel(null)).toBe('No tenant (engine-wide account)');
	});
});

describe('loginRedirect', () => {
	it('carries the page and its code through sign-in', () => {
		expect(loginRedirect('/admin/device', '?code=WDJB-MJHT')).toBe('/login?next=%2Fadmin%2Fdevice%3Fcode%3DWDJB-MJHT');
	});
});

describe('isStepUpRefusal', () => {
	it('reads every refused confirmation and a locked account as the form', () => {
		expect(isStepUpRefusal(403)).toBe(true);
		expect(isStepUpRefusal(429)).toBe(true);
	});
	it('leaves every other refusal to the outcome', () => {
		expect(isStepUpRefusal(401)).toBe(false);
		expect(isStepUpRefusal(402)).toBe(false);
		expect(isStepUpRefusal(404)).toBe(false);
		expect(isStepUpRefusal(409)).toBe(false);
	});
});

describe('rolesLabel and sessionLength', () => {
	it('name what the session carries', () => {
		expect(rolesLabel(['super_admin'])).toBe('super admin');
		expect(rolesLabel(['admin', 'editor'])).toBe('admin, editor');
		expect(rolesLabel([])).toBe('none');
		expect(sessionLength(900)).toBe('15 minutes');
		expect(sessionLength(3600)).toBe('1 hour');
		expect(sessionLength(60)).toBe('1 minute');
		expect(sessionLength(0)).toBe('');
	});
});
