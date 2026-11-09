import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getSchemas, listTenants } from '@lyeve-labs/client-rest';
import { authedClient, loadUser } from '$lib/server/authz';
import { section, type Section } from '$lib/api/gate';
import { pageNumber, pageOffset, pastEndOffset, rowsOf, statedTotal, withOffset } from '$lib/api/list';
import { listActivity, readActivityFilter, type ActivityRow } from '$lib/api/content-history';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { couldNotLoad } from '$lib/outage';

const PAGE_SIZE = 50;

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const user = await loadUser(event);
	const { plugins } = await event.parent();
	const client = authedClient(event);
	const superAdmin = user.roles.includes('super_admin');

	const asked = Math.max(0, Number(url.searchParams.get('offset')) || 0);
	const offset = pageOffset(pageNumber(asked, PAGE_SIZE), PAGE_SIZE);
	const filter = readActivityFilter(url);
	// A super admin reads every tenant's activity, narrowed to one when the
	// address names it. Everyone else reads their own tenant's.
	const tenant = superAdmin ? (url.searchParams.get('tenant_id') ?? '').trim() : undefined;

	const [read, schemas, tenants] = await Promise.all([
		section(
			listActivity(client, filter, PAGE_SIZE, offset, tenant).then((res) => ({
				rows: rowsOf<ActivityRow>(res),
				stated: statedTotal<ActivityRow>(res),
			})),
			couldNotLoad('content activity'),
		),
		section(
			getSchemas(client).then((rows) => rows.map((s) => ({ name: s.name, label: s.display_name || s.name }))),
			couldNotLoad('the content types for the filter', { reload: true }),
		),
		superAdmin && !notRunning(plugins, PLUGIN.multitenant)
			? section(
					listTenants(client, 500, 0).then((r) =>
						// Activity rows name their tenant by slug, the way the session does.
						(Array.isArray(r?.items) ? r.items : []).map((t) => ({ slug: t.slug, label: t.name || t.slug })),
					),
					couldNotLoad('the tenants for the filter', { reload: true }),
				)
			: Promise.resolve<Section<{ slug: string; label: string }[]>>({ ok: true, value: [] }),
	]);

	if (!read.ok) {
		return { activity: read, total: null, offset, limit: PAGE_SIZE, filter, tenant: tenant ?? null, superAdmin, schemas, tenants };
	}
	const back = pastEndOffset(read.value.rows.length, PAGE_SIZE, offset, read.value.stated);
	if (back !== null) redirect(307, withOffset(url, back));

	const total = Math.max(read.value.stated ?? 0, offset + read.value.rows.length);
	const activity: Section<ActivityRow[]> = { ok: true, value: read.value.rows };
	return { activity, total, offset, limit: PAGE_SIZE, filter, tenant: tenant ?? null, superAdmin, schemas, tenants };
};
