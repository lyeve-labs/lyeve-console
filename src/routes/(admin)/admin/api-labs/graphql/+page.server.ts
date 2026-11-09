import type { Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { GRAPHQL_URL, byteLength, graphqlMutates, parseVariables } from '$lib/api/labs';
import { MAX_BODY_BYTES, send } from '../labs.server';
import { asked } from '$lib/server/asked';

export const actions: Actions = {
	graphql: asked(
		{
			question: 'Send this mutation?',
			detail: 'It changes data on the engine you are signed in to, as you.',
			label: 'Send it',
		},
		async (event) => {
			const form = await event.request.formData();
			const document = String(form.get('document') ?? '').trim();
			if (!document) return fail(400, { error: 'Enter a query or mutation to send.' });
			if (byteLength(document) > MAX_BODY_BYTES) {
				return fail(400, { error: 'The document can be at most 256 KB.' });
			}

			const vars = parseVariables(String(form.get('variables') ?? ''));
			if (!vars.ok) return fail(400, { error: vars.error });

			const payload = JSON.stringify(
				vars.value === undefined ? { query: document } : { query: document, variables: vars.value },
			);
			const out = await send(event, 'POST', GRAPHQL_URL, payload, 'application/json');
			if ('error' in out) return fail(504, { error: out.error });
			// A GraphQL error arrives inside a 200, so the page needs to know
			// whether this was a mutation regardless of what the status says.
			return { graphql: out.result, mutated: graphqlMutates(document) };
		},
		(form) => graphqlMutates(String(form.get('document') ?? '')),
	),
};
