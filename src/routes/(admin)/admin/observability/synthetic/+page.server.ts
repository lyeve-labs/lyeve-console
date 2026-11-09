import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	SECRET_MASK,
	acknowledgeAlert,
	createProbe,
	deleteProbe,
	getProbeChannels,
	keptConfig,
	listOpenAlerts,
	listProbes,
	probeHealth,
	probeType,
	putProbeChannels,
	readProbeLimits,
	runAlreadyGoing,
	runOutcome,
	runOutlastedTheWait,
	runProbeNow,
	updateProbe,
	type Probe,
	type ProbeAlert,
	type ProbeChannels,
	type ProbeConfig,
	type ProbeLimits,
} from '$lib/api/synthetic';
import { type Gate, GATE_OK, section, type Section } from '$lib/api/gate';
import { channelsFrom, hasChannels } from '$lib/api/alert-channels';

/** What the notice channels drawer posts its fields under. */
const CHANNEL_PREFIX = 'channel_';

/**
 * The probe the channels drawer is open on, read when the address names it.
 * A refused or failed read is said in the drawer rather than as no channels.
 */
type ChannelsFor = { probe: Probe; read: ProbeChannels | null; gate: Gate } | null;
import { pageOf, pageWindow, pastEndOffset, rowsOf, withOffset } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

const NO_ALERTS: Section<ProbeAlert[]> = { ok: true, value: [] };

/** The probes failing and paused across every probe, when every probe was read. */
interface ProbeCounts {
	failing: number;
	paused: number;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * The interval floor is not here. The plugin holds every write to the floor
 * the install is licensed for and answers it on its limits read, which the
 * form's hint shows, and a write under it is refused with the reason.
 */
const MIN_TIMEOUT_SECONDS = 1;

function positive(raw: FormDataEntryValue | null, fallback: number): number {
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** The type-specific half of a probe, read off the one form that serves all four. */
function configFor(type: string, form: FormData): ProbeConfig {
	const str = (k: string) => String(form.get(k) ?? '').trim();
	switch (type) {
		case 'health_check':
			return { url: str('url'), expected_status: positive(form.get('expected_status'), 200) };
		case 'api_canary':
			return {
				endpoint_base: str('endpoint_base'),
				resource_path: str('resource_path'),
				resource_id_field: str('resource_id_field') || 'id',
			};
		case 'login_flow':
			return {
				login_url: str('login_url'),
				username: str('username'),
				expected_redirect: str('expected_redirect'),
			};
		case 'webhook_delivery':
			return { webhook_url: str('webhook_url') };
		default:
			return {};
	}
}

interface Kept {
	config: ProbeConfig;
	regions?: string[];
	/** The secrets the read masked, which a save without them erases. */
	masked: { password: boolean; auth_token: boolean };
}

/**
 * What an edit read and the form does not show: the stored config and regions
 * the drawer sends back as JSON. The plugin replaces both whole on a save, so
 * anything left out of the body is erased.
 */
function keptFrom(raw: FormDataEntryValue | null): Kept {
	const none: Kept = { config: {}, masked: { password: false, auth_token: false } };
	if (typeof raw !== 'string' || raw === '') return none;
	try {
		const read = JSON.parse(raw) as { config?: ProbeConfig | null; regions?: unknown };
		const regions = Array.isArray(read.regions) ? read.regions.filter((r): r is string => typeof r === 'string') : undefined;
		const masked = { password: read.config?.password === SECRET_MASK, auth_token: read.config?.auth_token === SECRET_MASK };
		return { config: keptConfig(read.config), regions, masked };
	} catch {
		return none;
	}
}

/** The one field each probe type cannot run without. */
const REQUIRED_TARGET: Readonly<Record<string, { field: keyof ProbeConfig; says: string }>> = {
	health_check: { field: 'url', says: 'Enter a URL for the health check.' },
	api_canary: { field: 'endpoint_base', says: 'Enter an endpoint base for the API canary.' },
	login_flow: { field: 'login_url', says: 'Enter a sign-in URL for the probe.' },
	webhook_delivery: { field: 'webhook_url', says: 'Enter a webhook URL for the probe.' },
};

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	const unread = {
		probes: [] as Probe[],
		alerts: NO_ALERTS,
		total: null as number | null,
		limit,
		offset,
		hasMore: false,
		channelsFor: null as ChannelsFor,
		limits: null as ProbeLimits | null,
		counts: null as ProbeCounts | null,
	};
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.syntheticMonitoring)) return { ...unread, gate: { state: 'absent' } as Gate };

	const client = authedClient(event);
	const read = await section(listProbes(client, limit + 1, offset), couldNotLoad('probes'));
	if (!read.ok) return { ...unread, gate: read.gate };

	let probes: Probe[];
	let every: Probe[];
	let counts: ProbeCounts | null = null;
	let total: number | null;
	let hasMore: boolean;
	if (Array.isArray(read.value)) {
		// The plugin answers every probe as a bare array and ignores the
		// window it was asked for, so the page is cut here, and every count
		// covers every probe rather than the rows on this page.
		every = read.value;
		total = read.value.length;
		probes = read.value.slice(offset, offset + limit);
		hasMore = offset + probes.length < total;
		counts = {
			failing: read.value.filter((p) => probeHealth(p) === 'failing').length,
			paused: read.value.filter((p) => probeHealth(p) === 'paused').length,
		};
	} else {
		const page = pageOf(read.value, limit, offset);
		every = page.rows;
		probes = page.rows;
		total = page.total;
		hasMore = page.hasMore;
	}
	const back = pastEndOffset(probes.length, limit, offset, total);
	if (back !== null) redirect(307, withOffset(event.url, back));

	// `?channels=<id>` opens the notice channels drawer on that probe. The
	// channels are a read of their own, so they are asked for only then.
	const channelsId = event.url.searchParams.get('channels');
	const probe = channelsId ? every.find((p) => p.id === channelsId) : undefined;

	const [alerts, channelsFor, limits] = await Promise.all([
		// Alerts are a band above the list. Losing them must not lose the probes,
		// and an unread alert list is never rendered as "nothing is wrong": the
		// band says the read failed.
		section(
			listOpenAlerts(client).then((p) => rowsOf(p)),
			couldNotLoad('open alerts')
		),
		probe
			? section(getProbeChannels(client, probe.id), couldNotLoad('notice channels')).then(
					(r): ChannelsFor => (r.ok ? { probe, read: r.value, gate: GATE_OK } : { probe, read: null, gate: r.gate })
				)
			: null,
		// What a write will accept. Unread, the form says less rather than a
		// floor that may not be this instance's.
		readProbeLimits(client).catch(() => null),
	]);

	return { probes, alerts, total, limit, offset, hasMore, gate: GATE_OK, channelsFor, limits, counts };
};

