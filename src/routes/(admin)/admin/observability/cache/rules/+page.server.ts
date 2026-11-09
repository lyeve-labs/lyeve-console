import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	createRule,
	deleteRule,
	listRules,
	parseTags,
	patternIsSound,
	purgeResponses,
	purgeRule,
	tagIsSound,
	updateRule,
	type CacheRule,
	type Limit,
} from '$lib/api/cache';
import { type Gate, GATE_OK, section } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

/** What the response cache rules read answered. */
interface RulesState {
	gate: Gate;
	rows: CacheRule[];
	/** Null when the read did not say. */
	licensed: boolean | null;
	limit: Limit | undefined;
}

/** The longest TTL the form offers: a year. The plugin takes more, and nobody means it. */
const MAX_TTL_SECONDS = 365 * 86400;

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.cache)) {
		const rules: RulesState = { gate: { state: 'absent' }, rows: [], licensed: null, limit: undefined };
		return { rules, gate: { state: 'absent' } as Gate };
	}

	// The rules are the tenant's own, so a refused or failed read says so in
	// their section.
	const read = await section(listRules(authedClient(event)), couldNotLoad('response cache rules'));
	const rules: RulesState = read.ok
		? {
				gate: { state: 'ok' },
				rows: read.value?.data ?? [],
				licensed: typeof read.value?.licensed === 'boolean' ? read.value.licensed : null,
				limit: read.value?.limits?.rules,
			}
		: { gate: read.gate, rows: [], licensed: null, limit: undefined };
	return { rules, gate: GATE_OK as Gate };
};

/** Reads and checks the rule form. A string is the message for a refused one. */
function ruleBody(form: FormData) {
	const pattern = String(form.get('pattern') ?? '').trim();
	if (!patternIsSound(pattern)) {
		return 'Enter a path under /api/v1/, such as /api/v1/content/{schema} or /api/v1/content/posts/**. ** can only come last, and the path cannot include a query.';
	}
	const ttl = Math.floor(Number(form.get('ttl_seconds')));
	if (!Number.isFinite(ttl) || ttl < 1 || ttl > MAX_TTL_SECONDS) {
		return 'Enter a time to live of at least 1 second, as a whole number.';
	}
	const tags = parseTags(String(form.get('tags') ?? ''));
	if (tags.length > 32) return 'Enter at most 32 tags.';
	if (!tags.every(tagIsSound)) return 'Use 1 to 64 letters, digits, dots, dashes or underscores for each tag.';
	return { pattern, ttl_seconds: ttl, tags, enabled: form.get('enabled') === 'true' };
}

async function saveRule(event: Parameters<Actions[string]>[0], id: string | null) {
	await requireRole(event, ['admin', 'super_admin']);
	const client = authedClient(event);
	const form = await event.request.formData();
	const body = ruleBody(form);
	if (typeof body === 'string') return fail(400, { error: body, drawer: 'rule' });
	try {
		if (id) await updateRule(client, id, body);
		else await createRule(client, body);
	} catch (err) {
		const failed = actionFailure(err, 'Could not save the rule. Try again.');
		return fail(failed.status, { ...failed.data, drawer: 'rule' });
	}
	return { savedRule: body.pattern };
}

export const actions: Actions = {
	createRule: (event) => saveRule(event, null),

	updateRule: async (event) => {
		const form = await event.request.clone().formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'This form is missing its rule. Reload the page and try again.', drawer: 'rule' });
		return saveRule(event, id);
	},

	deleteRule: asked(
		{
			question: 'Delete this rule?',
			detail: 'Its cached responses are removed, and the route is served without the cache from the next request.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			if (!id) return fail(400, { error: 'This form is missing its rule. Reload the page and try again.' });
			try {
				await deleteRule(client, id);
			} catch (err) {
				return actionFailure(err, 'Could not delete the rule. Try again.');
			}
			return { removedRule: id };
		},
	),

	// A purge evicts this tenant's cached responses only. Each one is
	// recomputed on its next request, which is the load the confirm names.
	purge: asked(
		{
			question: 'Purge these cached responses?',
			detail: 'Each purged response is computed again on its next request.',
			label: 'Purge',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const rule = String(form.get('rule') ?? '').trim();
			const tag = String(form.get('tag') ?? '').trim();
			if (tag && !tagIsSound(tag)) {
				return fail(400, { error: 'Use 1 to 64 letters, digits, dots, dashes or underscores for the tag.' });
			}
			try {
				const purged = rule ? await purgeRule(client, rule) : await purgeResponses(client, tag);
				return { purged, purgedWhat: rule ? 'rule' : tag ? `tag ${tag}` : 'all' };
			} catch (err) {
				return actionFailure(err, 'Could not purge the cached responses. Try again.');
			}
		},
	),
};
