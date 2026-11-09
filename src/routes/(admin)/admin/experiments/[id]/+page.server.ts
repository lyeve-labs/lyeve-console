import type { PageServerLoad, Actions } from './$types';
import { error, fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { readError } from '$lib/server/read-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { ApiError } from '@lyeve-labs/client';
import {
	EXPERIMENTS_URL,
	METRIC_TYPES,
	createMetric,
	createVariant,
	deleteMetric,
	deleteVariant,
	listMetrics,
	listVariants,
	readResults,
	type Experiment,
	type ExperimentResults,
	type Metric,
	type MetricType,
	type Variant,
} from '$lib/api/ab-testing';
import { type Gate, GATE_OK, section } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

function metricType(value: string): MetricType | null {
	return METRIC_TYPES.includes(value as MetricType) ? (value as MetricType) : null;
}

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.abTesting)) error(404, 'No such experiment');

	const client = authedClient(event);
	const id = event.params.id;

	let experiment: Experiment;
	try {
		experiment = await client.get<Experiment>(`${EXPERIMENTS_URL}/${encodeURIComponent(id)}`);
	} catch (err) {
		// The page has nothing to draw without the experiment, and a plugin this
		// instance is not enabled for is not an experiment that is missing.
		if (err instanceof ApiError && err.status === 402) error(402, 'A/B testing is not enabled on this engine.');
		readError(err, 'No such experiment');
	}

	// Each panel is read on its own so one failure does not empty the page,
	// and keeps its failure, so a panel that could not be read never offers
	// to add the first row of a list that may already have rows.
	const [variants, metrics, results] = await Promise.all([
		section<Variant[]>(listVariants(client, id), couldNotLoad('the variants')),
		section<Metric[]>(listMetrics(client, id), couldNotLoad('the metrics')),
		section<ExperimentResults>(readResults(client, id), couldNotLoad('the results')),
	]);

	const gate: Gate = GATE_OK;
	return { experiment, variants, metrics, results, gate };
};

export const actions: Actions = {
	addVariant: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { action: 'addVariant', error: 'Enter a name for the variant.' });

		const share = Number(form.get('traffic_percentage'));
		if (!Number.isFinite(share) || share <= 0 || share > 100) {
			return fail(400, { action: 'addVariant', error: 'Enter a share of traffic above 0 and up to 100.' });
		}

		try {
			await createVariant(client, event.params.id, {
				name,
				description: String(form.get('description') ?? '').trim() || undefined,
				config: String(form.get('config') ?? '').trim() || undefined,
				traffic_percentage: share,
				is_control: form.get('is_control') === 'true',
			});
		} catch (err) {
			return tagged('addVariant', actionFailure(err, 'Could not add the variant. Try again.'));
		}
		return { saved: name };
	},

	removeVariant: asked(
		{
			question: 'Remove this variant?',
			detail: 'Exposures already recorded for it are kept, and the results still count people who saw it.',
			label: 'Remove',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const vid = String(form.get('vid') ?? '');
			if (!vid) return fail(400, { action: 'removeVariant', error: 'This form is missing its variant. Reload the page and try again.' });
			try {
				await deleteVariant(client, event.params.id, vid);
			} catch (err) {
				return tagged('removeVariant', actionFailure(err, 'Could not remove the variant. Try again.'));
			}
			return { removed: vid };
		},
	),

	addMetric: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const name = String(form.get('name') ?? '').trim();
		const eventName = String(form.get('event_name') ?? '').trim();
		const kind = metricType(String(form.get('metric_type') ?? ''));
		if (!name) return fail(400, { action: 'addMetric', error: 'Enter a name for the metric.' });
		if (!eventName) {
			return fail(400, {
				action: 'addMetric',
				error: 'Enter the event name this metric counts.',
			});
		}
		if (!kind) return fail(400, { action: 'addMetric', error: 'Choose a metric type.' });

		try {
			await createMetric(client, event.params.id, {
				name,
				description: String(form.get('description') ?? '').trim() || undefined,
				event_name: eventName,
				metric_type: kind,
			});
		} catch (err) {
			return tagged('addMetric', actionFailure(err, 'Could not add the metric. Try again.'));
		}
		return { saved: name };
	},

	removeMetric: asked(
		{
			question: 'Remove this metric?',
			detail: 'The events it counted stay recorded.',
			label: 'Remove',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const mid = String(form.get('mid') ?? '');
			if (!mid) return fail(400, { action: 'removeMetric', error: 'This form is missing its metric. Reload the page and try again.' });
			try {
				await deleteMetric(client, event.params.id, mid);
			} catch (err) {
				return tagged('removeMetric', actionFailure(err, 'Could not remove the metric. Try again.'));
			}
			return { removed: mid };
		},
	),
};
