import { formatMillis } from '$lib/format';

/** How long a run or a step took: `12 ms`, `1.44 s`, `2m 05s`, and empty when it was not measured. */
export function formatDuration(ms: number | null | undefined): string {
	return formatMillis(ms, '');
}
