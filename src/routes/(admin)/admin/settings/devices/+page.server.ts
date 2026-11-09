import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	listDevices,
	trustThisDevice,
	untrustDevice,
	type Device,
} from '$lib/api/devices';
import { type Gate, GATE_OK, section } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import { pageOf, pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { asked } from '$lib/server/asked';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	// The browser reading the page, so a row can be marked as probably this
	// one. It is passed through rather than read in the component because a
	// component that reads navigator renders differently on the server.
	const userAgent = event.request.headers.get('user-agent');

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.deviceFingerprint)) {
		return {
			devices: [] as Device[],
			total: null as number | null,
			limit,
			offset,
			hasMore: false,
			userAgent,
			gate: { state: 'absent' } as Gate,
		};
	}

	const client = authedClient(event);
	const read = await section(
		listDevices(client, limit + 1, offset).then((res) => pageOf(res, limit, offset)),
		couldNotLoad('your devices'),
	);
	if (read.ok) {
		const back = pastEndOffset(read.value.rows.length, limit, offset, read.value.total);
		if (back !== null) redirect(307, withOffset(event.url, back));
	}

	return {
		devices: read.ok ? read.value.rows : [],
		total: read.ok ? read.value.total : null,
		limit,
		offset,
		hasMore: read.ok && read.value.hasMore,
		userAgent,
		gate: read.ok ? GATE_OK : read.gate,
	};
};

// No requireRole here, and deliberately. Every route behind this page reads the
// user out of the session claims, so it is already scoped to whoever is asking:
// a role check would only stop somebody managing their own devices.
export const actions: Actions = {
	trust: async (event) => {
		const client = authedClient(event);
		const form = await event.request.formData();
		const label = String(form.get('label') ?? '').trim();
		if (!label) {
			return fail(400, { error: 'Enter a name for this device.' });
		}
		try {
			await trustThisDevice(client, label);
		} catch (err) {
			const failed = actionFailure(err, 'Could not trust this device. Try again.');
			return fail(failed.status, failed.data);
		}
		return { trusted: label };
	},

	untrust: asked(
		{
			question: 'Forget this device?',
			detail: 'It stops being a trusted device. Signing in from it again is treated as a new device.',
			label: 'Forget',
		},
		async (event) => {
			const client = authedClient(event);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			if (!id) return fail(400, { error: 'This form is missing its device. Reload the page and try again.' });
			try {
				await untrustDevice(client, id);
			} catch (err) {
				const failed = actionFailure(err, 'Could not forget this device. Try again.');
				return fail(failed.status, failed.data);
			}
			return { removed: id };
		},
	),
};
