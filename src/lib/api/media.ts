/**
 * URL builders and record helpers for the engine's admin media endpoints.
 *
 * The media routes split by what they answer: `/api/admin/media/{id}` returns
 * the JSON record, `/api/admin/media/{id}/download` returns the stored bytes
 * with the item's own content type. Only the second is something an `<img>`,
 * a `<video>` or a shared link can use, so build media URLs here rather than
 * inline, where the two are one character apart.
 */
import type { HttpClient } from '@lyeve-labs/client';
import { rowsOf, type ListEnvelope } from './list';

/** One row of the media library as the engine lists it. */
export interface MediaItem {
	id: string;
	key: string;
	filename: string;
	content_type: string;
	size: number;
	alt_text: string;
	folder: string;
	/** Free words search finds the file by. */
	tags?: string[];
	uploaded_by: string;
	created_at: string;
	/** Pixel width, present when the engine could read it from an image. */
	width?: number;
	height?: number;
	/**
	 * The storage backend's own URL, present only when the backend has a
	 * public base. The download route below is the one that always resolves.
	 */
	url?: string;
	/** Published: anyone on the tenant's site may load it at public_url. */
	public?: boolean;
	/** The stable path of a published file, relative to the tenant's host. */
	public_url?: string;
	/** Where a cover crop centers, x and y from 0 to 1. Absent is the center. */
	focal_point?: FocalPoint | null;
}

export interface FocalPoint {
	x: number;
	y: number;
}

/** A published file a content field can point at. */
export interface MediaChoice {
	id: string;
	filename: string;
	alt_text: string;
	content_type: string;
	public_url: string;
}

/** The families the library draws differently. */
export type MediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'other';

/** Absolute-path URL of the stored file for a media item. */
export function mediaFileUrl(id: string): string {
	if (!id) return '';
	return `/api/admin/media/${encodeURIComponent(id)}/download`;
}

/**
 * Absolute-path URL of the thumbnail the library shows for a media item, or an
 * empty string when there is nothing to draw.
 *
 * The engine renders webp derivatives at upload and lists them at
 * `/api/admin/media/{id}/thumbnails`, but it serves their bytes only from the
 * storage backend's own base URL, which a local-disk install leaves unset, and
 * the download route carries no resize query. The original through the
 * download route is therefore the one thumbnail source that answers on every
 * install, and the tile scales it with `object-fit: cover`. Only an image is
 * worth asking for: the browser cannot draw a frame of a video into an <img>,
 * and a glyph says more about a PDF than its first byte does.
 */
export function mediaThumbnailUrl(item: Pick<MediaItem, 'id' | 'content_type'>): string {
	return mediaKind(item.content_type) === 'image' ? mediaFileUrl(item.id) : '';
}

/**
 * Sorts a content type into the family the library previews it as.
 *
 * PDF is its own family so the glyph and the label can say what it is. The
 * drawer cannot frame one, because the file route answers as an attachment.
 */
export function mediaKind(contentType: string): MediaKind {
	const type = contentType.toLowerCase();
	if (type.startsWith('image/')) return 'image';
	if (type.startsWith('video/')) return 'video';
	if (type.startsWith('audio/')) return 'audio';
	if (type === 'application/pdf') return 'pdf';
	return 'other';
}

/** The family, as the facts list names it. */
export function mediaKindLabel(kind: MediaKind): string {
	switch (kind) {
		case 'image':
			return 'Image';
		case 'video':
			return 'Video';
		case 'audio':
			return 'Audio';
		case 'pdf':
			return 'PDF';
		default:
			return 'File';
	}
}

/** `1920 x 1080`, or an empty string when the engine recorded no dimensions. */
export function formatDimensions(item: Pick<MediaItem, 'width' | 'height'>): string {
	if (!item.width || !item.height) return '';
	return `${item.width} x ${item.height}`;
}

/** What an editor may change about an item. A field left out is kept. */
export interface MediaDetails {
	alt_text?: string;
	tags?: string[];
	folder?: string;
}

export async function updateMediaDetails(client: HttpClient, id: string, body: MediaDetails): Promise<MediaItem> {
	return client.patch<MediaItem>(`/api/admin/media/${encodeURIComponent(id)}`, body);
}

/** The AI plugin's description of an image, offered as its alt text. */
export async function describeMedia(client: HttpClient, id: string): Promise<string> {
	const res = await client.post<{ text?: string }>(`/api/admin/ai/media/${encodeURIComponent(id)}/describe`, {});
	return (res.text ?? '').trim();
}

