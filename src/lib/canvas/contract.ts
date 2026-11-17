/**
 * What a page may ask of a flow or schema editor. The pages are written
 * against these types alone, so an editor is replaceable by anything that
 * accepts the same props and answers the same calls, and a build that has
 * none falls back without the page changing.
 */
import type { Component, Snippet } from 'svelte';
import type { Schema } from '@lyeve-labs/client';
import type { RunStep, ValidationError } from '#lib/api/flows.ts';
import type { FlowDefinition, NodeSpec, Selection } from '#lib/flow/types.ts';

export interface HistoryState {
	canUndo: boolean;
	canRedo: boolean;
}

export interface FlowCanvasProps {
	definition: FlowDefinition;
	catalog: NodeSpec[];
	selected?: Selection;
	/** Steps of the last run, shown on each node the run reached. */
	runSteps?: RunStep[];
	/** The engine's validation errors, shown on the node each one names. */
	errors?: ValidationError[];
	onchange?: (def: FlowDefinition) => void;
	onhistory?: (state: HistoryState) => void;
	/** What the editor shows while the flow has no nodes. */
	empty?: Snippet;
}

export interface FlowCanvasApi {
	undo(): void;
	redo(): void;
	autoLayout(): void;
	addNodeAtCenter(type: string): void;
	addNoteAtCenter(): void;
	deleteSelection(): void;
	fit(): void;
	openingFit(): void;
	/** Brings a node, or the trigger, into view. */
	reveal(id: string): void;
}

export interface SchemaCanvasProps {
	schemas: Schema[];
	selected: Schema | null;
	onselect: (s: Schema) => void;
	/** Called when the reader asks to add a field to the schema named. */
	onaddfield?: (schemaName: string) => void;
	/**
	 * Called when the reader relates one schema to another, with the schema
	 * the relation starts from and the one it ends on. No target means the
	 * reader has not picked one yet.
	 */
	onrelate?: (from: string, to: string | null) => void;
	/** Row counts keyed by schema name. */
	rowCounts?: Record<string, number>;
	/** The layout saved on the instance. Its positions are drawn when it holds any. */
	savedPositions?: Record<string, { x: number; y: number }>;
	/** Called with every position after a gesture that moves a node, to save them on the instance. */
	onpositions?: (positions: Record<string, { x: number; y: number }>) => void;
}

export interface SchemaCanvasApi {
	/** Brings a schema into view. */
	reveal(name: string): void;
}

export type FlowCanvasComponent = Component<FlowCanvasProps, FlowCanvasApi, 'definition' | 'selected'>;
export type SchemaCanvasComponent = Component<SchemaCanvasProps, SchemaCanvasApi>;
