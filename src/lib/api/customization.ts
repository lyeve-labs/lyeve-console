/**
 * The admin as one tenant has shaped it: its name, logo, icon and accent, the menu
 * entries it hides, pins and adds, the page it opens on, and pages of its own
 * built from blocks.
 *
 * Every signed-in user reads it, filtered to their roles, because the shell
 * draws its frame from it. The read says whether this tenant may shape its
 * admin at all. When it may not, the read is empty and the stock admin
 * renders. Writing is an admin's, and only where the read says it may.
 */
import type { HttpClient } from '@lyeve-labs/client';
import type { StatusTone } from '@lyeve-labs/ui-kit';

export const ROLE_CHOICES = ['viewer', 'editor', 'admin'] as const;

export interface CustomLink {
	label: string;
	url: string;
	roles?: string[];
}

export interface Brand {
	name: string;
	logo_url: string;
	accent: string;
	welcome: string;
	favicon_url: string;
}

export interface CustomizationSettings {
	brand: Brand;
	menu: { hidden: string[]; pinned: string[]; links: CustomLink[] };
	home_page: string;
}

export interface PageSummary {
	slug: string;
	title: string;
	roles: string[];
	position: number;
}

export type BlockType = 'markdown' | 'callout' | 'content' | 'stats' | 'links';

export interface Block {
	type: BlockType;
	title?: string;
	body?: string;
	/** A callout's Alert tone. The empty string is a block that chose none. */
	tone?: '' | StatusTone;
	schema?: string;
	status?: '' | 'draft' | 'published' | 'archived';
	limit?: number;
	schemas?: string[];
	links?: CustomLink[];
}

export interface CustomPage {
	slug: string;
	title: string;
	description: string;
	roles: string[];
	blocks: Block[];
	position: number;
	updated_at?: string;
}

export interface Customization {
	entitled: boolean;
	settings: CustomizationSettings;
	pages: PageSummary[];
}

export const EMPTY_SETTINGS: CustomizationSettings = {
	brand: { name: '', logo_url: '', accent: '', welcome: '', favicon_url: '' },
	menu: { hidden: [], pinned: [], links: [] },
	home_page: '',
};

export const NO_CUSTOMIZATION: Customization = { entitled: false, settings: EMPTY_SETTINGS, pages: [] };


export async function getCustomization(client: HttpClient): Promise<Customization> {
	const res = await client.get<Customization>('/api/admin/customization');
	return {
		entitled: !!res.entitled,
		settings: {
			brand: { ...EMPTY_SETTINGS.brand, ...(res.settings?.brand ?? {}) },
			menu: {
				hidden: res.settings?.menu?.hidden ?? [],
				pinned: res.settings?.menu?.pinned ?? [],
				links: res.settings?.menu?.links ?? [],
			},
			home_page: res.settings?.home_page ?? '',
		},
		pages: res.pages ?? [],
	};
}

export function saveCustomization(client: HttpClient, settings: CustomizationSettings): Promise<CustomizationSettings> {
	return client.put<CustomizationSettings>('/api/admin/customization', settings);
}

export function getCustomPage(client: HttpClient, slug: string): Promise<CustomPage> {
	return client.get<CustomPage>(`/api/admin/customization/pages/${encodeURIComponent(slug)}`);
}

export function saveCustomPage(client: HttpClient, page: CustomPage): Promise<CustomPage> {
	return client.put<CustomPage>(`/api/admin/customization/pages/${encodeURIComponent(page.slug)}`, page);
}

export function deleteCustomPage(client: HttpClient, slug: string): Promise<unknown> {
	return client.delete(`/api/admin/customization/pages/${encodeURIComponent(slug)}`);
}

/**
 * A block with every field its editor binds, filled.
 *
 * The engine omits an empty field from a stored block, so a block saved with
 * no heading comes back with no `title` at all. The kit's inputs refuse
 * `bind:value={undefined}` where they carry a fallback, and Svelte throws
 * during the mount, so every bound field is filled first.
 */
export function editableBlock(b: Block): Block {
	const out: Block = { ...b, title: b.title ?? '' };
	switch (b.type) {
		case 'markdown':
			return { ...out, body: b.body ?? '' };
		case 'callout':
			return { ...out, body: b.body ?? '', tone: b.tone || 'brand' };
		case 'content':
			return { ...out, schema: b.schema ?? '', status: b.status ?? '', limit: b.limit ?? 5 };
		case 'stats':
			return { ...out, schemas: [...(b.schemas ?? [])] };
		case 'links':
			return { ...out, links: (b.links ?? []).map((l) => ({ ...l, label: l.label ?? '', url: l.url ?? '' })) };
		default:
			return out;
	}
}

/** A page the editor can bind to: a deep copy, with every block filled. */
export function editablePage(p: CustomPage): CustomPage {
	return {
		slug: p.slug,
		title: p.title ?? '',
		description: p.description ?? '',
		roles: [...(p.roles ?? [])],
		blocks: (p.blocks ?? []).map(editableBlock),
		position: p.position ?? 0,
		updated_at: p.updated_at,
	};
}

