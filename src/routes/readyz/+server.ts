import type { RequestHandler } from './$types';
import { ENGINE_READY_TIMEOUT_MS } from '#lib/server/engine.ts';
import { readEngineSetup } from '#lib/server/setup-gate.ts';

/**
 * The console's readiness probe: 200 while the engine answers, 503 otherwise.
 * Every screen needs the engine, so a console that cannot reach it has
 * nothing to serve, and the root page answers 200 either way.
 *
 * It makes the setup gate's own read, through the same function and the
 * request's fetch, so it takes the path the console's engine calls take and
 * fails wherever they would: the engine down, still starting, or unreachable
 * through the proxy CORE_INTERNAL_URL names. The engine's /readyz is no use
 * here, because a proxy that routes only /api to the engine sends it back to
 * this console. An engine in setup mode answers that read, and the console
 * serves its setup screen then, so it is up. A 429 is an engine that is up,
 * as the gate reads it. The probe needs no session and says nothing beyond up
 * or down, because whoever can reach the port can reach it.
 */
export const GET: RequestHandler = async ({ fetch }) => {
	const timed: typeof fetch = (input, init) =>
		fetch(input, { ...init, signal: AbortSignal.timeout(ENGINE_READY_TIMEOUT_MS) });
	const { state } = await readEngineSetup(timed);
	const ready = state !== 'unreachable';
	return new Response(ready ? 'ready\n' : 'unavailable\n', {
		status: ready ? 200 : 503,
		headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
	});
};
