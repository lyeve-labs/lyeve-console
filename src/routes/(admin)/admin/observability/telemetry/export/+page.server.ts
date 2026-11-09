import type { Actions, PageServerLoad } from './$types';
import { ApiError } from '@lyeve-labs/client';
import { error, fail } from '@sveltejs/kit';
import {
	DESTINATION_HEADERS_REQUIRED,
	DESTINATION_KINDS,
	RESERVED_HEADERS,
	headerNameIsSound,
	listExporters,
	readDestination,
	removeDestination,
	saveDestination,
	triggerExport,
	type DestinationKind,
	type DestinationRead,
	type ExporterHealth,
	type SaveDestination,
} from '$lib/api/telemetry';
import { errorCodeOf } from '$lib/api/limits';
import { refusalOf, refusalText } from '$lib/api/refusal';
import { actionError, actionFailure } from '$lib/server/action-error';
import { forbiddenText, section, type Section } from '$lib/api/gate';
import { authedClient, loadUser, requireRole } from '$lib/server/authz';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

const READERS = ['admin', 'super_admin'];

/**
 * What the export tab renders.
 *
 * The exporters are the instance's export configuration, so they are read
 * for a super admin only and are null, not a section, for anyone else: a
 * tenant admin's page carries no exporters section at all rather than an
 * empty one.
 */
export interface TelemetryExportPage {
	superAdmin: boolean;
	/** null for a tenant admin, who has no exporters section. */
	exporters: Section<ExporterHealth[]> | null;
	/** The tenant's own destination. */
	destination: Section<DestinationRead>;
}

export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	if (!user.roles.some((r) => READERS.includes(r))) {
		error(403, forbiddenText('this page', READERS));
	}
	const superAdmin = user.roles.includes('super_admin');
	const client = authedClient(event);

	const [exporters, destination] = await Promise.all([
		superAdmin
			? section(listExporters(client), couldNotLoad('exporters'))
			: Promise.resolve(null),
		section(readDestination(client), couldNotLoad('the destination')),
	]);

	const page: TelemetryExportPage = { superAdmin, exporters, destination };
	return page;
};

/** The most headers a destination carries, as the plugin bounds them. */
const MAX_HEADERS = 16;

/** Which destination write failed, so each form shows only its own failure. */
type DestinationAction = 'save' | 'remove';

/**
 * A destination write's failure, under keys of its own so it never shows in
 * the exporters' section. A 402 carries the refusal for the form's notice.
 */
function destinationFailure(action: DestinationAction, err: unknown, fallback: string) {
	const refused = refusalOf(err);
	if (refused) return fail(402, { destinationAction: action, destinationError: refusalText(refused), refused });
	// The plugin keeps stored headers only while the URL keeps its host, so
	// a key is never sent somewhere the caller just chose.
	if (errorCodeOf(err) === DESTINATION_HEADERS_REQUIRED) {
		return fail(422, { destinationAction: action, destinationError: actionError(err, fallback), hostMoved: true });
	}
	return fail(400, { destinationAction: action, destinationError: actionError(err, fallback) });
}

/** A save refused before the round trip. */
function saveRefused(destinationError: string) {
	return fail(400, { destinationAction: 'save' as const, destinationError });
}

export const actions: Actions = {
	saveDestination: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const data = await event.request.formData();
		const kind = String(data.get('kind') ?? '') as DestinationKind;
		const url = String(data.get('url') ?? '').trim();
		if (!DESTINATION_KINDS.some((k) => k.value === kind)) {
			return saveRefused('Choose OTLP or Pushgateway.');
		}
		let parsed: URL | null = null;
		try {
			parsed = new URL(url);
		} catch {
			parsed = null;
		}
		if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || url.length > 2048) {
			return saveRefused('Enter a full http or https URL.');
		}
		if (parsed.username || parsed.password) {
			return saveRefused('Put credentials in a header, not in the URL.');
		}

		const body: SaveDestination = { kind, url };
		if (data.get('headers_mode') === 'replace') {
			const names = data.getAll('header_name').map((v) => String(v).trim());
			const values = data.getAll('header_value').map((v) => String(v));
			const headers: Record<string, string> = {};
			for (const [i, name] of names.entries()) {
				if (!name) continue;
				if (!headerNameIsSound(name)) {
					return saveRefused(`${name} is not a header name.`);
				}
				if (RESERVED_HEADERS.includes(name.toLowerCase())) {
					return saveRefused(`${name} is set by the exporter itself.`);
				}
				if (/[\r\n]/.test(values[i] ?? '')) {
					return saveRefused('Enter each header value on a single line.');
				}
				headers[name] = values[i] ?? '';
			}
			if (Object.keys(headers).length > MAX_HEADERS) {
				return saveRefused(`Enter at most ${MAX_HEADERS} headers.`);
			}
			body.headers = headers;
		}

		try {
			await saveDestination(authedClient(event), body);
		} catch (err) {
			return destinationFailure('save', err, 'Could not save the destination. Try again.');
		}
		return { savedDestination: true };
	},

	// Removing a destination is always allowed.
	removeDestination: asked(
		{
			question: 'Delete this destination?',
			detail: "This tenant's series stop being pushed there, and its stored headers are deleted.",
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			try {
				await removeDestination(authedClient(event));
			} catch (err) {
				return destinationFailure('remove', err, 'Could not delete the destination. Try again.');
			}
			return { removedDestination: true };
		},
	),

	export: async (event) => {
		await requireRole(event, ['super_admin']);
		const data = await event.request.formData();
		const name = String(data.get('name') ?? '').trim();
		if (!name) return fail(400, { name, error: 'Choose an exporter.' });
		try {
			const result = await triggerExport(authedClient(event), name);
			return { name, exported: true, message: result?.message ?? `Export started for ${name}.` };
		} catch (err) {
			if (err instanceof ApiError && err.status === 429) {
				return fail(429, { name, error: `${name} exported a moment ago. Wait five seconds and try again.` });
			}
			const failed = actionFailure(err, `Could not export ${name}. Try again.`);
			return fail(failed.status, { ...failed.data, name });
		}
	},
};
