/**
 * Running a documented endpoint from the page that documents it.
 *
 * The reference already shows a curl line to paste. What it could not do is
 * answer "what does this actually return on my instance", which is the reason
 * somebody opens an API reference at all, and the admin is in an unusual
 * position to offer it: the reader already holds a session against the very
 * engine being documented, so there is no key to make and nothing to set up.
 *
 * The whole design is in what it refuses. A try-it that fires a DELETE
 * performs a real delete against real tenant data, and the page it sits on
 * looks like documentation rather than like a console.
 */

/** Methods that change nothing and need no ceremony. */
export const SAFE_METHODS = ['GET', 'HEAD'] as const;

/** Methods that change something and are therefore acknowledged one at a time. */
export const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

export function isSafeMethod(method: string): boolean {
	return (SAFE_METHODS as readonly string[]).includes(method.toUpperCase());
}

export function isWriteMethod(method: string): boolean {
	return (WRITE_METHODS as readonly string[]).includes(method.toUpperCase());
}

export function isRunnable(method: string): boolean {
	return isSafeMethod(method) || isWriteMethod(method);
}

/**
 * Whether a path is still a template.
 *
 * `/api/admin/users/{id}` sent as written asks the engine for a user whose id
 * is the literal text "{id}", which answers 404 and reads as the endpoint being
 * broken. Refusing here says the real thing: a value is missing.
 */
export function unfilledParameters(path: string): string[] {
	return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

export interface TryRefusal {
	/** What to tell the operator, written for them rather than for a log. */
	reason: string;
}

export interface TryRequest {
	method: string;
	path: string;
	/** Present for a write, and only when the operator ticked it for this call. */
	acknowledged?: boolean;
	/** Whether this session may run a write at all. */
	canWrite?: boolean;
}

/**
 * The gate, as one function so the server and the page cannot disagree.
 *
 * A write is refused three times over: it needs a role, it needs an
 * acknowledgment of this particular call, and the acknowledgment is not
 * remembered. None of this can be switched off by configuration.
 */
export function refuse(req: TryRequest): TryRefusal | null {
	const method = req.method.toUpperCase();

	if (!isRunnable(method)) {
		return { reason: `This page cannot send ${method} requests.` };
	}
	if (!req.path.startsWith('/')) {
		return { reason: 'The path has to start with a slash.' };
	}

	const missing = unfilledParameters(req.path);
	if (missing.length > 0) {
		return {
			reason: `Fill in ${missing.map((p) => `{${p}}`).join(', ')} before sending this.`,
		};
	}

	if (isWriteMethod(method)) {
		if (!req.canWrite) {
			return { reason: `Only a super admin can send a ${method} from this page.` };
		}
		if (!req.acknowledged) {
			return {
				reason: `${method} changes data on this engine. Tick the box to send it.`,
			};
		}
	}
	return null;
}

/** What a run answers with. The body is capped: this is a look, not a download. */
export interface TryResult {
	status: number;
	durationMs: number;
	contentType: string;
	body: string;
	truncated: boolean;
}

export const MAX_SHOWN_BODY = 64 * 1024;

/** Pretty-print JSON so a reader can see the shape, and leave anything else. */
export function presentBody(raw: string, contentType: string): string {
	if (!contentType.includes('json')) return raw;
	try {
		return JSON.stringify(JSON.parse(raw), null, 2);
	} catch {
		return raw;
	}
}
