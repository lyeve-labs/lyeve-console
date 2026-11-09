import { error, type RequestEvent } from '@sveltejs/kit';
import { authedClient } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning, type PluginSet } from '$lib/plugins';
import { forbiddenText, GATE_OK, gateOf, type Gate } from '$lib/api/gate';
import { getCustomization, type Customization, type CustomizationSettings } from '$lib/api/customization';

/*
 * What the four customization tabs share. Brand, Menu and Dashboard write
 * one settings document, and every tab opens on the same read of it.
 */

const CUSTOMIZERS = ['admin', 'super_admin'];
const ROLES = ['viewer', 'editor', 'admin'];

/**
 * The customization read a tab starts from. `custom` is null while the
 * multitenant plugin does not run, when the read failed, and when this
 * tenant may not shape its admin, and `gate` says which.
 */
export async function openTab(
	event: RequestEvent,
	user: { roles: string[] },
	plugins: PluginSet | null | undefined,
): Promise<{ gate: Gate; custom: Customization | null }> {
	if (!user.roles.some((r) => CUSTOMIZERS.includes(r))) error(403, forbiddenText('this page', CUSTOMIZERS));
	// The shell says why the page is unavailable while the plugin does not run.
	if (notRunning(plugins, PLUGIN.multitenant)) return { gate: GATE_OK, custom: null };
	// Read fresh rather than from the shell, so a save shows what the engine
	// stored and not what the layout read before it. The plugin's answer also
	// says whether this tenant may shape its admin at all.
	// A failed read is drawn as its gate, never as a tenant that may not
	// customize or as settings that are empty.
	try {
		const custom = await getCustomization(authedClient(event));
		return { gate: GATE_OK, custom: custom.entitled ? custom : null };
	} catch (err) {
		return { gate: gateOf(err, 'Could not load customization.'), custom: null };
	}
}

/** The settings as stored now, which a save changes one part of. */
export async function current(event: RequestEvent): Promise<CustomizationSettings> {
	return (await getCustomization(authedClient(event))).settings;
}

/** The roles a link or a page is shown to, as the form posted them. */
export function roleList(form: FormData): string[] {
	return form
		.getAll('roles')
		.map(String)
		.filter((r) => ROLES.includes(r));
}