/** Tags from a comma list: trimmed, empty ones dropped, each once. */
export function parseTags(raw: string): string[] {
	const out: string[] = [];
	for (const t of raw.split(',')) {
		const tag = t.trim();
		if (tag && !out.includes(tag)) out.push(tag);
	}
	return out;
}

/** The ways an item is pasted: its URL, a Markdown image and an HTML tag. */
export function mediaSnippets(url: string, alt: string): { url: string; markdown: string; html: string } {
	const safeAlt = alt.replace(/[\[\]]/g, '');
	const attr = alt.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
	return { url, markdown: `![${safeAlt}](${url})`, html: `<img src="${url}" alt="${attr}">` };
}

/** Publishes a file at a stable URL on the tenant's site, or takes it back. */
export async function setMediaPublic(client: HttpClient, id: string, published: boolean): Promise<MediaItem> {
	return client.patch<MediaItem>(`/api/admin/media/${encodeURIComponent(id)}`, { public: published });
}

/**
 * The published files a content field can point at, newest first. Only
 * published files are offered: a private one has no URL a site can load, and
 * choosing it would store a link that works for nobody.
 */
export async function listMediaChoices(client: HttpClient, limit = 200): Promise<MediaChoice[]> {
	const items = rowsOf(await client.get<ListEnvelope<MediaItem> | MediaItem[]>(`/api/admin/media?limit=${limit}&offset=0`));
	return items
		.filter((m) => m.public && m.public_url)
		.map((m) => ({
			id: m.id,
			filename: m.filename,
			alt_text: m.alt_text ?? '',
			content_type: m.content_type,
			public_url: m.public_url as string,
		}));
}

export interface MediaImport {
	url: string;
	public?: boolean;
	alt_text?: string;
	folder?: string;
	/** Lowers the library's upload limit for this file. */
	max_bytes?: number;
}

/**
 * Copies a file from an http or https address into the library, through the
 * same checks as an upload. The engine refuses private addresses and follows
 * redirects only to public ones.
 */
export function importMedia(client: HttpClient, body: MediaImport): Promise<MediaItem> {
	return client.post<MediaItem>('/api/admin/media/import', body);
}

/** Whether an address points at another site rather than at this instance. */
export function isForeignAddress(url: string): boolean {
	return /^https?:\/\//i.test(url.trim());
}

/**
 * The operator's sentence for a refused import. The engine's firewall stops a
 * request naming an internal address before the media plugin reads it, and
 * its "request blocked by WAF" says nothing about what to change.
 */
export function importRefusal(message: string): string {
	return /waf/i.test(message) ? 'That address is private or not allowed.' : message;
}

/** Set where a cover crop centers, or null to put it back in the middle. */
export async function setFocalPoint(client: HttpClient, id: string, point: FocalPoint | null): Promise<MediaItem> {
	return client.patch<MediaItem>(`/api/admin/media/${encodeURIComponent(id)}`, { focal_point: point });
}

/** The parameters of an on-request image transform. Zero and empty leave a parameter out. */
export interface TransformRequest {
	w?: number;
	h?: number;
	fit?: string;
	fmt?: string;
	q?: number;
	focal?: FocalPoint;
	expires_in?: number;
}

export interface SignedTransform {
	/** The signed path, relative to the tenant's host. */
	url: string;
	/** When the signature stops working, or null when it never does. */
	expires_at: string | null;
}

/** A signed transform URL. */
export function signTransformUrl(client: HttpClient, id: string, body: TransformRequest): Promise<SignedTransform> {
	return client.post<SignedTransform>(`/api/admin/media/${encodeURIComponent(id)}/transform-url`, body);
}

/** A point on an image, clamped to the frame and rounded to what the engine stores. */
export function focalAt(x: number, y: number): FocalPoint {
	const clamp = (n: number) => Math.min(1, Math.max(0, Math.round(n * 1000) / 1000));
	return { x: clamp(x), y: clamp(y) };
}

/** The transform body a form names, with every blank field left out. */
export function transformRequestFrom(form: FormData): TransformRequest {
	const n = (key: string) => {
		const v = Number(String(form.get(key) ?? '').trim());
		return Number.isInteger(v) && v > 0 ? v : undefined;
	};
	const t = (key: string) => String(form.get(key) ?? '').trim() || undefined;
	const body: TransformRequest = { w: n('w'), h: n('h'), fit: t('fit'), fmt: t('fmt'), q: n('q'), expires_in: n('expires_in') };
	const fx = Number(form.get('focal_x'));
	const fy = Number(form.get('focal_y'));
	if (form.get('use_focal') === 'true' && Number.isFinite(fx) && Number.isFinite(fy)) body.focal = focalAt(fx, fy);
	return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as TransformRequest;
}
