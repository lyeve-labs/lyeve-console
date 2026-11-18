import { authedClient, loadUser } from '#lib/server/authz.ts';
import type { LayoutServerLoad } from './$types';
import { getEntitlements, getPluginStatus, type PluginStatusReport } from '@lyeve-labs/client-rest';
import { NO_ENTITLEMENTS, type LicenseEntitlements } from '#lib/entitlements.ts';
import { MIGRATIONS_DEPENDENCY, pendingMigrations, type PendingStatement } from '#lib/api/migrate.ts';
import { getCustomization, NO_CUSTOMIZATION, type Customization } from '#lib/api/customization.ts';
import { brandOf } from '#lib/brand.ts';
import { NO_LICENSING, readLicensing } from '#lib/api/license.ts';
import { readRunningPlugins, runningFromStatus, type RunningRead } from '#lib/api/plugins-running.ts';
import { PLUGIN } from '#lib/plugin-names.ts';
import { notRunning, pluginSetOf } from '#lib/plugins.ts';
import { SIDEBAR_COOKIE, sidebarChoice } from '#lib/sidebar-choice.ts';

/**
 * Roles the engine lets read and apply the DDL queue. The queue holds every
 * tenant's pending drops on tables they share, so it is the super admin's.
 */
const MIGRATOR_ROLES = ['super_admin'];

/** Roles the engine gives the plugin status report and the entitlements to. */
const OPERATOR_ROLES = ['admin', 'super_admin'];

/**
 * What the shell knows about the DDL log: the count and the statements, the
 * count null inside it when the engine did not answer, and null instead of it
 * for a session that could not apply a migration anyway.
 */
export type MigrationStatus = { pending: number | null; items: PendingStatement[] } | null;

export const load: LayoutServerLoad = async (event) => {
	// Only an engine that says the session is over ends it here. One that
	// cannot check it throws the outage page, and the cookie outlives the blip.
	const user = await loadUser(event);
	const authed = authedClient(event);

	/*
	 * The shell's reads, in two rounds.
	 *
	 * The first says what the instance is. Which plugins run decides which
	 * plugin pages exist at all, for every role. An operator reads the
	 * entitlements, which decide the license's answers, and the plugin status,
	 * which says why a plugin does not run, so a page reached by its URL can
	 * say so. The engine refuses both to every other role, so nobody else is
	 * asked for them, and their entitlements read as no features, as a failed
	 * read does.
	 *
	 * The running list is the status report's serving plugins less what the
	 * entitlements withhold from this tenant. An operator who read both has
	 * that answer already and reads the list only when either read failed.
	 * Everybody else reads the list.
	 *
	 * The second round asks only the parts that are there. The migration count
	 * is the schema plugin's and the tenant's frame is the multitenant
	 * plugin's, so an engine without them is not asked for either. The links
	 * and the renewal belong to the license module, and the entitlements say
	 * whether the build links one.
	 *
	 * The load reads no url and no params, so SvelteKit keeps the shell's data
	 * across a client-side navigation and asks the engine again on a fresh
	 * document or after a write invalidates. A page load that awaits parent()
	 * runs all of it again on the server, so a page that wants only the account
	 * reads it with loadUser, which asks once per request.
	 */
	const operator = user.roles.some((role) => OPERATOR_ROLES.includes(role));
	const [read, status, listed] = await Promise.all([
		operator
			? getEntitlements(authed).catch((): LicenseEntitlements | null => null)
			: Promise.resolve<LicenseEntitlements | null>(null),
		operator
			? getPluginStatus(authed).catch((): PluginStatusReport | null => null)
			: Promise.resolve<PluginStatusReport | null>(null),
		operator ? Promise.resolve<RunningRead | null>(null) : readRunningPlugins(authed),
	]);
	const entitlements = read ?? NO_ENTITLEMENTS;
	const withheld = entitlements.withheld ?? [];
	const running: RunningRead =
		listed ??
		(status && Array.isArray(read?.withheld) ? runningFromStatus(status, withheld) : await readRunningPlugins(authed));
	const plugins = pluginSetOf({ running, status, operator, withheld });

	/*
	 * A session that cannot apply a migration is not asked about one. The apply
	 * endpoint is super_admin only, so for anyone else the count would cost a
	 * request per page load and a control they would be refused.
	 */
	const canMigrate = user.roles.some((role) => MIGRATOR_ROLES.includes(role));
	if (canMigrate) event.depends(MIGRATIONS_DEPENDENCY);
	const [migrations, customization, licensing] = await Promise.all([
		canMigrate && !notRunning(plugins, PLUGIN.schema)
			? // An engine that does not answer leaves the count unknown, which the
				// chip says out loud. Reading a failure as zero would paint it green
				// and claim the database is in step with schemas nobody checked.
				pendingMigrations(authed)
					.then((read): MigrationStatus => read)
					.catch((): MigrationStatus => ({ pending: null, items: [] }))
			: Promise.resolve<MigrationStatus>(null),
		// The tenant's own frame: name, logo, accent, menu and pages. A failed
		// read is the stock admin, never a broken one.
		notRunning(plugins, PLUGIN.multitenant)
			? Promise.resolve(NO_CUSTOMIZATION)
			: Promise.resolve()
					.then(() => getCustomization(authed))
					.catch((): Customization => NO_CUSTOMIZATION),
		// Every role asks, because the support link sits in every reader's
		// account menu and the entitlements are refused below admin. Only an
		// engine that says it links no license module is spared the request.
		// One without the route answers 404, which reads as no links.
		entitlements.license_module === false ? Promise.resolve(NO_LICENSING) : readLicensing(authed),
	]);

	// The session tenant's brand, in the shape every page reads it in. It
	// replaces the public copy the root layout would read by address.
	const brand = brandOf(customization.settings.brand);

	const sidebarCollapsed = sidebarChoice(event.cookies.get(SIDEBAR_COOKIE));

	return { user, entitlements, plugins, pluginStatus: status, migrations, customization, licensing, brand, sidebarCollapsed };
};