async function save(event: Parameters<Actions[string]>[0], id: string | null) {
	await requireRole(event, ['admin', 'super_admin']);
	const client = authedClient(event);
	const form = await event.request.formData();

	const name = String(form.get('name') ?? '').trim();
	const type = probeType(String(form.get('type') ?? ''));
	if (!name) return fail(400, { error: 'Enter a name for the probe.', drawer: 'probe' });
	if (!type) return fail(400, { error: 'Choose a probe type.', drawer: 'probe' });

	const kept = id ? keptFrom(form.get('kept')) : keptFrom(null);
	const config: ProbeConfig = { ...kept.config, ...configFor(type, form) };
	// No read returns a stored secret, so a save sends only the one typed here.
	// The plugin replaces the config whole, so a save without it would erase
	// the stored one.
	const secret = String(form.get('secret') ?? '');
	if (!secret && type === 'login_flow' && kept.masked.password) {
		return fail(400, { error: 'Enter the password again to save. The stored password is never shown.', drawer: 'probe' });
	}
	if (!secret && type === 'api_canary' && kept.masked.auth_token) {
		return fail(400, { error: 'Enter the auth token again to save. The stored auth token is never shown.', drawer: 'probe' });
	}
	if (secret && type === 'login_flow') config.password = secret;
	if (secret && type === 'api_canary') config.auth_token = secret;
	const required = REQUIRED_TARGET[type];
	if (required && !config[required.field]) {
		return fail(400, { error: required.says, drawer: 'probe' });
	}

	const interval = positive(form.get('interval_seconds'), 300);
	const timeout = positive(form.get('timeout_seconds'), 10);
	if (timeout < MIN_TIMEOUT_SECONDS || timeout >= interval) {
		return fail(400, { error: 'Enter a timeout shorter than the interval.', drawer: 'probe' });
	}

	const body = {
		name,
		type,
		enabled: form.get('enabled') === 'true',
		config,
		interval_seconds: interval,
		timeout_seconds: timeout,
		alert_threshold: positive(form.get('alert_threshold'), 3),
		...(kept.regions ? { regions: kept.regions } : {}),
	};

	try {
		if (id) await updateProbe(client, id, body);
		else await createProbe(client, body);
	} catch (err) {
		const failed = actionFailure(err, 'Could not save the probe. Try again.');
		return fail(failed.status, { ...failed.data, drawer: 'probe' });
	}
	return { saved: name };
}

export const actions: Actions = {
	create: (event) => save(event, null),

	update: async (event) => {
		const form = await event.request.clone().formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'This form is missing its probe. Reload the page and try again.', drawer: 'probe' });
		return save(event, id);
	},

	delete: asked(
		{
			question: 'Delete this probe?',
			detail: 'Its results and alert history are deleted. This cannot be undone.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			if (!id) return fail(400, { error: 'This form is missing its probe. Reload the page and try again.' });
			try {
				await deleteProbe(client, id);
			} catch (err) {
				return actionFailure(err, 'Could not delete the probe. Try again.');
			}
			return { removed: id };
		},
	),

	run: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'This form is missing its probe. Reload the page and try again.' });
		try {
			const run = runOutcome(await runProbeNow(client, id));
			return { ran: id, status: run.status, ms: run.ms, failed: run.failed, regions: run.regions };
		} catch (err) {
			if (runOutlastedTheWait(err)) return { running: id, already: false };
			if (runAlreadyGoing(err)) return { running: id, already: true };
			return actionFailure(err, 'Could not run the probe. Try again.');
		}
	},

	/** Set where a probe's down and recovery notices go. */
	channels: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'This form is missing its probe. Reload the page and try again.', channels: true });
		const next = channelsFrom(form, CHANNEL_PREFIX);
		let saved: ProbeChannels;
		try {
			saved = await putProbeChannels(authedClient(event), id, hasChannels(next) ? next : null);
		} catch (err) {
			const failed = actionFailure(err, 'Could not save the notice channels. Try again.');
			return fail(failed.status, { ...failed.data, channels: true });
		}
		return { channelsSaved: id, signingSecret: saved.webhook_signing_secret ?? '' };
	},

	acknowledge: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'This form is missing its alert. Reload the page and try again.' });
		try {
			await acknowledgeAlert(client, id);
		} catch (err) {
			return actionFailure(err, 'Could not acknowledge the alert. Try again.');
		}
		return { acknowledged: id };
	},
};
