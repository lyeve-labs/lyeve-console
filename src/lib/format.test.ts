import { describe, it, expect } from 'vitest';
import {
	LOG_LEVELS,
	NO_VALUE,
	formatBytes,
	formatCount,
	formatGoDuration,
	formatDate,
	formatDateTime,
	formatMillis,
	formatPercent,
	formatSignedBytes,
	plural,
	formatTime,
	hasTrace,
	logLevelLabel,
	logLevelTone,
	relativeTime,
	type ByteUnit,
} from './format';

describe('logLevelTone', () => {
	it('gives every level the engine emits a tone of its own', () => {
		const tones = LOG_LEVELS.map(logLevelTone);

		expect(tones).toEqual(['neutral', 'brand', 'warn', 'danger']);
		expect(new Set(tones).size).toBe(LOG_LEVELS.length);
	});

	it('folds case, so a streamed level keeps its severity', () => {
		expect(logLevelTone('error')).toBe('danger');
		expect(logLevelTone('Warn')).toBe('warn');
		expect(logLevelTone(' info ')).toBe('brand');
	});

	it('falls back to neutral for a level it does not know', () => {
		expect(logLevelTone('TRACE')).toBe('neutral');
		expect(logLevelTone('')).toBe('neutral');
		expect(logLevelTone(null)).toBe('neutral');
		expect(logLevelTone(undefined)).toBe('neutral');
	});
});

// The SSE tail sends slog's severity as an integer, so the level is read in
// either shape.
describe('logLevelLabel', () => {
	it('names slog\'s own severity integers', () => {
		expect(logLevelLabel(-4)).toBe('DEBUG');
		expect(logLevelLabel(0)).toBe('INFO');
		expect(logLevelLabel(4)).toBe('WARN');
		expect(logLevelLabel(8)).toBe('ERROR');
	});

	it('reads a level between two thresholds as the lower one', () => {
		expect(logLevelLabel(2)).toBe('INFO');
		expect(logLevelLabel(6)).toBe('WARN');
		expect(logLevelLabel(12)).toBe('ERROR');
	});

	it('folds a label sent as a string', () => {
		expect(logLevelLabel(' warn ')).toBe('WARN');
		expect(logLevelLabel('Error')).toBe('ERROR');
	});

	it('names nothing when the engine sent nothing', () => {
		expect(logLevelLabel(null)).toBe('');
		expect(logLevelLabel(undefined)).toBe('');
		expect(logLevelLabel(Number.NaN)).toBe('');
	});
});

describe('logLevelTone with the integer wire shape', () => {
	it('takes a tone off the integer rather than throwing on it', () => {
		expect(logLevelTone(-4)).toBe('neutral');
		expect(logLevelTone(0)).toBe('brand');
		expect(logLevelTone(4)).toBe('warn');
		expect(logLevelTone(8)).toBe('danger');
	});

	it('does not call a string method on a number', () => {
		expect(() => logLevelTone(0)).not.toThrow();
	});
});

// OpenTelemetry spells "no trace" as an all-zero id, which is present, is a
// string and is truthy, so a guard on the field alone would print
// trace=00000000000000000000000000000000 on every row.
describe('hasTrace', () => {
	it('refuses the all-zero id at either width', () => {
		expect(hasTrace('00000000000000000000000000000000')).toBe(false);
		expect(hasTrace('0000000000000000')).toBe(false);
	});

	it('refuses an absent or blank id', () => {
		expect(hasTrace(null)).toBe(false);
		expect(hasTrace(undefined)).toBe(false);
		expect(hasTrace('')).toBe(false);
		expect(hasTrace('   ')).toBe(false);
	});

	it('accepts a real trace, including one that merely starts with zeros', () => {
		expect(hasTrace('4bf92f3577b34da6a3ce929d0e0e4736')).toBe(true);
		expect(hasTrace('0000000000000000000000000000000a')).toBe(true);
	});
});

/*
 * `toLocale*` with no locale hands the presentation to the reader's browser,
 * in a product whose every other string is English. These pin the format
 * itself, so a machine in any zone reads the same rows, and so a table
 * rendered on the server matches the one hydrated in the browser.
 */
