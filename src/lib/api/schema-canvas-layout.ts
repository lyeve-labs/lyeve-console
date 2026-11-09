/**
 * The schema canvas layout the schema plugin keeps for a tenant, and whether
 * this instance draws the canvas at all.
 */

import type { HttpClient } from '@lyeve-labs/client';

const PATH = '/api/admin/schemas/canvas-layout';

export type Positions = Record<string, { x: number; y: number }>;

export interface CanvasLayout {
	positions: Positions;
	/** Whether this instance draws the canvas and saves a layout. */
	licensed: boolean;
}

/** An instance that cannot say draws no canvas, which is what an instance without the license answers too. */
export const NO_CANVAS: CanvasLayout = { positions: {}, licensed: false };

export async function readCanvasLayout(client: HttpClient): Promise<CanvasLayout> {
	const res = await client.get<{ positions?: unknown; licensed?: unknown } | null>(PATH);
	return { positions: parsePositions(res?.positions), licensed: res?.licensed === true };
}

/** Replaces the saved layout with every position the canvas holds. */
export function saveCanvasLayout(client: HttpClient, positions: Positions): Promise<unknown> {
	return client.put<unknown>(PATH, { positions });
}

/** Keeps the entries that are a pair of finite numbers and drops the rest. */
export function parsePositions(raw: unknown): Positions {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const out: Positions = {};
	for (const [name, p] of Object.entries(raw as Record<string, unknown>)) {
		const pos = p as { x?: unknown; y?: unknown } | null;
		if (pos && typeof pos.x === 'number' && typeof pos.y === 'number' && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
			out[name] = { x: pos.x, y: pos.y };
		}
	}
	return out;
}
