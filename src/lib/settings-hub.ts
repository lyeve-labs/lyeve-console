/**
 * The settings hub: every settings page, grouped by what the reader came to
 * change, with a line saying what each one holds.
 *
 * The hub owns no content of its own. Anything it carried would be a second
 * copy of something another page owns, such as the content API and its tokens
 * on API access or the theme on Your account, so the hub only points.
 *
 * Which entries a reader sees is not decided here. An instance entry is shown
 * when the sidebar would show it, read from the tree `adminNav` built for the
 * reader's roles and this instance's plugins, so the hub and the sidebar
 * cannot disagree about who may open a page. Only the personal pages, which
 * have no sidebar row, are listed on their own terms: the account page always,
 * and each of the others while the plugin behind it runs.
 */
import type { NavNode, NavTree } from '@lyeve-labs/ui-kit';
import { Link2, MonitorSmartphone, ShieldCheck, UserRound } from '@lucide/svelte';

export interface HubEntry {
	id: string;
	label: string;
	href: string;
	description: string;
	icon?: NavNode['icon'];
}

export interface HubGroup {
	id: string;
	label: string;
	description: string;
	entries: HubEntry[];
}

/** What each sidebar entry holds, in the words the hub shows under it. */
const DESCRIBE: Readonly<Record<string, string>> = {
	customization: "Set this tenant's name, logo, colors, dashboard and menu, and add pages of its own.",
	localization: 'Choose the languages for content and the order a missing translation falls back through.',
	email: 'Set up the mail providers and the fallback transport behind them.',
	recommendations: 'Set up similar entries, trending entries and a feed for each reader, based on what readers do.',
	permissions: 'Set what each role can do with content and flows, for every content type, one content type or one flow.',
	security: 'See what protects this engine.',
	oauth: 'Add the OpenID Connect and OAuth 2.0 providers people can sign in with.',
	saml: 'Add the SAML identity providers people sign in through, and manage their certificates.',
	scim: 'Let identity providers create and remove accounts without anyone signing in.',
	'rate-limits': 'See each rate limit and who is close to reaching one.',
	'tenant-rate-limits': "Set this tenant's rate limit and the addresses it always allows or blocks, and see what was refused.",
	captcha: "Choose the captcha this tenant's pages and flows use. The console sign-in keeps this engine's captcha.",
	'sign-in': 'Set how long accounts from your identity provider can sign in without it.',
	'api-access': 'See how external apps authenticate and what each role can do, and get a token to try it.',
	'api-keys': 'Create machine-to-machine credentials for the content API and see their usage.',
	'admin-tokens': 'Create scoped, expiring credentials for scripts that call the admin API, and see what each one did.',
	grpc: 'See where the gRPC listener runs and which services it serves.',
	graphql: 'See the schema generated from your content types, its endpoint and the allowed queries.',
	'message-broker': 'Choose where content events are published, and check that they arrive.',
	storage: 'Choose where uploads are stored and which provider receives them.',
	'content-history': 'Choose which content types keep versions and for how long, and see who changed what.',
	residency: "See the regions this engine runs in and which tenant's data is stored in each.",
	gdpr: 'Export or erase every piece of personal data held about one person.',
	pii: 'Choose what is redacted from responses and logs, and see who viewed it unmasked.',
	privacy: "Choose what an erasure does with this tenant's form submissions and what people get when they export their data.",
	license: 'See the license this engine runs on and activate a new key.',
	configuration: 'See every setting the engine uses and the layer each value came from.',
	'config-sync': 'Export this configuration as one bundle, or compare, dry run and apply a bundle from another engine.',
};

/** The instance groups, by purpose, each naming sidebar entries by id. */
const GROUPS: readonly { id: string; label: string; description: string; ids: readonly string[] }[] = [
	{
		id: 'workspace',
		label: 'Tenant',
		description: 'Set how the console looks and what it offers your team.',
		ids: ['customization', 'localization', 'email', 'recommendations'],
	},
	{
		id: 'access',
		label: 'Sign-in and access',
		description: 'Choose who can sign in and how, and what each role can do.',
		ids: ['permissions', 'security', 'sign-in', 'oauth', 'saml', 'scim', 'rate-limits', 'tenant-rate-limits', 'captcha'],
	},
	{
		id: 'apis',
		label: 'APIs and delivery',
		description: 'Connect other systems to your content and its change events.',
		ids: ['api-access', 'api-keys', 'admin-tokens', 'grpc', 'graphql', 'message-broker'],
	},
	{
		id: 'data',
		label: 'Data and compliance',
		description: 'Choose where data is stored and how long it is kept, and find what an auditor asks for.',
		// Retention is a tab of the audit log, beside the entries the policies
		// delete and the holds protect.
		ids: ['storage', 'content-history', 'residency', 'gdpr', 'privacy', 'pii'],
	},
	{
		id: 'instance',
		label: 'Engine',
		description: 'Manage the license and the engine settings, and move settings between engines.',
		ids: ['license', 'configuration', 'config-sync'],
	},
];

function leaves(tree: NavTree): Map<string, NavNode> {
	const out = new Map<string, NavNode>();
	const walk = (nodes: NavTree) => {
		for (const node of nodes) {
			if (node.href !== undefined) out.set(node.id, node);
			if (node.children) walk(node.children);
		}
	};
	walk(tree);
	return out;
}

/** Which of the personal pages the instance can serve, by whether each one's plugin runs. */
export interface PersonalPages {
	twoFactor: boolean;
	trustedDevices: boolean;
	connectedEditors: boolean;
}

/**
 * The hub for one reader: their own pages first, then every instance group
 * that holds at least one page the reader's sidebar offers.
 */
export function settingsHub(tree: NavTree, personal: PersonalPages): HubGroup[] {
	const byId = leaves(tree);
	const account: HubGroup = {
		id: 'account',
		label: 'Your account',
		description: 'Change your own settings, whatever your role.',
		entries: [
			{ id: 'account', label: 'Account and appearance', href: '/admin/settings/account', icon: UserRound, description: 'See your email and roles, and choose your color scheme.' },
			...(personal.twoFactor
				? [{ id: 'mfa', label: 'Two-factor authentication', href: '/admin/settings/mfa', icon: ShieldCheck, description: 'Add a second sign-in step with an authenticator app, and manage your recovery codes.' }]
				: []),
			...(personal.trustedDevices
				? [{ id: 'devices', label: 'Trusted devices', href: '/admin/settings/devices', icon: MonitorSmartphone, description: 'Trust the devices you sign in from to lower their sign-in risk score, and forget any you no longer use.' }]
				: []),
			...(personal.connectedEditors
				? [{ id: 'connected-editors', label: 'Builder connections', href: '/admin/settings/connected-editors', icon: Link2, description: 'Approve and revoke the browsers that edit pages from the builder.' }]
				: []),
		],
	};
	const groups = GROUPS.map((g) => ({
		id: g.id,
		label: g.label,
		description: g.description,
		entries: g.ids.flatMap((id): HubEntry[] => {
			const node = byId.get(id);
			if (!node?.href) return [];
			return [
				{
					id,
					label: node.label,
					href: node.href,
					description: DESCRIBE[id] ?? '',
					icon: node.icon,
					// No badge. A page's own header carries its beta mark, and a
					// mark on the way to a page would single out some of the pages
					// that are equally beta.
				},
			];
		}),
	})).filter((g) => g.entries.length > 0);
	return [account, ...groups];
}
