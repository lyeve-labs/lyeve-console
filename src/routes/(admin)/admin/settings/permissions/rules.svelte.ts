import type { Permission, Schema } from '@lyeve-labs/client';
import type { FlowOption } from '$lib/flow/types';
import { ALL_FLOWS, flowResource, flowResourceLabel, isFlowResource } from '$lib/flow/permissions';

/*
 * How the permission rules read: which rule applies where, what each cell of
 * the matrix draws, and what it says to a screen reader. The page, the cells
 * and the rule drawer all read one RuleMatrix, so the index over the rules is
 * built once per load and every part answers from the same rules.
 */

export const KNOWN_ROLES = ['super_admin', 'admin', 'editor'];
// Activate is the fifth action and belongs to flows alone: publish,
// disable, rollback, run and test. The engine's validator refuses it on
// a schema, so the matrix draws no mark for it there and the editor
// offers it only when the rule names a flow resource.
export const ACTIONS = ['create', 'read', 'update', 'delete', 'activate'] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABEL: Record<Action, string> = {
	create: 'Create',
	read: 'Read',
	update: 'Update',
	delete: 'Delete',
	activate: 'Activate',
};

export function applies(action: Action, resource: string): boolean {
	return action !== 'activate' || isFlowResource(resource);
}

/**
 * The rule that applies to every schema without a rule of its own. A schema
 * rule replaces its actions on that schema, so a grant made here can be
 * taken back on one schema. Field masks are the exception and add up.
 */
export const WILDCARD = '*';

/**
 * The content gate answers yes for this role before it reads any rule, so a
 * rule stored under it grants nothing it did not already have and revokes
 * nothing either.
 */
export const EXEMPT_ROLE = 'super_admin';

/** What a role's column summary reports across the schemas beneath it. */
export type TriState = 'none' | 'some' | 'all';

/** Where a single grant came from, which decides whether it can be cleared here. */
export type Mark = 'none' | 'stored' | 'inherited' | 'exempt';

/** A role's summary fills its bar, out of 32: empty for none, half for some, full for all. */
export const SUMMARY_FILL: Record<TriState, number> = {
	none: 0,
	some: 16,
	all: 32,
};

/**
 * The rule a resource inherits from: the wildcard for a schema, the
 * all-flows rule for one flow, nothing for those two themselves.
 */
export function parentOf(resource: string): string | null {
	if (resource === WILDCARD || resource === ALL_FLOWS) return null;
	return isFlowResource(resource) ? ALL_FLOWS : WILDCARD;
}

/** What the reader sees the parent rule called. */
export function parentLabel(resource: string): string {
	return parentOf(resource) === ALL_FLOWS ? 'All flows rule' : 'wildcard rule';
}

export function schemaLabel(schema: string): string {
	if (schema === WILDCARD) return 'every content type';
	return isFlowResource(schema) ? flowResourceLabel(schema) : schema;
}

/**
 * Folds a set of rows into one state by counting, never by every().
 *
 * every() is true over an empty array, so a role whose rows were all
 * filtered away would summarize as fully granted, and the operator would
 * read a blanket grant off a screen showing nothing.
 */
export function rollUp<T>(items: readonly T[], has: (item: T) => boolean): TriState {
	let granted = 0;
	for (const item of items) {
		if (has(item)) granted++;
	}
	if (granted === 0) return 'none';
	return granted === items.length ? 'all' : 'some';
}

/** What the load read: the rules, the schemas and the flows they can name. */
export interface RuleSource {
	permissions: Permission[];
	schemas: Schema[];
	flows?: FlowOption[];
}

export class RuleMatrix {
	#source: () => RuleSource;

	constructor(source: () => RuleSource) {
		this.#source = source;
	}

