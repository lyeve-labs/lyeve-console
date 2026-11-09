import type { SchemaField } from '@lyeve-labs/client';

/**
 * Calendar and clock components of a timestamp, with no zone applied yet.
 * `offsetMinutes` is minutes east of UTC when the text named a zone and null
 * when it did not, which is the only thing that decides how the parts are read.
 */
type TimeParts = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
	ms: number;
	offsetMinutes: number | null;
};

/** What a timestamp with no zone designator means in a given direction. */
type DefaultZone = 'utc' | 'local';

/**
 * RFC 3339 and the HTML `datetime-local` value share this shape. Seconds, the
 * fraction and the zone are all optional, and MySQL renders DATETIME with a
 * space instead of the T.
 */
const TIMESTAMP_PATTERN =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(Z|z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Split a timestamp into integers without handing the text to the Date parser.
 *
 * `new Date('2026-01-02')` is UTC midnight by specification while
 * `new Date('2026-01-02T00:00')` is local midnight, so one parser applied to
 * both shapes lands in two different zones. Reading the digits here keeps the
 * zone decision at the call site, where the direction of the conversion is
 * known.
 */
function parseTimestamp(text: string): TimeParts | null {
	const m = TIMESTAMP_PATTERN.exec(text.trim());
	if (!m) return null;
	const [, y, mo, d, h, mi, s, frac, zone] = m;
	const hour = h ? Number(h) : 0;
	const minute = mi ? Number(mi) : 0;
	const second = s ? Number(s) : 0;
	if (hour > 23 || minute > 59 || second > 60) return null;
	let offsetMinutes: number | null = null;
	if (zone) {
		if (zone === 'Z' || zone === 'z') {
			offsetMinutes = 0;
		} else {
			const sign = zone.startsWith('-') ? -1 : 1;
			const digits = zone.slice(1).replace(':', '');
			const zh = Number(digits.slice(0, 2));
			const zm = Number(digits.slice(2, 4));
			if (zh > 23 || zm > 59) return null;
			offsetMinutes = sign * (zh * 60 + zm);
		}
	}
	return {
		year: Number(y),
		month: Number(mo),
		day: Number(d),
		hour,
		minute,
		second,
		// A Date holds milliseconds, so anything finer is truncated here rather
		// than rounded into the next millisecond.
		ms: frac ? Number(`${frac}000`.slice(0, 3)) : 0,
		offsetMinutes,
	};
}

/**
 * Turn parsed components into the instant they name.
 *
 * Parts that carry their own offset are absolute. Parts that do not are read
 * in `defaultZone`: server data is stored in UTC, and the value of an
 * the kit's DateTimePicker holds the operator's local wall clock.
 */
function instantFromParts(parts: TimeParts, defaultZone: DefaultZone): Date | null {
	const { year, month, day, hour, minute, second, ms, offsetMinutes } = parts;
	let dt: Date;
	if (offsetMinutes === null && defaultZone === 'local') {
		dt = new Date(year, month - 1, day, hour, minute, second, ms);
		// The constructor maps years 0 through 99 into the 1900s, so 0099 would
		// silently become 1999.
		dt.setFullYear(year, month - 1, day);
		// An impossible date such as February 30 rolls forward instead of
		// failing, so compare the components back.
		if (dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
	} else {
		dt = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
		dt.setUTCFullYear(year, month - 1, day);
		if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
		if (offsetMinutes) dt = new Date(dt.getTime() - offsetMinutes * 60_000);
	}
	return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Resolve a stored or form value to the instant it names, or null. */
function toInstant(value: unknown, defaultZone: DefaultZone): Date | null {
	if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
	if (typeof value !== 'string') return null;
	const parts = parseTimestamp(value);
	return parts ? instantFromParts(parts, defaultZone) : null;
}

function pad(n: number, width: number): string {
	return String(n).padStart(width, '0');
}

/**
 * Render an instant as the operator's local wall clock, in the value format
 * the kit's DateTimePicker reads.
 *
 * Seconds and the fraction are emitted only when they carry information, so a
 * whole minute stays the two-part value the control shows by default. The
 * picker shows no fraction, and the field drops it from the display only.
 */
function formatLocalInput(dt: Date): string {
	const date = `${pad(dt.getFullYear(), 4)}-${pad(dt.getMonth() + 1, 2)}-${pad(dt.getDate(), 2)}`;
	const time = `${pad(dt.getHours(), 2)}:${pad(dt.getMinutes(), 2)}`;
	const s = dt.getSeconds();
	const ms = dt.getMilliseconds();
	if (ms !== 0) return `${date}T${time}:${pad(s, 2)}.${pad(ms, 3)}`;
	if (s !== 0) return `${date}T${time}:${pad(s, 2)}`;
	return `${date}T${time}`;
}

/**
 * Render an instant as the UTC timestamp the API stores. Assembled from the
 * UTC components rather than taken from toISOString so the format is fixed
 * here and cannot drift with the year.
 */
function formatUtcInstant(dt: Date): string {
	const date = `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1, 2)}-${pad(dt.getUTCDate(), 2)}`;
	const time = `${pad(dt.getUTCHours(), 2)}:${pad(dt.getUTCMinutes(), 2)}:${pad(dt.getUTCSeconds(), 2)}`;
	return `${date}T${time}.${pad(dt.getUTCMilliseconds(), 3)}Z`;
}

/**
 * Returns the key used in formValues for a field.
 * For belongs_to relation fields the FK column is {name}_id.
 */
export function fieldKey(f: SchemaField): string {
	if (f.field_type === 'relation' && (f.relation_type === 'belongs_to' || !f.relation_type)) {
		return (f.relation_fk_name ?? `${f.name}_id`);
	}
	return f.name;
}

/**
 * Build an empty form state for creating a new entry.
 * Booleans default to false. Everything else defaults to ''.
 */
export function buildEmpty(fields: SchemaField[]): Record<string, unknown> {
	return Object.fromEntries(
		fields
			.filter((f) => !f.system)
			.map((f) => {
				if (f.field_type === 'boolean') return [fieldKey(f), false];
				if (f.field_type === 'relation' && (f.relation_type === 'has_many' || f.relation_type === 'many_to_many')) return [f.name, []];
				return [fieldKey(f), ''];
			}),
	);
}

/**
 * Build a form state from existing server data (for editing).
 * Converts server types to form-friendly representations.
 */
export function buildFromData(
	fields: SchemaField[],
	data: Record<string, unknown>,
): Record<string, unknown> {
	return Object.fromEntries(
		fields
			.filter((f) => !f.system)
			.map((f) => {
				const key = fieldKey(f);
				const v = data[key] ?? data[f.name];
				if (f.field_type === 'boolean') return [key, Boolean(v)];
				if (f.field_type === 'datetime' && v) {
					// The control reads its value as local time with no zone, so a UTC
					// wall clock would shift the stored instant on every save. A value
					// that cannot be read is handed through so the operator sees what
					// is stored.
					const dt = toInstant(v, 'utc');
					return [key, dt ? formatLocalInput(dt) : String(v)];
				}
				if (f.field_type === 'json' && v !== null && v !== undefined) {
					return [key, typeof v === 'string' ? v : JSON.stringify(v, null, 2)];
				}
				// many_to_many / has_many: value is an array of IDs from _relations endpoint
				if (f.field_type === 'relation' && (f.relation_type === 'has_many' || f.relation_type === 'many_to_many')) {
					return [f.name, Array.isArray(v) ? v : []];
				}
				return [key, v ?? ''];
			}),
	);
}

/**
 * Client-side required field validation.
 * Returns an error map. Empty map means all fields are valid.
 */
export function validate(
	fields: SchemaField[],
	formValues: Record<string, unknown>,
): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const f of fields) {
		if (!f.required || f.system) continue;
		const v = formValues[fieldKey(f)];
		if (f.field_type === 'boolean') continue;
		if (v === null || v === undefined || v === '') {
			errors[f.name] = `Enter ${f.name}.`;
		} else if (f.field_type === 'rich_text') {
			if (!String(v).replace(/<[^>]*>/g, '').trim()) {
				errors[f.name] = `Enter ${f.name}.`;
			}
		}
	}
	return errors;
}

/**
 * An integer field's value as the API takes it. The form holds the digits as
 * text. A JSON number past 2^53 is rounded by every JSON reader in
 * JavaScript, so a plain integer outside the safe range goes as its digit
 * string, which the API reads exactly. Anything else goes as typed, so the
 * API refuses it with its own message for the field.
 */
function integerValue(val: unknown): unknown {
	if (val === null || val === undefined) return null;
	const text = String(val).trim();
	if (text === '') return null;
	if (!/^-?\d+$/.test(text)) return text;
	const n = Number(text);
	return Number.isSafeInteger(n) ? n : text;
}

/**
 * Serialize form values to a JSON string ready to POST to the API.
 * Handles number coercion, boolean casting, JSON parsing, and the local wall
 * clock of a datetime field back to the UTC instant the API stores.
 * many_to_many / has_many fields are excluded (handled via the relations endpoint).
 */
export function serialize(
	fields: SchemaField[],
	formValues: Record<string, unknown>,
): string {
	const out: Record<string, unknown> = {};
	for (const f of fields) {
		if (f.system) continue;
		// Nothing here holds a value for these three: many_to_many goes to
		// the relations endpoint, and has_one and has_many are read from the
		// other table. A has_one sent under its name would reach the insert as
		// a column that does not exist and fail the whole save.
		if (f.field_type === 'relation' && (f.relation_type === 'has_one' || f.relation_type === 'has_many' || f.relation_type === 'many_to_many')) continue;
		const key = fieldKey(f);
		const val = formValues[key];
		if (f.field_type === 'integer') {
			out[key] = integerValue(val);
		} else if (f.field_type === 'decimal') {
			// A decimal is exact digits as a string, sent as typed less the
			// spaces around it. The API refuses a value it cannot hold rather
			// than rounding it, so nothing is rounded here either.
			const text = val === null || val === undefined ? '' : String(val).trim();
			out[key] = text === '' ? null : text;
		} else if (f.field_type === 'number') {
			out[key] = val === '' || val === null || val === undefined ? null : Number(val);
		} else if (f.field_type === 'boolean') {
			out[key] = Boolean(val);
		} else if (f.field_type === 'json') {
			try {
				out[key] = typeof val === 'string' ? JSON.parse(val) : val;
			} catch {
				out[key] = val;
			}
		} else if (f.field_type === 'datetime' && val) {
			// The form value is the operator's local wall clock. Reading it as UTC
			// would move the stored instant on a save that changed nothing.
			const dt = toInstant(val, 'local');
			out[key] = dt ? formatUtcInstant(dt) : val;
		} else {
			out[key] = val === '' ? null : (val ?? null);
		}
	}
	return JSON.stringify(out);
}

/**
 * Extract many_to_many fields with their selected IDs from formValues.
 * Used by the content edit page to call the relations endpoint after saving.
 */
export function extractM2MRelations(
	fields: SchemaField[],
	formValues: Record<string, unknown>,
): Array<{ fieldName: string; ids: string[] }> {
	return fields
		.filter((f) => !f.system && f.field_type === 'relation' && f.relation_type === 'many_to_many')
		.map((f) => ({
			fieldName: f.name,
			ids: (Array.isArray(formValues[f.name]) ? formValues[f.name] as unknown[] : [])
				.map(String)
				.filter(Boolean),
		}));
}
