import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	ALERT_STATUSES,
	acknowledge,
	assign,
	isTriageAction,
	listAlerts,
	listCodes,
	listEvents,
	triage,
	type AlertStatus,
	type ErrorAlert,
	type ErrorCode,
	type EventPage,
} from '$lib/api/error-tracking';
import { type Gate, GATE_OK, section } from '$lib/api/gate';
import { pageWindow, pastEndOffset, rowsOf, withOffset } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** How many of the newest events the page lists under the alerts. */
const EVENT_LIMIT = 20;

function statusFilter(url: URL): AlertStatus | '' {
	const s = url.searchParams.get('status') ?? '';
	return (ALERT_STATUSES as readonly string[]).includes(s) ? (s as AlertStatus) : '';
}

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);
	const status = statusFilter(event.url);

	const unread = {
		alerts: [] as ErrorAlert[],
		codes: [] as ErrorCode[],
		total: null as number | null,
		limit,
		offset,
		status,
		events: null as EventPage | null,
	};
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.errorTracking)) return { ...unread, gate: { state: 'absent' } as Gate };

	const client = authedClient(event);
	const [read, codes, events] = await Promise.all([
		section(listAlerts(client, limit, offset, status), couldNotLoad('errors')),
		// The catalog gives each fingerprint its severity and its remediation
		// text. Losing it costs the labels, never the list.
		listCodes(client)
			.then((c) => rowsOf(c))
			.catch((): ErrorCode[] => []),
		// The newest occurrences, and how many older ones this instance does not
		// read. Losing them costs the band, never the alert list, and a failed
		// read is said as one rather than as no events.
		listEvents(client, EVENT_LIMIT).catch((): EventPage | null => null),
	]);
	if (!read.ok) return { ...unread, gate: read.gate };

	const { alerts, total } = read.value;
	const back = pastEndOffset(alerts.length, limit, offset, total);
	if (back !== null) redirect(307, withOffset(event.url, back));

	return { alerts, codes, total, limit, offset, gate: GATE_OK, status, events };
};

export const actions: Actions = {
	acknowledge: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'This form is missing its alert. Reload the page and try again.' });
		try {
			await acknowledge(client, id);
		} catch (err) {
			return actionFailure(err, 'Could not acknowledge the alert. Try again.');
		}
		return { acknowledged: id };
	},

	/** Resolve, ignore or reopen one alert. Triage works on every install. */
	triage: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		const action = form.get('action');
		if (!id || !isTriageAction(action)) return fail(400, { error: 'This form is missing its alert or action. Reload the page and try again.' });
		try {
			await triage(authedClient(event), id, action);
		} catch (err) {
			return actionFailure(err, 'Could not change the alert status. Try again.');
		}
		return { triaged: id, action };
	},

	/** Assign an alert to somebody, or clear the assignee with an empty one. */
	assign: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		const assignee = String(form.get('assignee') ?? '').trim();
		// The assign prompt names itself on a failure, so the prompt says it and
		// the page does not.
		if (!id) return fail(400, { error: 'This form is missing its alert. Reload the page and try again.', drawer: 'assign' });
		if (assignee.length > 255) return fail(400, { error: 'Enter an assignee of at most 255 characters.', drawer: 'assign' });
		try {
			await assign(authedClient(event), id, assignee);
		} catch (err) {
			const failed = actionFailure(err, 'Could not assign the alert. Try again.');
			return fail(failed.status, { ...failed.data, drawer: 'assign' });
		}
		return { assigned: id, assignee };
	},
};