	readonly allRoles = $derived.by(() => {
		const set = new Set<string>(KNOWN_ROLES);
		for (const p of this.#source().permissions) set.add(p.role);
		return [...set];
	});

	// The flow resources beside the schemas: every flow of the tenant, then
	// one per flow the engine lists. A rule on `flows` reaches each
	// `flow:<slug>` with no rule of its own, the way the wildcard rule reaches
	// each schema.
	readonly resourceNames = $derived.by(() => {
		const source = this.#source();
		const schemaNames = source.schemas.map((s: Schema) => s.name);
		const flowResources = [ALL_FLOWS, ...(source.flows ?? []).map((f) => flowResource(f.slug))];
		return [...schemaNames, ...flowResources];
	});

	readonly permIndex = $derived.by(() => {
		const idx: Record<string, Record<string, Permission>> = {};
		for (const p of this.#source().permissions) {
			(idx[p.role] ??= {})[p.schema_name] = p;
		}
		return idx;
	});

	/**
	 * Every schema a role's summary is measured over: the schemas this instance
	 * defines, plus any the role still holds a rule for after the schema itself
	 * was dropped. A rule the operator can see has to count in the number above
	 * it, or the summary describes a different set of rows than the one on
	 * screen.
	 */
	readonly roleSchemas = $derived.by(() => {
		const out: Record<string, string[]> = {};
		const permissions = this.#source().permissions;
		for (const role of this.allRoles) {
			const set = new Set(this.resourceNames);
			for (const p of permissions) {
				if (p.role === role && p.schema_name !== WILDCARD) set.add(p.schema_name);
			}
			out[role] = [...set].sort((a, b) => a.localeCompare(b));
		}
		return out;
	});

	rule(role: string, schema: string): Permission | undefined {
		return this.permIndex[role]?.[schema];
	}

	/** Actions the parent rule grants, which the resource inherits. The wildcard's for a schema, the all-flows rule's for a flow. */
	inheritedActions(role: string, resource: string = 'schema'): string[] {
		const parent = parentOf(resource);
		return parent ? (this.rule(role, parent)?.actions ?? []) : [];
	}

	/**
	 * The actions the engine allows a role on a resource. A resource's own rule
	 * replaces its parent's, so the parent's actions count only where the
	 * resource has no rule of its own.
	 */
	effectiveActions(role: string, resource: string): string[] {
		const own = this.rule(role, resource);
		return own ? own.actions : this.inheritedActions(role, resource);
	}

	ruleCount(role: string): number {
		return Object.keys(this.permIndex[role] ?? {}).length;
	}

	/**
	 * A collapsed role still has to say what it grants. It counts what the
	 * engine allows: a schema with no rule of its own takes the wildcard rule,
	 * and a schema with one takes that rule alone.
	 */
	granted(role: string, name: string, action: Action): boolean {
		return this.effectiveActions(role, name).includes(action);
	}

	/** The bar's state, over every resource the action applies to. */
	summaryState(role: string, action: Action): TriState {
		return rollUp(
			(this.roleSchemas[role] ?? []).filter((name) => applies(action, name)),
			(name) => this.granted(role, name, action),
		);
	}

	/**
	 * One sentence per kind of resource, because the wildcard rule reaches
	 * every schema and no flow: "every schema" and "some flows" are both
	 * true of one role at once, and a single word for both would be wrong
	 * about one of them.
	 */
	summaryText(role: string, action: Action): string {
		const names = this.roleSchemas[role] ?? [];
		const clause = (kind: 'content type' | 'flow', state: TriState) => {
			if (state === 'none') return `${role} grants ${action} on no ${kind}.`;
			if (state === 'all') return `${role} grants ${action} on every ${kind}.`;
			return `${role} grants ${action} on some ${kind}s.`;
		};
		const flows = names.filter((name) => isFlowResource(name));
		const flowClause = clause('flow', rollUp(flows, (name) => this.granted(role, name, action)));
		if (action === 'activate') return flowClause;
		const schemas = names.filter((name) => !isFlowResource(name));
		return `${clause('content type', rollUp(schemas, (name) => this.granted(role, name, action)))} ${flowClause}`;
	}

	markFor(role: string, schema: string, action: Action): Mark {
		if (role === EXEMPT_ROLE) return 'exempt';
		// A resource's own rule replaces its parent's, so the parent's grant
		// shows only on a resource without one. The wildcard row and the
		// all-flows row are the parents, so they inherit nothing.
		const own = this.rule(role, schema);
		if (own) return own.actions.includes(action) ? 'stored' : 'none';
		return this.inheritedActions(role, schema).includes(action) ? 'inherited' : 'none';
	}

	markText(role: string, schema: string, action: Action): string {
		const where = schemaLabel(schema);
		switch (this.markFor(role, schema, action)) {
			case 'exempt':
				return `${role} is always allowed ${action} on ${where}. The role is exempt from these rules.`;
			case 'stored':
				return `${role} is granted ${action} on ${where} by this rule.`;
			case 'inherited':
				return `${role} is granted ${action} on ${where} by the ${parentLabel(schema)}, because ${where} has no rule of its own.`;
			default:
				if (this.rule(role, schema) && this.inheritedActions(role, schema).includes(action)) {
					return `${role} is denied ${action} on ${where}. This rule replaces the ${parentLabel(schema)}, which grants it.`;
				}
				return `${role} is denied ${action} on ${where}.`;
		}
	}

	/**
	 * Whether a rule on this resource takes away a grant the role holds
	 * without it. An empty rule still denies what it replaces: the parent
	 * rule's actions, or the standing grant admin holds on a flow until a rule
	 * names admin there. Only a rule that replaces nothing does nothing.
	 */
	replacesAGrant(role: string, resource: string): boolean {
		if (resource === '') return false;
		return this.inheritedActions(role, resource).length > 0 || (role === 'admin' && isFlowResource(resource));
	}

	/** Resources the role has no rule for yet, which is what a new rule can name. */
	unruledSchemas(role: string): { value: string; label: string }[] {
		return (this.roleSchemas[role] ?? [])
			.filter((name) => !this.rule(role, name))
			.map((name) => ({ value: name, label: isFlowResource(name) ? flowResourceLabel(name) : name }));
	}
}
