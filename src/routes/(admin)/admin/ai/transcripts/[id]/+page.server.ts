import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient, requireUser } from '$lib/server/authz';
import { aiActionError, aiGate } from '$lib/server/ai-load';
import { GATE_OK, section } from '$lib/api/gate';
import { getTranscript, recapTranscript } from '$lib/api/ai';

export const load: PageServerLoad = async (event) => {
	const { aiSettings } = await event.parent();
	const client = authedClient(event);
	const read = await section(getTranscript(client, event.params.id), (err) => {
		if (err instanceof ApiError && err.status === 404 && aiSettings?.enabled !== false) {
			error(404, 'This transcript no longer exists.');
		}
		return aiGate(err, event, 'transcripts');
	});
	return { gate: read.ok ? GATE_OK : read.gate, transcript: read.ok ? read.value : null };
};

export const actions: Actions = {
	// The recap is written by the same tenant provider and stored on the row.
	// It is a costed message on the transcript like any other.
	recap: async (event) => {
		await requireUser(event);
		try {
			const result = await recapTranscript(authedClient(event), event.params.id);
			return { recap: result.recap };
		} catch (err) {
			if (err instanceof ApiError && err.status === 422) return fail(422, { error: 'The transcript has no messages to recap.' });
			return fail(400, { error: aiActionError(err, 'Could not create the recap. Try again.') });
		}
	},
};
