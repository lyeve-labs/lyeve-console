import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	createRegion,
	deleteRegion,
	listRegions,
	readReport,
	slugIsSound,
	updateRegion,
	type Region,
	type ResidencyReport,
} from '$lib/api/residency';
import { type Gate, GATE_OK, gateOf, section } from '$lib/api/gate';
import { rowsOf } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

/** The most regions the page lists. An instance runs in a handful. */
const REGION_CAP = 100;

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	// Regions and the report are both super admin routes, so anybody else is
	// told rather than shown two failed reads they cannot act on.
	const permitted = user.roles.includes('super_admin');

	// The shell says why the page is unavailable while its plugin does not run.
	const absent = notRunning(plugins, PLUGIN.dataResidency);
	if (absent || !permitted) {
		return {
			regions: [] as Region[],
			more: false,
			report: null as ResidencyReport | null,
			reportGate: GATE_OK as Gate,
			gate: (absent ? { state: 'absent' } : GATE_OK) as Gate,
			permitted,
		};
	}

	const client = authedClient(event);
	let regions: Region[] = [];
	let gate: Gate = GATE_OK;
	// One row past the cap says whether the list was cut.
	let more = false;
	try {
		const rows = rowsOf(await listRegions(client, REGION_CAP + 1, 0));
		more = rows.length > REGION_CAP;
		regions = rows.slice(0, REGION_CAP);
	} catch (err) {
		gate = gateOf(err, couldNotLoad('regions'));
	}

	// The report is the evidence half of this page. An unread report is never
	// rendered as an empty one: a page that shows no unassigned tenants
	// because it could not ask is the worst answer here.
	// The gate says why it is unread, so a role refusal or an outage is not
	// shown as the same failure.
	const report =
		gate.state === 'ok'
			? await section(
					readReport(client),
					'Could not load the residency report.',
				)
			: null;

	return {
		regions,
		more,
		report: report?.ok ? report.value : null,
		reportGate: report && !report.ok ? report.gate : GATE_OK,
		gate,
		permitted,
	};
};

function coordinates(form: FormData): { lat: number; long: number } | undefined {
	const lat = Number(form.get('lat'));
	const long = Number(form.get('long'));
	if (!Number.isFinite(lat) || !Number.isFinite(long)) return undefined;
	if (lat === 0 && long === 0) return undefined;
	return { lat, long };
}

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const slug = String(form.get('slug') ?? '').trim();
		const displayName = String(form.get('display_name') ?? '').trim();
		const provider = String(form.get('provider') ?? '').trim();

		if (!slugIsSound(slug)) {
			return fail(400, {
				action: 'create',
				error: 'Enter a slug of lowercase letters, digits and hyphens that starts with a letter. You cannot change it later.',
			});
		}
		if (!displayName) return fail(400, { action: 'create', error: 'Enter a name for the region.' });
		if (!provider) return fail(400, { action: 'create', error: 'Enter where it runs, such as aws, gcp, azure or on-prem.' });

		// The plugin's create takes no enabled field, refuses a body that
		// names one, and opens every new region. A region asked for closed is
		// created, then closed by an update.
		let created: Region;
		try {
			created = await createRegion(client, {
				slug,
				display_name: displayName,
				provider,
				coordinates: coordinates(form),
				is_default: form.get('is_default') === 'true',
			});
		} catch (err) {
			return tagged('create', actionFailure(err, 'Could not create the region. Try again.'));
		}
		if (form.get('enabled') !== 'true') {
			try {
				await updateRegion(client, created.id, { enabled: false });
			} catch {
				return fail(400, {
					action: 'close',
					error: `Region ${displayName} was created, but it is still accepting new tenants. Clients can see it and are routed to it as their nearest region. Edit it and turn off Accepting new tenants.`,
				});
			}
		}
		return { saved: slug };
	},

	update: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'update', error: 'This form is missing its region. Reload the page and try again.' });

		const displayName = String(form.get('display_name') ?? '').trim();
		const provider = String(form.get('provider') ?? '').trim();
		if (!displayName) return fail(400, { action: 'update', error: 'Enter a name for the region.' });

		// The slug is deliberately not sent. It is denormalized onto every
		// tenant assignment and onto the report, so changing it here would
		// leave those rows naming a region that no longer exists.
		try {
			await updateRegion(client, id, {
				display_name: displayName,
				provider,
				coordinates: coordinates(form),
				enabled: form.get('enabled') === 'true',
				is_default: form.get('is_default') === 'true',
			});
		} catch (err) {
			return tagged('update', actionFailure(err, 'Could not save the region. Try again.'));
		}
		return { saved: displayName };
	},

	delete: asked(
		{
			question: 'Delete this region?',
			detail: 'Tenants in this region are not moved. Move them first, or the report can no longer show where their data is.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			if (!id) return fail(400, { action: 'delete', error: 'This form is missing its region. Reload the page and try again.' });
			try {
				await deleteRegion(client, id);
			} catch (err) {
				return tagged('delete', actionFailure(err, 'Could not delete the region. Try again.'));
			}
			return { removed: id };
		},
	),
};