describe('formatDate', () => {
	it('writes a day as ISO-8601', () => {
		expect(formatDate('2026-09-08T14:32:07Z')).toBe('2026-09-08');
	});

	it('reads the day in UTC, so no offset moves it', () => {
		// Late on the 4th in UTC is the 5th east of it and the 4th west of it.
		// A locale-formatted cell would show whichever one the reader's browser
		// is in, and a date-only value would go back a day for anyone behind UTC.
		expect(formatDate('2026-03-04T23:30:00Z')).toBe('2026-03-04');
		expect(formatDate('2026-03-04T00:30:00Z')).toBe('2026-03-04');
	});

	it('pads, so the column sorts as it reads', () => {
		expect(formatDate('2026-01-02T00:00:00Z')).toBe('2026-01-02');
	});

	it('takes the instant however it arrives', () => {
		expect(formatDate(new Date('2026-09-08T00:00:00Z'))).toBe('2026-09-08');
		expect(formatDate(Date.parse('2026-09-08T00:00:00Z'))).toBe('2026-09-08');
	});

	it('says nothing rather than "Invalid Date"', () => {
		expect(formatDate(null)).toBe(NO_VALUE);
		expect(formatDate(undefined)).toBe(NO_VALUE);
		expect(formatDate('')).toBe(NO_VALUE);
		expect(formatDate('not a date')).toBe(NO_VALUE);
	});

	it('lets the call site name the gap in its own words', () => {
		expect(formatDate(null, 'Never')).toBe('Never');
		expect(formatDate('nonsense', 'Unknown')).toBe('Unknown');
	});
});

describe('formatDateTime', () => {
	it('writes the day and the minute, and names the zone', () => {
		expect(formatDateTime('2026-09-08T14:32:07Z')).toBe('2026-09-08 14:32 UTC');
	});

	// An unlabeled clock is read as the reader's own.
	it('keeps the zone on the value where a reader can see it', () => {
		expect(formatDateTime('2026-09-08T04:05:00Z')).toContain('UTC');
		expect(formatDateTime('2026-09-08T04:05:00Z')).toBe('2026-09-08 04:05 UTC');
	});

	it('converts an offset the engine sent to the zone we print', () => {
		expect(formatDateTime('2026-09-08T14:32:07+02:00')).toBe('2026-09-08 12:32 UTC');
	});

	it('falls back rather than printing a broken instant', () => {
		expect(formatDateTime(null)).toBe(NO_VALUE);
		expect(formatDateTime('nonsense', 'nonsense')).toBe('nonsense');
	});
});

describe('formatTime', () => {
	it('writes the clock with its seconds for a live tail', () => {
		expect(formatTime('2026-09-08T14:32:07Z')).toBe('14:32:07 UTC');
	});

	it('keeps the raw value when a streamed row will not parse', () => {
		expect(formatTime('whatever the tail sent', 'whatever the tail sent')).toBe(
			'whatever the tail sent'
		);
	});
});

describe('formatCount', () => {
	it('groups on one fixed locale', () => {
		// `toLocaleString()` with no locale renders this as 1.234.567 in half of
		// Europe, where it reads as a fraction.
		expect(formatCount(1234567)).toBe('1,234,567');
		expect(formatCount(999)).toBe('999');
		expect(formatCount(0)).toBe('0');
	});

	it('rounds, because a count has no fraction', () => {
		expect(formatCount(1234.6)).toBe('1,235');
	});

	it('names the gap for a number that is not one', () => {
		expect(formatCount(null)).toBe(NO_VALUE);
		expect(formatCount(undefined)).toBe(NO_VALUE);
		expect(formatCount(Number.NaN)).toBe(NO_VALUE);
		expect(formatCount(null, 'Not declared')).toBe('Not declared');
	});
});

