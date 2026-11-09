import type { StatusTone } from '@lyeve-labs/ui-kit';

/**
 * The tone an HTTP method's badge carries, the same on every page that lists
 * routes. A read is brand, a create success, a change warn and a delete
 * danger, so a write stands out from a read and a delete from both. A method
 * outside that set is neutral.
 */
export function methodTone(method: string): StatusTone {
	switch (method.toUpperCase()) {
		case 'GET':
		case 'HEAD':
			return 'brand';
		case 'POST':
			return 'success';
		case 'PUT':
		case 'PATCH':
			return 'warn';
		case 'DELETE':
			return 'danger';
		default:
			return 'neutral';
	}
}

/**
 * The tone a background job's or a run's status badge carries: finished,
 * failed, still going, or waiting. A data export job and an event replay run
 * report the same words, so both read through this one map.
 */
export function jobTone(status: string): StatusTone {
	if (status === 'completed') return 'success';
	if (status === 'failed') return 'danger';
	if (status === 'running') return 'warn';
	return 'neutral';
}

/** Tells the events that fire after a write from the ones that fire before it. */
export function eventTone(event: string): StatusTone {
	return event.startsWith('after_') ? 'success' : 'warn';
}

/** The tone a content entry's status badge carries: live, waiting, or anything else. */
export function entryTone(status: string): StatusTone {
	if (status === 'published') return 'success';
	if (status === 'draft') return 'warn';
	return 'neutral';
}

/**
 * The tone an HTTP status badge carries, the same on every page that shows a
 * response. A success is success, a redirect neutral, a refusal warn and a
 * server failure danger. A status outside those ranges, such as a 0 for a
 * request that got no answer, says nothing about the response and is neutral.
 */
export function httpStatusTone(status: number): StatusTone {
	if (status >= 200 && status < 300) return 'success';
	if (status >= 400 && status < 500) return 'warn';
	if (status >= 500 && status < 600) return 'danger';
	return 'neutral';
}
