import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { fieldRefusalOf } from './content-validation';

/** The 422 the content plugin writes: an errors array and no error key. */
function refusal(errors: { field: string; message: string }[]): ApiError {
	return new ApiError(422, JSON.stringify({ errors }), { errors });
}

describe('a schema refusal from the content plugin', () => {
	it('marks each field the form shows with its own message', () => {
		const out = fieldRefusalOf(
			refusal([
				{ field: 'email', message: 'must be a valid email' },
				{ field: 'age', message: 'must be at most 120' },
			]),
			['email', 'age'],
		);

		expect(out).toEqual({
			error: 'Check the highlighted fields.',
			fieldErrors: { email: 'must be a valid email', age: 'must be at most 120' },
		});
	});

	it('keeps a message for a field the form does not show in the banner', () => {
		const out = fieldRefusalOf(refusal([{ field: 'owner', message: 'is required' }]), ['title']);

		expect(out).toEqual({ error: 'The entry was not saved. owner: is required.', fieldErrors: {} });
	});

	it('names the key inside a field that the refusal points at', () => {
		const body = {
			error: 'A field holds a masked value.',
			field: 'data.email',
			errors: [{ field: 'data', message: 'The key email holds a masked value.' }],
		};
		const out = fieldRefusalOf(new ApiError(422, JSON.stringify(body), body), ['status', 'data']);

		expect(out).toEqual({
			error: 'Check the highlighted fields.',
			fieldErrors: { data: 'The key email holds a masked value.' },
			errorKeys: { data: 'email' },
		});
	});

	it('reads an entry that names a key as a message for its field', () => {
		const out = fieldRefusalOf(refusal([{ field: 'data.email', message: 'is not an address' }]), ['data']);

		expect(out).toEqual({
			error: 'Check the highlighted fields.',
			fieldErrors: { data: 'is not an address' },
			errorKeys: { data: 'email' },
		});
	});

	it('leaves any other failure to the caller', () => {
		expect(fieldRefusalOf(new ApiError(409, 'slug already in use'), ['title'])).toBeNull();
		expect(fieldRefusalOf(new Error('offline'), ['title'])).toBeNull();
	});
});
