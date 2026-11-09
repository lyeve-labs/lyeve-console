/**
 * The grpc plugin's one admin route.
 *
 * The plugin serves on listeners of its own rather than through the engine's
 * router, which is right for gRPC. The console talks to the engine's API and
 * nothing else, so this route is the only surface it can read to learn
 * whether a listener came up.
 *
 * The status read reports what the plugin did rather than what it was
 * configured to do. The addresses come off the bound listeners, so a port that
 * was already taken reports the port actually in use.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import type { HttpClient } from '@lyeve-labs/client';

const STATUS_URL = '/api/admin/grpc/status';

export interface ServiceStatus {
	name: string;
	serving: boolean;
	status: string;
}

export interface GrpcStatus {
	/** The instance does not enable the plugin, so no listener was bound. */
	degraded: boolean;
	listening: boolean;
	address?: string;
	health_address?: string;
	reflection: boolean;
	services: ServiceStatus[];
	transcoded_routes: string[];
}

export async function readStatus(client: HttpClient): Promise<GrpcStatus> {
	return client.get<GrpcStatus>(STATUS_URL);
}

export type GrpcHealth = 'serving' | 'partial' | 'down' | 'disabled';

/**
 * The one line the page leads with.
 *
 * Disabled comes first: no listener was bound on purpose, and reporting it
 * as a bind failure sends somebody to look at ports. Partial is its own state
 * because a listener that is up with a service not serving is the case a
 * health check catches and a port check does not.
 */
export function grpcHealth(status: GrpcStatus | null): GrpcHealth {
	if (!status) return 'down';
	if (status.degraded) return 'disabled';
	if (!status.listening) return 'down';
	return status.services.every((s) => s.serving) ? 'serving' : 'partial';
}

export const HEALTH_LABELS: Readonly<Record<GrpcHealth, string>> = {
	serving: 'Serving',
	partial: 'Listening, but a service is not serving',
	down: 'Not listening',
	disabled: 'Not started on this engine',
};

export function healthTone(h: GrpcHealth): StatusTone {
	if (h === 'serving') return 'success';
	if (h === 'down') return 'danger';
	if (h === 'partial' || h === 'disabled') return 'warn';
	return 'neutral';
}

/**
 * What a health status means to somebody who has not read the gRPC spec.
 *
 * SERVICE_UNKNOWN is the one that matters. It means the service is registered
 * on the server and was never declared to the health server, so it answers
 * calls while a client that health checks first is told it does not exist.
 */
export const SERVICE_STATUS_LABELS: Readonly<Record<string, string>> = {
	SERVING: 'Serving',
	NOT_SERVING: 'Refusing calls',
	SERVICE_UNKNOWN: 'Registered, but not reported to health checks',
	UNKNOWN: 'Not started',
};

export function serviceStatusLabel(status: string): string {
	return SERVICE_STATUS_LABELS[status] ?? status;
}

export function serviceTone(status: string): StatusTone {
	if (status === 'SERVING') return 'success';
	if (status === 'NOT_SERVING') return 'danger';
	if (status === 'SERVICE_UNKNOWN') return 'warn';
	return 'neutral';
}

/** Services that are registered but invisible to a health check. */
export function undeclared(status: GrpcStatus | null): ServiceStatus[] {
	return (status?.services ?? []).filter((s) => s.status === 'SERVICE_UNKNOWN');
}

/**
 * Whether reflection is exposed where it should not be.
 *
 * Reflection lets any caller enumerate every service, method and message. The
 * plugin turns it off when the engine says it is in production, so reflection
 * being on is only worth flagging beside that fact, which this page does not
 * have. It is reported plainly rather than judged.
 */
export function reflectionNote(status: GrpcStatus | null): string {
	if (!status?.listening) return '';
	return status.reflection
		? 'Reflection is on, so anyone who can reach the port can list every service and message. It turns off automatically when the engine runs in production.'
		: 'Reflection is off. A client needs the generated stubs or a descriptor to call the API.';
}

/**
 * Whether the listener is reachable from outside the host.
 *
 * The plugin defaults to loopback, which is the right default and also the
 * reason a client on another machine cannot connect. Saying so is the
 * difference between a five minute fix and an afternoon.
 */
export function loopbackOnly(address: string | null | undefined): boolean {
	if (!address) return false;
	const host = address.slice(0, address.lastIndexOf(':'));
	return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
}
