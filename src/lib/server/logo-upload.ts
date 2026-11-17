import type { RequestEvent } from '@sveltejs/kit';
import { authedHeaders } from '#lib/server/authz.ts';
import { logoBytesMatch, logoProblem } from '#lib/logo.ts';
import type { MediaItem } from '#lib/api/media.ts';

/** A refusal whose text is safe to show: it describes the file, never the engine. */
export class LogoRejected extends Error {}

async function engineMessage(res: Response, fallback: string): Promise<string> {
	// The media plugin answers 422 with the caller's own mistake, such as a
	// type its allow-list refuses. Anything else is not the reader's to fix.
	if (res.status !== 422) return fallback;
	const body = (await res.json().catch(() => null)) as { error?: string } | null;
	return body?.error || fallback;
}

/**
 * Stores a logo or tab icon in the tenant's media library and publishes it,
 * returning the stable public path the brand then points at.
 *
 * Two engine calls, the same two the library page makes: the upload, then
 * the publish. A file that uploads but cannot be published is left in the
 * library, private, where the operator can see it and publish or delete it.
 */
export async function uploadLogo(event: RequestEvent, file: File, noun = 'logo'): Promise<string> {
	const problem = logoProblem(file, noun);
	if (problem) throw new LogoRejected(problem);
	const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
	if (!logoBytesMatch(file.type, head)) throw new LogoRejected('That file is not the image its name says it is.');

	const headers = authedHeaders(event);
	const body = new FormData();
	body.append('file', file, file.name || noun.replaceAll(' ', '-'));
	body.append('folder', '/branding');
	body.append('alt_text', noun[0].toUpperCase() + noun.slice(1));
	const up = await event.fetch('/api/admin/media', { method: 'POST', headers, body });
	if (!up.ok) throw new LogoRejected(await engineMessage(up, `Could not upload the ${noun}. Try again.`));
	const items = (await up.json().catch(() => [])) as MediaItem[] | MediaItem;
	const stored = Array.isArray(items) ? items[0] : items;
	if (!stored?.id) throw new LogoRejected(`Could not upload the ${noun}. Try again.`);

	const pub = await event.fetch(`/api/admin/media/${encodeURIComponent(stored.id)}`, {
		method: 'PATCH',
		headers: { ...headers, 'Content-Type': 'application/json' },
		body: JSON.stringify({ public: true }),
	});
	if (!pub.ok) throw new LogoRejected(`Could not publish the ${noun}. It was uploaded to the media library, where you can publish it.`);
	const published = (await pub.json().catch(() => null)) as MediaItem | null;
	if (!published?.public_url) throw new LogoRejected(`Could not publish the ${noun}. It was uploaded to the media library, where you can publish it.`);
	return published.public_url;
}
