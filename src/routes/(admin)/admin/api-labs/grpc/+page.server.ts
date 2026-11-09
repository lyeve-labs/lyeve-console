import type { PageServerLoad, Actions } from './$types';
import { error, fail } from '@sveltejs/kit';
import type { HttpClient } from '@lyeve-labs/client';
import { GATE_OK, forbiddenText, gateOf, type Gate } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import { authedClient, loadUser } from '$lib/server/authz';
import {
	GRPC_INVOKE_URL,
	byteLength,
	grpcRouteParams,
	grpcRouteTakesBody,
	labResultFromInvoke,
	type GrpcInvokeResult,
} from '$lib/api/labs';
import { MAX_BODY_BYTES, send } from '../labs.server';
import { asked } from '$lib/server/asked';

/** The roles that may read the listener's status and send through it. */
const READERS = ['super_admin'];

/** What the gRPC tab says when the listener's status could not be read. */
const GRPC_FAILED = couldNotLoad('the gRPC listener status');

export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	// The listener's status and the invoke route are a super admin's, so the
	// lab refuses every other role before it reads anything.
	if (!user.roles.some((r) => READERS.includes(r))) {
		error(403, forbiddenText('this page', READERS));
	}
	return { grpc: await readGrpcRoutes(authedClient(event)) };
};

/**
 * The REST paths the gRPC listener transcodes, and whether it is listening.
 *
 * Read, never sent. Those paths are served by the plugin's own listener,
 * which defaults to loopback on a port of its own, so reaching them means a
 * server here fetching a different host: the request forgery primitive the
 * REST lab is built to avoid. The gRPC tab shows what that listener serves
 * and the line to call it with, and sends nothing.
 *
 * Read from the plugin's own status route so the lab offers what that
 * listener actually serves. A build without the plugin answers 404 and the
 * page says the listener is absent rather than offering paths nothing serves.
 */
async function readGrpcRoutes(client: HttpClient): Promise<{ listening: boolean; routes: string[]; gate: Gate }> {
	try {
		const body = await client.get<{ listening?: boolean; transcoded_routes?: string[] } | null>(
			'/api/admin/grpc/status',
			{ headers: { Accept: 'application/json' } },
		);
		return {
			listening: body?.listening === true,
			routes: body?.transcoded_routes ?? [],
			gate: GATE_OK,
		};
	} catch (err) {
		// A refused read is sorted the way every page sorts one: only a 404
		// says the plugin is not here, and an outage offers a retry.
		return { listening: false, routes: [], gate: gateOf(err, GRPC_FAILED) };
	}
}

/**
 * Words for a call the plugin would not run. A coded 4xx names what to
 * change, and is relayed. A 5xx, and anything a proxy sent, gets the lab's
 * own sentence.
 */
function notRun(status: number, body: string): string {
	if (status === 402) return 'gRPC is not enabled on this engine.';
	if (status === 403) return 'Only a super admin can run a gRPC call.';
	if (status >= 400 && status < 500) {
		try {
			const said = JSON.parse(body) as { error?: unknown; code?: unknown };
			if (typeof said.code === 'string' && said.code && typeof said.error === 'string' && said.error) return said.error;
		} catch {
			// Not the engine's JSON, so something in front of it answered.
		}
	}
	return 'Could not run the call. Try again.';
}

export const actions: Actions = {
	grpc: asked(
		{
			question: 'Run this call?',
			detail: 'It runs on the transcoding listener as you, and it changes data.',
			label: 'Run it',
		},
		async (event) => {
			// The allowlist is what the plugin says it transcodes, read from the
			// engine here rather than taken from the form, for the same reason the
			// REST allowlist is: a list the caller can choose is not one. The
			// plugin checks it again on its side, which is where it counts.
			const form = await event.request.formData();
			const route = String(form.get('route') ?? '');

			const grpc = await readGrpcRoutes(authedClient(event));
			if (!grpc.routes.includes(route)) {
				return fail(400, { error: 'Choose a route from the list.' });
			}

			const params: Record<string, string> = {};
			for (const name of grpcRouteParams(route)) {
				const v = String(form.get(`g_${name}`) ?? '').trim();
				if (!v) {
					return fail(400, { error: `Fill in ${name}. A placeholder left in the path returns a misleading 404.` });
				}
				params[name] = v;
			}

			const payload: Record<string, unknown> = { route, params };
			const raw = String(form.get('body') ?? '').trim();
			if (raw && grpcRouteTakesBody(route)) {
				if (byteLength(raw) > MAX_BODY_BYTES) {
					return fail(400, { error: 'The body can be at most 256 KB.' });
				}
				try {
					payload.body = JSON.parse(raw);
				} catch (err) {
					return fail(400, { error: `Fix the JSON in the body: ${(err as Error).message}` });
				}
			}

			const out = await send(event, 'POST', GRPC_INVOKE_URL, JSON.stringify(payload), 'application/json');
			if ('error' in out) return fail(504, { error: out.error });

			// The engine answers 200 when the call ran, whatever the transcoded
			// handler said. Anything else is the plugin refusing to run it.
			if (out.result.status !== 200) {
				return fail(400, { error: notRun(out.result.status, out.result.body) });
			}
			let invoked: GrpcInvokeResult;
			try {
				invoked = JSON.parse(out.result.body) as GrpcInvokeResult;
			} catch {
				return fail(502, { error: 'Could not read the response.' });
			}
			return { grpc: labResultFromInvoke(invoked), grpcRoute: route };
		},
		(form) => {
			const route = String(form.get('route') ?? '');
			return grpcRouteTakesBody(route) || route.startsWith('DELETE ');
		},
	),
};
