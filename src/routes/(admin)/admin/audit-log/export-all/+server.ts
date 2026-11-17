import type { RequestHandler } from './$types';
import { requireRole } from '#lib/server/authz.ts';
import { proxyAuditDownload } from '#lib/server/audit-download.ts';

/**
 * Every tenant. Super admin only, matching the engine's route.
 *
 * It lives under the page rather than under /api/, because a proxy serving
 * the console and the engine on one address sends every /api/ path to the
 * engine.
 */
export const POST: RequestHandler = async (event) => {
	await requireRole(event, ['super_admin']);
	return proxyAuditDownload(event, '/api/admin/audit-log/export-all', 'audit-log-all-tenants.json');
};
