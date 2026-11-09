import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { atLimit, bodyString, errorCodeOf, limitOf } from './limits';

describe('errorCodeOf', () => {
	it('reads the code a refusal carries beside its sentence', () => {
		const err = new ApiError(409, 'that range is already on the list', {
			error: 'that range is already on the list',
			code: 'example.duplicate',
		});
		expect(errorCodeOf(err)).toBe('example.duplicate');
	});

	it('answers empty for a refusal without a code and for anything that is not a request error', () => {
		expect(errorCodeOf(new ApiError(409, 'conflict', { error: 'conflict' }))).toBe('');
		expect(errorCodeOf(new ApiError(500, 'boom'))).toBe('');
		expect(errorCodeOf(new ApiError(400, 'x', { code: 7 }))).toBe('');
		expect(errorCodeOf(new Error('x'))).toBe('');
	});
});

describe('bodyString', () => {
	it('reads the field a refused value names', () => {
		const err = new ApiError(422, 'Writes must be between 1 and 120 a minute.', {
			error: 'Writes must be between 1 and 120 a minute.',
			code: 'settings_invalid',
			field: 'writes_per_minute',
		});
		expect(bodyString(err, 'field')).toBe('writes_per_minute');
	});

	it('answers empty for a key the body lacks or holds as another type', () => {
		expect(bodyString(new ApiError(422, 'x', { code: 'settings_invalid' }), 'field')).toBe('');
		expect(bodyString(new ApiError(422, 'x', { field: 3 }), 'field')).toBe('');
		expect(bodyString(new Error('x'), 'field')).toBe('');
	});
});

describe('limitOf', () => {
	it('reads one entry of a limits object', () => {
		expect(limitOf({ entries: { limit: 500, current: 12 } }, 'entries')).toEqual({ limit: 500, current: 12 });
	});

	it('reads a null limit as no ceiling', () => {
		expect(limitOf({ workflows: { limit: null, current: 3 } }, 'workflows')).toEqual({ limit: null, current: 3 });
	});

	it('answers null when the read sent no such entry', () => {
		expect(limitOf(undefined, 'entries')).toBeNull();
		expect(limitOf({ other: { limit: 1, current: 0 } }, 'entries')).toBeNull();
	});
});

describe('atLimit', () => {
	it('is full only at a ceiling', () => {
		expect(atLimit({ limit: 2, current: 2 })).toBe(true);
		expect(atLimit({ limit: 2, current: 1 })).toBe(false);
		expect(atLimit({ limit: null, current: 900 })).toBe(false);
		expect(atLimit(null)).toBe(false);
	});
});