/** A slug from a title: lower case, hyphens, at most 63 characters. */
export function slugify(title: string): string {
	return title
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 63);
}

/** A #RRGGBB color, or '' when the field is empty. Null when it is neither. */
export function parseAccent(raw: string): string | null {
	const v = raw.trim();
	if (v === '') return '';
	return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
}

type RGB = [number, number, number];

function rgbOf(hex: string): RGB {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexOf(c: RGB): string {
	return '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** a moved toward b by w, 0 to 1. */
function mixHex(a: string, b: string, w: number): string {
	const x = rgbOf(a);
	const y = rgbOf(b);
	return hexOf([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * w) as RGB);
}

function luminance(hex: string): number {
	const lin = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	const [r, g, b] = rgbOf(hex);
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The WCAG contrast ratio between two colors, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The floor brand text and the label on a brand button must clear. */
export const ACCENT_MIN_CONTRAST = 4.5;

/*
 * What the brand color is read against in each theme: the kit's ink, surface
 * and surface-2, and a chip's own tint of the brand. The label on a filled
 * brand button is drawn in the ink color, so it is covered by the first.
 */
const THEME_GROUNDS = {
	light: { canvases: ['#f6f7f9', '#ffffff', '#e6e8ee'], tintOn: '#ffffff', toward: '#000000' },
	dark: { canvases: ['#0b1422', '#0c1728', '#121e30'], tintOn: '#0c1728', toward: '#ffffff' },
} as const;

export type AccentTheme = keyof typeof THEME_GROUNDS;

function worstContrast(brand: string, theme: AccentTheme): number {
	const g = THEME_GROUNDS[theme];
	const grounds = [...g.canvases, mixHex(g.tintOn, brand, 0.1)];
	return Math.min(...grounds.map((c) => contrastRatio(brand, c)));
}

export interface AccentShades {
	base: string;
	light: string;
	deep: string;
	/** The worst contrast base reaches in this theme. */
	contrast: number;
	/** Whether base had to move away from the chosen color to be readable. */
	adjusted: boolean;
}

/**
 * The brand ramp one theme paints with, from the one color the tenant chose.
 *
 * A color readable on the dark theme is often unreadable on the light one and
 * the reverse, so each theme gets its own base: the chosen color when it
 * clears the floor there, otherwise the nearest color on the way to black
 * (light theme) or white (dark theme) that does. The companions follow the
 * kit's ramp: in the light theme emphasis reads deeper, so hover and pressed
 * both sit below base. In the dark theme hover is lighter.
 */
export function accentShades(hex: string, theme: AccentTheme): AccentShades {
	const chosen = hex.toLowerCase();
	const { toward } = THEME_GROUNDS[theme];
	let base = chosen;
	for (let w = 0.02; worstContrast(base, theme) < ACCENT_MIN_CONTRAST && w <= 1; w += 0.02) {
		base = mixHex(chosen, toward, w);
	}
	const companions =
		theme === 'light'
			? { light: mixHex(base, '#000000', 0.12), deep: mixHex(base, '#000000', 0.24) }
			: { light: mixHex(base, '#ffffff', 0.35), deep: mixHex(base, '#000000', 0.25) };
	return { base, ...companions, contrast: worstContrast(base, theme), adjusted: base !== chosen };
}

/**
 * The shell's style for a tenant accent: both themes' ramps as custom
 * properties, which app.css maps onto the brand tokens for whichever theme is
 * showing.
 */
export function accentStyle(hex: string): string {
	const l = accentShades(hex, 'light');
	const d = accentShades(hex, 'dark');
	return [
		`--tenant-brand-on-light: ${l.base}`,
		`--tenant-brand-light-on-light: ${l.light}`,
		`--tenant-brand-deep-on-light: ${l.deep}`,
		`--tenant-brand-on-dark: ${d.base}`,
		`--tenant-brand-light-on-dark: ${d.light}`,
		`--tenant-brand-deep-on-dark: ${d.deep}`,
	].join('; ');
}

/** Whether a caller holding roles sees an item limited to allowed. */
export function visibleTo(allowed: string[] | undefined, roles: readonly string[]): boolean {
	if (!allowed || allowed.length === 0) return true;
	if (roles.includes('super_admin')) return true;
	return allowed.some((r) => roles.includes(r));
}

/** A link opens outside the admin when it is not an admin path. */
export function isExternal(url: string): boolean {
	return !url.startsWith('/admin/');
}

export interface EntryRow {
	id: string;
	title: string;
	status: string;
	updated_at: string;
}

/**
 * A block with what it shows already read. A block whose read failed carries
 * `failed`, and draws as "could not be read" rather than as empty: a content
 * list the viewer may not read is not a schema with no entries.
 */
export type ResolvedBlock =
	| (Block & { type: 'markdown' | 'callout' | 'links' })
	| (Block & { type: 'content'; entries: EntryRow[] | null })
	| (Block & { type: 'stats'; counts: { schema: string; rows: number | null }[] });
