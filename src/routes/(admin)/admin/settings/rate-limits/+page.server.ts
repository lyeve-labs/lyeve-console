import { readRouteOptions, routeOptions } from '$lib/api/route-options';
import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	createRule,
	deleteRule,
	endpointIsSound,
	listRules,
	readOverview,
	resetProtection,
	roleIsSound,
	setProtection,
	updateGlobal,
	updateRule,
	type RateLimitOverview,
	type RateRule,
} from '$lib/api/rate-limit';
import { type Gate, GATE_OK, section, type Section } from '$lib/api/gate';
import { pageOf, pageWindow, pastEndOffset, withOffset, type PagedList } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** The longest window a protection may take, in minutes: one day. */
const MAX_WINDOW_MINUTES = 1440;

function num(raw: FormDataEntryValue | null): number {
	const n = Number(raw);
	return Number.isFinite(n) ? n : Number.NaN;
}

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);
	const superAdmin = user?.roles?.includes('super_admin') ?? false;

	const client = authedClient(event);
	// The shell says why the page is unavailable while its plugin does not run.
	// The global limit and the protections have sections of their own, so the
	// list, and its total, is the custom rules alone.
	const read: Section<PagedList<RateRule>> = notRunning(plugins, PLUGIN.rateLimit)
		? { ok: false, gate: { state: 'absent' } }
		: await section(
				listRules(client, limit + 1, offset, 'custom').then((res) => pageOf(res, limit, offset)),
				couldNotLoad('the rate limit rules'),
			);
	const gate: Gate = read.ok ? GATE_OK : read.gate;
	const page = read.ok ? read.value : null;
	// An offset past the last rule draws the empty state, which would say no
	// rule is configured. A failed read is never redirected.
	const back = page ? pastEndOffset(page.rows.length, limit, offset, page.total) : null;
	if (back !== null) redirect(307, withOffset(event.url, back));

	// The overview says whether custom rules are enabled, which only the engine
	// can answer: a missing read is shown as unknown, never as locked or
	// unlocked.
	let overview: RateLimitOverview | null = null;
	if (gate.state === 'ok') {
		overview = await readOverview(client).catch(() => null);
	}

	// The routes the instance serves, to pick a rule's endpoint from. The
	// document is read as the caller: an admin gets the public routes, a super
	// admin every route. Missing, the field still takes a typed pattern.
	const routes = gate.state === 'ok' ? await readRouteOptions(client) : routeOptions(null);

	return {
		routes,
		rules: page?.rows ?? [],
		total: page?.total ?? null,
		limit,
		offset,
		hasMore: page?.hasMore ?? false,
		overview,
		superAdmin,
		gate,
	};
};

async function save(event: Parameters<Actions[string]>[0], id: string | null) {
	const user = await requireRole(event, ['admin', 'super_admin']);
	const client = authedClient(event);
	const form = await event.request.formData();

	const endpoint = String(form.get('endpoint') ?? '').trim();
	if (!endpointIsSound(endpoint)) {
		return fail(400, {
			action: 'rule',
			error: 'Enter * for every request, or a method and a path, such as GET /api/v1/content/{schema}. A segment can be a {name} placeholder, and the last one can be *.',
		});
	}

	const rate = num(form.get('rate'));
	const burst = Math.floor(num(form.get('burst')));
	if (!Number.isFinite(rate) || rate <= 0) {
		return fail(400, { action: 'rule', error: 'Enter a rate above zero, in requests per second.' });
	}
	if (!Number.isFinite(burst) || burst < 1) {
		return fail(400, { action: 'rule', error: 'Enter a burst of at least one request.' });
	}

	const role = String(form.get('role') ?? '').trim();
	if (role && !roleIsSound(role)) {
		return fail(400, { action: 'rule', error: 'A role is 1 to 64 letters, digits or _ . : -' });
	}
	const keyBy = form.get('key_by') === 'user' ? 'user' : 'ip';

	const body: Parameters<typeof createRule>[1] = {
		endpoint,
		rate,
		burst,
		enabled: form.get('enabled') === 'true',
		// An empty role clears it, so the rule applies to every caller. On an
		// edit the plugin reads null as "keep the stored role" and an empty
		// string as a clear, so the clear goes as an empty string.
		role,
		key_by: keyBy,
	};
	// Only a super_admin can place a rule on another tenant or on every
	// tenant. The engine files anyone else's rule under their own tenant
	// whatever the form says, so the field is neither shown nor sent.
	if (user.roles.includes('super_admin')) {
		const tenant = String(form.get('tenant_id') ?? '').trim();
		// On create an empty tenant means every tenant, sent as null so the
		// engine stores the scope the form showed. On an edit the plugin reads
		// an absent or null tenant as "keep", so only a named tenant is sent,
		// which moves the rule there.
		if (!id) body.tenant_id = tenant || null;
		else if (tenant) body.tenant_id = tenant;
	}

	try {
		if (id) await updateRule(client, id, body);
		else await createRule(client, body);
	} catch (err) {
		return tagged('rule', actionFailure(err, 'Could not save the rule. Try again.'));
	}
	return { saved: endpoint };
}