describe('formatBytes', () => {
	// Each row is what that surface printed before it shared this function,
	// read from its own formatter at the time.
	const before: [surface: string, size: number | null, largest: ByteUnit, shown: string][] = [
		['tenant usage', 0, 'TB', '0 B'],
		['tenant usage', 1, 'TB', '1 B'],
		['tenant usage', 512, 'TB', '512 B'],
		['tenant usage', 1023, 'TB', '1023 B'],
		['tenant usage', 1024, 'TB', '1.0 KB'],
		['tenant usage', 1536, 'TB', '1.5 KB'],
		['tenant usage', 2048, 'TB', '2.0 KB'],
		['tenant usage', 1048575, 'TB', '1024.0 KB'],
		['tenant usage', 1048576, 'TB', '1.0 MB'],
		['tenant usage', 5242880, 'TB', '5.0 MB'],
		['tenant usage', 1073741823, 'TB', '1024.0 MB'],
		['tenant usage', 1073741824, 'TB', '1.0 GB'],
		['tenant usage', 1610612736, 'TB', '1.5 GB'],
		['tenant usage', 10737418240, 'TB', '10.0 GB'],
		['tenant usage', 1099511627776, 'TB', '1.0 TB'],
		['tenant usage', 2199023255552, 'TB', '2.0 TB'],
		['tenant usage', null, 'TB', '0 B'],
		['tenant usage', -1, 'TB', '0 B'],
		['cache entries', 0, 'GB', '0 B'],
		['cache entries', 1, 'GB', '1 B'],
		['cache entries', 512, 'GB', '512 B'],
		['cache entries', 1023, 'GB', '1023 B'],
		['cache entries', 1024, 'GB', '1.0 KB'],
		['cache entries', 1536, 'GB', '1.5 KB'],
		['cache entries', 2048, 'GB', '2.0 KB'],
		['cache entries', 1048575, 'GB', '1024.0 KB'],
		['cache entries', 1048576, 'GB', '1.0 MB'],
		['cache entries', 5242880, 'GB', '5.0 MB'],
		['cache entries', 1073741823, 'GB', '1024.0 MB'],
		['cache entries', 1073741824, 'GB', '1.0 GB'],
		['cache entries', 1610612736, 'GB', '1.5 GB'],
		['cache entries', 10737418240, 'GB', '10.0 GB'],
		['cache entries', 1099511627776, 'GB', '1024.0 GB'],
		['cache entries', 2199023255552, 'GB', '2048.0 GB'],
		['cache entries', null, 'GB', '0 B'],
		['cache entries', -1, 'GB', '0 B'],
		['export files', 0, 'GB', '0 B'],
		['export files', 1, 'GB', '1 B'],
		['export files', 512, 'GB', '512 B'],
		['export files', 1023, 'GB', '1023 B'],
		['export files', 1024, 'GB', '1.0 KB'],
		['export files', 1536, 'GB', '1.5 KB'],
		['export files', 2048, 'GB', '2.0 KB'],
		['export files', 1048575, 'GB', '1024.0 KB'],
		['export files', 1048576, 'GB', '1.0 MB'],
		['export files', 5242880, 'GB', '5.0 MB'],
		['export files', 1073741823, 'GB', '1024.0 MB'],
		['export files', 1073741824, 'GB', '1.0 GB'],
		['export files', 1610612736, 'GB', '1.5 GB'],
		['export files', 10737418240, 'GB', '10.0 GB'],
		['export files', 1099511627776, 'GB', '1024.0 GB'],
		['export files', 2199023255552, 'GB', '2048.0 GB'],
		['export files', -1, 'GB', '0 B'],
		['media library', 0, 'MB', '0 B'],
		['media library', 1, 'MB', '1 B'],
		['media library', 512, 'MB', '512 B'],
		['media library', 1023, 'MB', '1023 B'],
		['media library', 1024, 'MB', '1.0 KB'],
		['media library', 1536, 'MB', '1.5 KB'],
		['media library', 2048, 'MB', '2.0 KB'],
		['media library', 1048575, 'MB', '1024.0 KB'],
		['media library', 1048576, 'MB', '1.0 MB'],
		['media library', 5242880, 'MB', '5.0 MB'],
		['media library', 1073741823, 'MB', '1024.0 MB'],
		['media library', 1073741824, 'MB', '1024.0 MB'],
		['media library', 1610612736, 'MB', '1536.0 MB'],
		['media library', 10737418240, 'MB', '10240.0 MB'],
		['media library', 1099511627776, 'MB', '1048576.0 MB'],
		['media library', 2199023255552, 'MB', '2097152.0 MB'],
		['media library', -1, 'MB', '0 B'],
		['media library', Number.NaN, 'MB', '0 B'],
		['analytics request size', 0, 'MB', '0 B'],
		['analytics request size', 1, 'MB', '1 B'],
		['analytics request size', 512, 'MB', '512 B'],
		['analytics request size', 1023, 'MB', '1023 B'],
		['analytics request size', 1024, 'MB', '1.0 KB'],
		['analytics request size', 1536, 'MB', '1.5 KB'],
		['analytics request size', 2048, 'MB', '2.0 KB'],
		['analytics request size', 1048575, 'MB', '1024.0 KB'],
		['analytics request size', 1048576, 'MB', '1.0 MB'],
		['analytics request size', 5242880, 'MB', '5.0 MB'],
		['analytics request size', 1073741823, 'MB', '1024.0 MB'],
		['analytics request size', 1073741824, 'MB', '1024.0 MB'],
		['analytics request size', 1610612736, 'MB', '1536.0 MB'],
		['analytics request size', 10737418240, 'MB', '10240.0 MB'],
		['analytics request size', 1099511627776, 'MB', '1048576.0 MB'],
		['analytics request size', 2199023255552, 'MB', '2097152.0 MB'],
		['analytics request size', 0.4, 'MB', '0 B'],
		['analytics request size', 512.6, 'MB', '513 B'],
		['analytics request size', 1023.5, 'MB', '1024 B'],
	];

	it.each(before)('prints %s %s capped at %s as %s', (_surface, size, largest, shown) => {
		expect(formatBytes(size, largest)).toBe(shown);
	});

	it('steps up to TB unless told to stop sooner', () => {
		expect(formatBytes(2_199_023_255_552)).toBe('2.0 TB');
		expect(formatBytes(undefined)).toBe('0 B');
	});
});

