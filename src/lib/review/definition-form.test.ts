import { describe, expect, it } from 'vitest';
import { parseStages } from './definition-form';

describe('parseStages', () => {
	it('keeps the order and trims what the drawer sent', () => {
		const parsed = parseStages(
			JSON.stringify([
				{ name: ' Copy edit ', required_role: 'editor ', sla_duration_seconds: 3600 },
				{ name: 'Sign-off', required_role: '', sla_duration_seconds: 0 },
			]),
		);
		expect(parsed).toEqual({
			stages: [
				{ name: 'Copy edit', required_role: 'editor', sla_duration_seconds: 3600 },
				{ name: 'Sign-off', required_role: '', sla_duration_seconds: 0 },
			],
		});
	});

	it('names the row that is wrong', () => {
		expect(parseStages('[]')).toEqual({ error: 'A definition needs at least one stage.' });
		expect(parseStages(JSON.stringify([{ name: 'a' }, { name: '' }]))).toEqual({ error: 'Stage 2 needs a name.' });
		expect(parseStages(JSON.stringify([{ name: 'a', sla_duration_seconds: 900000 }]))).toEqual({
			error: 'Stage 1: enter an SLA from 0 to 240 hours.',
		});
		expect(parseStages('not json')).toEqual({ error: 'Could not load the stages. Reload the page to try again.' });
	});
});

describe('parseStages, the paid stage settings', () => {
	const stage = (over: Record<string, unknown>) => JSON.stringify([{ name: 'Legal', sla_duration_seconds: 3600, ...over }]);

	it('sends none of them for a row that sets none, so a definition that needs no license is never refused', () => {
		expect(parseStages(stage({ quorum: 1, escalate_kind: 'none', escalate_to: 'x', condition_field: '' }))).toEqual({
			stages: [{ name: 'Legal', required_role: '', sla_duration_seconds: 3600 }],
		});
	});

	it('sends a quorum above one', () => {
		expect(parseStages(stage({ quorum: 3 }))).toMatchObject({ stages: [{ quorum: 3 }] });
		expect(parseStages(stage({ quorum: 101 }))).toEqual({ error: 'Stage 1: enter from 0 to 100 approvals.' });
	});

	it('sends an escalation to a role or a user id, and only with an SLA', () => {
		expect(parseStages(stage({ escalate_kind: 'role', escalate_to: 'legal-lead' }))).toMatchObject({
			stages: [{ escalate_to_role: 'legal-lead' }],
		});
		const id = '0b5a3c3e-1f2d-4c5b-8a9e-0123456789ab';
		expect(parseStages(stage({ escalate_kind: 'user', escalate_to: id }))).toMatchObject({
			stages: [{ escalate_to_user_id: id }],
		});
		expect(parseStages(stage({ escalate_kind: 'user', escalate_to: 'ana' }))).toEqual({
			error: 'Stage 1: enter the id of the user to hand it to.',
		});
		expect(parseStages(stage({ sla_duration_seconds: 0, escalate_kind: 'role', escalate_to: 'lead' }))).toEqual({
			error: 'Stage 1: escalation follows an SLA breach, so set an SLA.',
		});
	});

	it('sends a condition in the shape its operator takes', () => {
		expect(parseStages(stage({ condition_field: 'category', condition_op: 'equals', condition_value: 'legal' }))).toMatchObject({
			stages: [{ condition: { field: 'category', op: 'equals', value: 'legal' } }],
		});
		expect(parseStages(stage({ condition_field: 'region', condition_op: 'in', condition_value: 'eu, uk\nus' }))).toMatchObject({
			stages: [{ condition: { field: 'region', op: 'in', values: ['eu', 'uk', 'us'] } }],
		});
		expect(parseStages(stage({ condition_field: 'embargo', condition_op: 'exists', condition_value: 'ignored' }))).toMatchObject({
			stages: [{ condition: { field: 'embargo', op: 'exists' } }],
		});
		expect(parseStages(stage({ condition_field: 'category', condition_op: 'equals', condition_value: '' }))).toEqual({
			error: 'Stage 1: give the condition a value to compare with.',
		});
	});
});