export const actions: Actions = {
	create: (event) => save(event, null),

	update: async (event) => {
		const form = await event.request.clone().formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'rule', error: 'This form is missing its rule. Reload the page and try again.' });
		return save(event, id);
	},

	delete: asked(
		{
			question: 'Delete this rule?',
			detail: 'If the rule is enforced, its endpoint stops being limited by it immediately.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			if (!id) return fail(400, { action: 'delete', error: 'This form is missing its rule. Reload the page and try again.' });
			try {
				await deleteRule(client, id);
			} catch (err) {
				return tagged('delete', actionFailure(err, 'Could not delete the rule. Try again.'));
			}
			return { removed: id };
		},
	),

	global: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const rate = num(form.get('rate'));
		const burst = Math.floor(num(form.get('burst')));
		if (!Number.isFinite(rate) || rate <= 0) {
			return fail(400, { action: 'global', error: 'Enter a rate above zero, in requests per second.' });
		}
		if (!Number.isFinite(burst) || burst < 1) {
			return fail(400, { action: 'global', error: 'Enter a burst of at least one request.' });
		}
		try {
			await updateGlobal(client, { rate, burst, enabled: form.get('enabled') === 'true' });
		} catch (err) {
			return tagged('global', actionFailure(err, 'Could not save the global limit. Try again.'));
		}
		return { savedGlobal: true };
	},

	protection: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '');
		const requests = Math.floor(num(form.get('requests')));
		const minutes = num(form.get('window_minutes'));
		if (!name) return fail(400, { action: 'protection', error: 'This form is missing its protection. Reload the page and try again.' });
		if (!Number.isFinite(requests) || requests < 1 || requests > 100000) {
			return fail(400, {
				action: 'protection',
				error: 'Enter between 1 and 100000 requests. Zero would lock everyone out of signing in.',
			});
		}
		if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_WINDOW_MINUTES) {
			return fail(400, { action: 'protection', error: 'Enter a window of more than zero minutes and at most a day.' });
		}
		try {
			await setProtection(client, {
				name,
				requests,
				window_seconds: Math.max(1, Math.round(minutes * 60)),
			});
		} catch (err) {
			return tagged('protection', actionFailure(err, 'Could not save the protection. Try again.'));
		}
		return { savedProtection: name };
	},

	resetProtection: asked(
		{
			question: 'Reset this protection?',
			detail: 'It returns to its default limit.',
			label: 'Reset',
		},
		async (event) => {
			await requireRole(event, ['super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const name = String(form.get('name') ?? '');
			if (!name) return fail(400, { action: 'resetProtection', error: 'This form is missing its protection. Reload the page and try again.' });
			try {
				await resetProtection(client, name);
			} catch (err) {
				return tagged('resetProtection', actionFailure(err, 'Could not reset the protection. Try again.'));
			}
			return { resetProtection: name };
		},
	),
};
