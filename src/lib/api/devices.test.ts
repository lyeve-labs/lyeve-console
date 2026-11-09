import { describe, expect, it } from 'vitest';
import {
	deviceLabel,
	deviceName,
	looksLikeThisDevice,
	type Device,
} from './devices';

const CHROME_MAC =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SAFARI_IOS =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const EDGE_WIN =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';

function device(over: Partial<Device> = {}): Device {
	return {
		id: 'd1',
		user_id: 'u1',
		label: '',
		user_agent: CHROME_MAC,
		last_seen_at: '2026-09-22T10:00:00Z',
		created_at: '2026-09-01T10:00:00Z',
		...over,
	};
}

describe('naming a device from its user agent', () => {
	// Every browser claims to be every other one in this header, so the order
	// the checks run in is the whole of the answer.
	it('reads the browser that is actually there, not the ones it claims', () => {
		expect(deviceName(CHROME_MAC)).toBe('Chrome on macOS');
		expect(deviceName(EDGE_WIN)).toBe('Edge on Windows');
		expect(deviceName(SAFARI_IOS)).toBe('Safari on iOS');
	});

	// Two devices it cannot read must not collapse into one name, or the list
	// shows two rows that look like the same machine.
	it('shows a string it cannot read rather than calling it unknown', () => {
		expect(deviceName('curl/8.4.0')).toBe('curl/8.4.0');
		expect(deviceName('some-agent/1.0')).toBe('some-agent/1.0');
		expect(deviceName('')).toBe('Unrecognized device');
	});

	it('falls back to the label the person gave it', () => {
		expect(deviceLabel(device({ label: 'Work laptop' }))).toBe('Work laptop');
		expect(deviceLabel(device({ label: '   ' }))).toBe('Chrome on macOS');
	});
});

describe('marking the browser reading the page', () => {
	it('matches on the only thing the list and the request share', () => {
		expect(looksLikeThisDevice(device(), CHROME_MAC)).toBe(true);
		expect(looksLikeThisDevice(device(), EDGE_WIN)).toBe(false);
	});

	// A request with no user agent must not match every row at once.
	it('matches nothing when there is nothing to match on', () => {
		expect(looksLikeThisDevice(device(), null)).toBe(false);
		expect(looksLikeThisDevice(device(), '')).toBe(false);
		expect(looksLikeThisDevice(device({ user_agent: '' }), '')).toBe(false);
	});
});
