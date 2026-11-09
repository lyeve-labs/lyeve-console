/**
 * What the dashboard's loader works out from what it read. Kept out of the
 * route file because a page server module may export nothing but its
 * handlers: a stray export there passes the type check and the tests and is
 * a 500 in the browser.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import type { TrendPoint } from '@lyeve-labs/client-rest';
import { trafficTone, type Window } from '$lib/dashboard';
import { formatPercent, plural } from '$lib/format';

/** One hour of traffic, with the gaps the engine leaves already filled. */
export interface TrafficHour {
	hour: string;
	requests: number;
	errorRate: number;
}

/** One thing an operator should act on, and where to do it. */
export interface Attention {
	// The dashboard draws every tone but danger with the warning icon.
	tone: Extract<StatusTone, 'warn' | 'danger'>;
	text: string;
	href: string;
	action: string;
}

/** One endpoint in the window, as far as the dashboard reads it. */
export interface TopEndpoint {
	key: string;
	requests: number;
	errorRate: number;
	p95: number;
}

/**
 * The trend as one bucket per hour of the window.
 *
 * The engine groups by the hours that saw traffic and answers newest first,
 * so a quiet hour is simply absent. Drawn as answered, a night with no
 * requests would vanish and the bars either side would read as adjacent. The
 * window is walked hour by hour here and a missing bucket is a zero, which is
 * what it measured.
 */
export function hoursOf(points: TrendPoint[], since: Date, until: Date): TrafficHour[] {
	const seen = new Map<number, TrendPoint>();
	for (const p of points) {
		const t = Date.parse(p.hour);
		if (!Number.isNaN(t)) seen.set(t, p);
	}
	const out: TrafficHour[] = [];
	for (let t = since.getTime(); t <= until.getTime(); t += 3_600_000) {
		const p = seen.get(t);
		out.push({
			hour: new Date(t).toISOString(),
			requests: p?.request_count ?? 0,
			errorRate: p?.error_rate ?? 0,
		});
	}
	return out;
}

/**
 * What needs doing, in the order it would be done.
 *
 * The tiles say how many. This says which, and links to the screen that
 * fixes it. A tile whose read failed contributes nothing: unknown is not a
 * problem to act on, and the tile already says it could not be read. The
 * license comes first because an expired one takes its licensed plugins with
 * it, and a failed job is named rather than counted because the fix is on
 * that job's own page.
 */
export function attentionOf(
	d: {
		requests: { total: number; errorRate: number } | null;
		jobs: { failed: { id: string; name: string }[] } | null;
		errorsLogged: number | null;
		webhooks: { unhealthy: number; pendingDlq: number } | null;
		/** Null on a build that links no license module. */
		license: { state: string } | null;
		/** Controls switched on and not in the request path. Null below super_admin. */
		controlFailures?: number | null;
	},
	window: Window
): Attention[] {
	const out: Attention[] = [];
	if (d.license?.state === 'expired') {
		out.push({
			tone: 'danger',
			text: 'The license has expired. Licensed plugins are off.',
			href: '/admin/settings/license',
			action: 'Renew',
		});
	} else if (d.license?.state === 'grace') {
		out.push({
			tone: 'warn',
			text: 'The license is in its grace period.',
			href: '/admin/settings/license',
			action: 'Renew',
		});
	}
	// Listed right after the license: a control that reads as on and is not
	// is worse than any single failure below, because nothing else will say so.
	if (d.controlFailures) {
		out.push({
			tone: 'danger',
			text: `${d.controlFailures} ${plural(d.controlFailures, 'security control is', 'security controls are')} configured but not in effect.`,
			href: '/admin/settings/security',
			action: 'Security',
		});
	}
	if (d.requests && d.requests.total > 0 && trafficTone(d.requests.errorRate) !== 'neutral') {
		out.push({
			tone: trafficTone(d.requests.errorRate) === 'danger' ? 'danger' : 'warn',
			text: `${formatPercent(d.requests.errorRate)} of requests failed in the last ${window}.`,
			href: '/admin/analytics',
			action: 'Analytics',
		});
	}
	for (const job of d.jobs?.failed ?? []) {
		out.push({
			tone: 'danger',
			text: `Job ${job.name} failed on its last run.`,
			href: `/admin/jobs?edit=${encodeURIComponent(job.id)}`,
			action: 'Open job',
		});
	}
	if (d.webhooks && d.webhooks.unhealthy > 0) {
		out.push({
			tone: 'warn',
			text: `${d.webhooks.unhealthy} ${plural(d.webhooks.unhealthy, 'webhook is', 'webhooks are')} unhealthy.`,
			href: '/admin/webhooks',
			action: 'Webhooks',
		});
	}
	if (d.webhooks && d.webhooks.pendingDlq > 0) {
		out.push({
			tone: 'warn',
			text: `${d.webhooks.pendingDlq} ${plural(d.webhooks.pendingDlq, 'delivery is', 'deliveries are')} waiting in the dead letter queue.`,
			href: '/admin/webhooks',
			action: 'Webhooks',
		});
	}
	if (d.errorsLogged) {
		out.push({
			tone: 'warn',
			text: `${d.errorsLogged} ${plural(d.errorsLogged, 'error')} logged in the last ${window}.`,
			href: '/admin/logs?level=ERROR',
			action: 'Logs',
		});
	}
	return out;
}
