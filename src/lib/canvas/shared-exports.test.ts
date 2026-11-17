import { describe, expect, it } from 'vitest';
import * as graph from '#lib/flow/graph.ts';
import * as types from '#lib/flow/types.ts';
import * as fixtures from '#lib/flow/fixtures.ts';
import * as categories from '#lib/flow/categories.ts';
import * as time from '#lib/flow/time.ts';
import * as relations from '#lib/relations.ts';
import * as icon from '#lib/icon.ts';

/**
 * Every runtime name the visual editors import from the admin's library, read
 * from the editors at the commit the image build pins. A build without them
 * calls none of these, so a dead code pass sees no reader. Losing one fails
 * the official image, and this test fails first in the pull request that
 * removed it. The editors' other imports are types only, which the type check
 * covers when the editors are in place.
 */
const USED: [string, Record<string, unknown>, string[]][] = [
	[
		'#lib/flow/graph.ts',
		graph,
		[
			'TRIGGER_OUTPUTS',
			'addEdge',
			'addNode',
			'addNote',
			'canConnect',
			'configSummary',
			'edgeId',
			'fromPort',
			'inputsOf',
			'moveNodes',
			'nodeById',
			'outputsOf',
			'removeEdge',
			'removeNodes',
			'removeNote',
			'rootNodes',
			'specFor',
			'toPort',
			'topoDepths',
			'updateNote',
		],
	],
	['#lib/flow/types.ts', types, ['TRIGGER_ID']],
	[
		'#lib/flow/fixtures.ts',
		fixtures,
		['blockedFlow', 'fixtureCatalog', 'fixtureFlow', 'fixtureRun', 'fixtureTemplates', 'joinFlow', 'missingTypeErrors', 'respondingFlow'],
	],
	['#lib/flow/categories.ts', categories, ['categoryIcon', 'categoryStripe', 'categoryText']],
	['#lib/flow/time.ts', time, ['formatDuration']],
	['#lib/relations.ts', relations, ['pivotTable', 'relationKind', 'tableName']],
	['#lib/icon.ts', icon, ['ICON']],
];

describe('the library names the visual editors import', () => {
	for (const [path, module, names] of USED) {
		it.each(names)(`${path} still exports %s`, (name) => {
			expect(module[name], `${path} exports ${name}`).toBeDefined();
		});
	}
});
