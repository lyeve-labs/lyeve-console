/** A stream of the plugin's events, and a fetch that answers with it, for the assistant's tests. */

export const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export function streamOf(...frames: string[]): ReadableStream<Uint8Array> {
	const bytes = new TextEncoder().encode(frames.join(''));
	return new ReadableStream({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}

export interface Sent {
	url: string;
	body: Record<string, unknown>;
}

/** A fetch that records each call and answers with the next response. */
export function fakeFetch(...answers: (() => Response)[]) {
	const sent: Sent[] = [];
	const fn = (async (url: string, init?: RequestInit) => {
		sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
		const next = answers.shift();
		if (!next) throw new TypeError('no answer left');
		return next();
	}) as unknown as typeof fetch;
	return { fn, sent };
}

export const sse = (...frames: string[]) => () =>
	new Response(streamOf(...frames), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

export const refusedWith = (refusal: string, status = 403) => () =>
	new Response(JSON.stringify({ refusal }), { status, headers: { 'Content-Type': 'application/json' } });
