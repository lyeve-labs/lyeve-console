import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient } from '#lib/server/authz.ts';
import { actionFailure } from '#lib/server/action-error.ts';
import { PLUGIN } from '#lib/plugin-names.ts';
import { notRunning } from '#lib/plugins.ts';
import {
	listDevices,
	trustThisDevice,
	untrustDevice,
	type Device,
} from '#lib/api/devices.ts';
import { type Gate, GATE_OK, section } from '#lib/api/gate.ts';
import { couldNotLoad } from '#lib/outage.ts';
import { pageOf, pageWindow, pastEndOffset, searchOf, withOffset } from '#lib/api/list.ts';
import { asked } from '#lib/server/asked.ts';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);
	const q = searchOf(event.url);

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
			q,
			gate: { state: 'absent' } as Gate,
		};
	}

	const client = authedClient(event);
	const read = await section(
		listDevices(client, limit + 1, offset, q).then((res) => pageOf(res, limit, offset)),
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
		q,
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
