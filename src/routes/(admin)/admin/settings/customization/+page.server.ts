import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { LOGO_MAX_BYTES, LOGO_TYPES, logoAddressOk } from '$lib/logo';
import { importMedia, importRefusal, isForeignAddress, listMediaChoices, type MediaChoice } from '$lib/api/media';
import { LogoRejected, uploadLogo } from '$lib/server/logo-upload';
import { EMPTY_SETTINGS, parseAccent, saveCustomization } from '$lib/api/customization';
import { current, openTab } from './customization.server';

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	const { gate, custom } = await openTab(event, user, plugins);
	// Null is a library that could not be read, never one with nothing in it.
	if (!custom) return { gate, entitled: false, settings: EMPTY_SETTINGS, mediaChoices: null as MediaChoice[] | null };
	const media = await Promise.resolve()
		.then(() => listMediaChoices(authedClient(event)))
		.catch((): MediaChoice[] | null => null);
	return { gate, entitled: true, settings: custom.settings, mediaChoices: media };
};

/*
 * The logo and the tab icon are two images on one path: an address or a file,
 * kept in the media library and published there, then stored on the brand.
 * Each action answers in its own keys, so a page holding both says which one
 * a message is about.
 */
type BrandImage = 'logo' | 'favicon';
const IMAGE: Record<BrandImage, { field: 'logo_url' | 'favicon_url'; noun: string; file: string }> = {
	logo: { field: 'logo_url', noun: 'logo', file: 'logo' },
	favicon: { field: 'favicon_url', noun: 'tab icon', file: 'favicon' },
};

type ImageResult = { error?: string; field?: string; imported?: boolean; removed?: boolean };

async function saveImageAddress(event: Parameters<Actions[string]>[0], kind: BrandImage): Promise<ImageResult> {
	await requireRole(event, ['admin', 'super_admin']);
	const { field, noun } = IMAGE[kind];
	const url = String((await event.request.formData()).get(field) ?? '').trim();
	if (url && !logoAddressOk(url)) {
		return { error: `Enter an https URL or a published media library file for the ${noun}.`, field: 'An https URL' };
	}
	const client = authedClient(event);
	// The admin loads images only from its own origin, so an image on another
	// site is copied into the media library and served from here.
	let stored = url;
	let imported = false;
	if (url && isForeignAddress(url)) {
		try {
			const item = await importMedia(client, { url, public: true, max_bytes: LOGO_MAX_BYTES, folder: '/branding' });
			if (!(LOGO_TYPES as readonly string[]).includes(item.content_type) || !item.public_url) {
				await client.delete(`/api/admin/media/${encodeURIComponent(item.id)}`).catch(() => undefined);
				return { error: `Use a PNG, JPEG or WebP image for the ${noun}.`, field: 'Not a PNG, JPEG or WebP image' };
			}
			stored = item.public_url;
			imported = true;
		} catch (err) {
			return { error: importRefusal(actionError(err, 'Could not import the image at that address. Try again.')), field: 'Could not be imported' };
		}
	}
	try {
		const settings = await current(event);
		settings.brand = { ...settings.brand, [field]: stored };
		await saveCustomization(client, settings);
		return url ? { imported } : { removed: true };
	} catch (err) {
		return { error: actionError(err, `Could not save the ${noun}. Try again.`) };
	}
}

async function saveImageUpload(event: Parameters<Actions[string]>[0], kind: BrandImage): Promise<ImageResult> {
	await requireRole(event, ['admin', 'super_admin']);
	const { field, noun, file: name } = IMAGE[kind];
	const file = (await event.request.formData()).get(name);
	if (!(file instanceof File) || file.size === 0) return { error: 'Choose an image to upload.' };
	try {
		const url = await uploadLogo(event, file, noun);
		const settings = await current(event);
		settings.brand = { ...settings.brand, [field]: url };
		await saveCustomization(authedClient(event), settings);
		return {};
	} catch (err) {
		if (err instanceof LogoRejected) return { error: err.message };
		return { error: actionError(err, `Could not save the ${noun}. Try again.`) };
	}
}

export const actions: Actions = {
	brand: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const accent = parseAccent(String(form.get('accent') ?? ''));
		if (accent === null) return fail(400, { brandError: 'Enter the accent color as #RRGGBB, such as #0a7cff.' });
		try {
			const settings = await current(event);
			// The logo and the tab icon have their own forms and actions, so
			// this one keeps whatever images are stored.
			settings.brand = {
				...settings.brand,
				name: String(form.get('name') ?? '').trim(),
				accent,
				welcome: String(form.get('welcome') ?? '').trim(),
			};
			await saveCustomization(authedClient(event), settings);
			return { brandSaved: true };
		} catch (err) {
			return fail(400, { brandError: actionError(err, 'Could not save the brand. Try again.') });
		}
	},

	logo: async (event) => {
		const r = await saveImageAddress(event, 'logo');
		if (r.error) return fail(400, { logoError: r.error, ...(r.field ? { fields: { logo_url: r.field } } : {}) });
		if (r.removed) return { logoRemoved: true };
		return r.imported ? { logoSaved: true, logoImported: true } : { logoSaved: true };
	},

	/*
	 * A logo file from the reader's disk: stored in the media library,
	 * published there so it has a stable address anyone can load, and made
	 * the brand's logo, in one step.
	 */
	uploadLogo: async (event) => {
		const r = await saveImageUpload(event, 'logo');
		if (r.error) return fail(400, { logoError: r.error });
		return { logoSaved: true, logoUploaded: true };
	},

	/** The tab icon, by address, taking the logo's path. */
	favicon: async (event) => {
		const r = await saveImageAddress(event, 'favicon');
		if (r.error) return fail(400, { faviconError: r.error, ...(r.field ? { fields: { favicon_url: r.field } } : {}) });
		if (r.removed) return { faviconRemoved: true };
		return r.imported ? { faviconSaved: true, faviconImported: true } : { faviconSaved: true };
	},

	/** The tab icon from the reader's disk, taking the logo's path. */
	uploadFavicon: async (event) => {
		const r = await saveImageUpload(event, 'favicon');
		if (r.error) return fail(400, { faviconError: r.error });
		return { faviconSaved: true, faviconUploaded: true };
	},
};