describe('formatMillis', () => {
	const cases: [ms: number, shown: string][] = [
		[0, '0 ms'],
		[0.0004, '400 ns'],
		[0.4, '400 µs'],
		[1, '1.0 ms'],
		[0.9996, '1.0 ms'],
		[1.54, '1.5 ms'],
		[9.96, '10 ms'],
		[342, '342 ms'],
		[999, '999 ms'],
		[999.4, '999 ms'],
		[999.6, '1.00 s'],
		[1000, '1.00 s'],
		[1500, '1.50 s'],
		[1234.5, '1.23 s'],
		[59_999, '1m 00s'],
		[61234, '1m 01s'],
		[125_000, '2m 05s'],
		[3600000, '60m 00s'],
	];

	it.each(cases)('prints %s as %s', (ms, shown) => {
		expect(formatMillis(ms)).toBe(shown);
	});

	it('names the gap for a time that was not measured', () => {
		expect(formatMillis(null)).toBe(NO_VALUE);
		expect(formatMillis(undefined)).toBe(NO_VALUE);
		expect(formatMillis(Number.NaN)).toBe(NO_VALUE);
	});
});

/** A fixed clock, so "3 minutes ago" is the same sentence on every run. */
const relNow = new Date('2026-09-14T12:00:00Z');
const ago = (ms: number) => new Date(relNow.getTime() - ms).toISOString();

describe('relativeTime', () => {
	it('is empty for nothing and for a value that is not a date', () => {
		expect(relativeTime(null, relNow)).toBe('');
		expect(relativeTime(undefined, relNow)).toBe('');
		expect(relativeTime('', relNow)).toBe('');
		expect(relativeTime('yesterday', relNow)).toBe('');
	});

	it.each([
		[2_000, 'just now'],
		[45_000, '45 seconds ago'],
		[60_000, '1 minute ago'],
		[59 * 60_000, '59 minutes ago'],
		[3 * 3_600_000, '3 hours ago'],
		[24 * 3_600_000, '1 day ago'],
		[8 * 86_400_000, '1 week ago'],
		[45 * 86_400_000, '1 month ago'],
		[400 * 86_400_000, '1 year ago'],
		[3 * 365 * 86_400_000, '3 years ago'],
	])('reads %d ms ago as %s', (ms, text) => {
		expect(relativeTime(ago(ms), relNow)).toBe(text);
	});

	it('treats a timestamp in the future as now', () => {
		expect(relativeTime(ago(-60_000), relNow)).toBe('just now');
	});
});

describe('formatGoDuration', () => {
	it.each([
		['3.809468ms', '3.8 ms'],
		['420µs', '0.42 ms'],
		['250ms', '250 ms'],
		['30s', '30 s'],
		['2m0s', '2m'],
		['1m30s', '1m 30s'],
		['1h0m0s', '1h'],
	])('says %s as %s', (wire, said) => {
		expect(formatGoDuration(wire)).toBe(said);
	});

	it('hands back a string that is not a Go duration, and the fallback for none', () => {
		expect(formatGoDuration('soon')).toBe('soon');
		expect(formatGoDuration(null)).toBe(NO_VALUE);
	});
});

describe('formatPercent', () => {
	it('says a fraction as a percentage to one decimal place', () => {
		expect(formatPercent(0.0123)).toBe('1.2%');
		expect(formatPercent(0)).toBe('0.0%');
		expect(formatPercent(1)).toBe('100.0%');
	});

	it('names the gap for a rate that was not computed', () => {
		expect(formatPercent(null)).toBe(NO_VALUE);
		expect(formatPercent(Number.NaN, '')).toBe('');
	});
});

describe('formatSignedBytes', () => {
	it('keeps the sign of a change and steps up in powers of 1,024', () => {
		expect(formatSignedBytes(-512)).toBe('-512 B');
		expect(formatSignedBytes(2048)).toBe('2.0 KB');
		expect(formatSignedBytes(-1.5 * 1024 ** 2)).toBe('-1.5 MB');
		expect(formatSignedBytes(0)).toBe('0 B');
		expect(formatSignedBytes(undefined)).toBe(NO_VALUE);
	});
});

describe('plural', () => {
	it('takes the singular for one and the plural for every other count, zero included', () => {
		expect(plural(1, 'row')).toBe('row');
		expect(plural(0, 'row')).toBe('rows');
		expect(plural(2, 'entry', 'entries')).toBe('entries');
	});
});
