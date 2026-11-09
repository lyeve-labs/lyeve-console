/**
 * Which plugins this instance runs, and where the license module sends an
 * operator.
 *
 * The layout reads the entitlements, the running plugins and what the license
 * module serves on every load and provides this once. A component deep inside
 * a page, a locked state for one, asks it rather than taking the layout's data
 * through every prop on the way down. It is context rather than module state
 * for the reason shell.svelte.ts gives: a module is one object for every
 * request the server renders.
 */
import { getContext, setContext } from 'svelte';
import { linkOf, REL, type Licensing } from '$lib/api/license';
import { hasLicenseModule, type LicenseEntitlements } from '$lib/entitlements';
import { linkHref } from '$lib/links';
import { runs, UNREAD, type PluginSet } from '$lib/plugins';

/** A link the instance offers. */
export interface InstanceLink {
	href: string;
	/** The words to show, when whatever serves the link names them. */
	label?: string;
}

export interface Instance {
	/** Whether a plugin runs for the signed-in tenant. */
	serves(plugin: string): boolean;
	/**
	 * Where a feature this instance does not serve is turned on. The link the
	 * engine sent with a refusal or a plugin's status comes first when it is
	 * safe to follow, and the license module's upgrade link after it. The words
	 * are the module's whenever it serves an upgrade link. Null when nothing
	 * says where.
	 */
	upgradeLink(sent?: string | null): InstanceLink | null;
	/** Where to ask for help with this instance, as the license module serves it. Null without one. */
	supportLink(): InstanceLink | null;
	/** Whether the engine says it links a license module, the part that serves the license page. */
	licenseModule(): boolean;
}

const INSTANCE_KEY = Symbol('lyeve-console-instance');

/** What the layout read that the instance answers from. */
export interface InstanceSource {
	entitlements?: LicenseEntitlements | null;
	plugins?: PluginSet | null;
	/** What the license module serves. Absent or empty on an engine that links none. */
	licensing?: Licensing | null;
}

type Read = () => InstanceSource | null | undefined;

/** The instance as the layout's reads describe it, read afresh on every call. */
export function instanceFrom(read: Read): Instance {
	return {
		// Without a set, nothing is known to run.
		serves: (plugin) => runs(read()?.plugins ?? UNREAD, plugin),
		upgradeLink: (sent) => {
			const served = linkOf(read()?.licensing, REL.upgrade);
			const href = linkHref(sent) ?? served?.href;
			if (!href) return null;
			// The module's label names its own page, so it goes only with that page.
			return href === served?.href ? { href, label: served.label } : { href };
		},
		supportLink: () => {
			const served = linkOf(read()?.licensing, REL.support);
			return served ? { href: served.href, label: served.label } : null;
		},
		licenseModule: () => hasLicenseModule(read()?.entitlements),
	};
}

/** The layout calls this once, with a reader of its own load's data. */
export function provideInstance(read: Read): Instance {
	const instance = instanceFrom(read);
	setContext(INSTANCE_KEY, instance);
	return instance;
}

/**
 * A component calls this while it is set up. Outside the layout, as under a
 * unit test, it answers for an instance that runs nothing, links no license
 * module and so offers no link.
 */
export function useInstance(): Instance {
	return getContext<Instance | undefined>(INSTANCE_KEY) ?? instanceFrom(() => null);
}
