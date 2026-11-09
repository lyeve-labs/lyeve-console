import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { authedClient } from '$lib/server/authz';
import { aiGate } from '$lib/server/ai-load';
import { GATE_OK, section } from '$lib/api/gate';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { listTranscripts, TRANSCRIPT_KINDS } from '$lib/api/ai';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const load: PageServerLoad = async (event) => {
	const client = authedClient(event);
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);
	const kindRaw = event.url.searchParams.get('kind') ?? '';
	const kind = (TRANSCRIPT_KINDS as string[]).includes(kindRaw) ? kindRaw : '';
	const subjectKind = event.url.searchParams.get('subject_kind') ?? '';
	const subjectId = event.url.searchParams.get('subject_id') ?? '';

	const page = await section(
		listTranscripts(client, { limit: limit + 1, offset, kind, subject_kind: subjectKind, subject_id: subjectId }),
		(err) => aiGate(err, event, 'transcripts'),
	);
	const gate = page.ok ? GATE_OK : page.gate;
	const transcripts = page.ok ? page.value.rows.slice(0, limit) : [];
	const total = page.ok ? page.value.total : null;
	const hasMore = page.ok && (total === null ? page.value.rows.length > limit : offset + transcripts.length < total);

	const back = pastEndOffset(transcripts.length, limit, offset, total);
	if (back !== null) redirect(307, withOffset(event.url, back));

	return { gate, transcripts, total, limit, offset, hasMore, kind, subjectKind, subjectId };
};
