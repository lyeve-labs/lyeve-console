// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import RulesLegend from './RulesLegend.svelte';

afterEach(cleanup);

describe('RulesLegend', () => {
	it('says what each mark and bar in the matrix stands for', () => {
		const { container } = render(RulesLegend);
		const text = (container.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toContain('A filled dot is a stored grant, a ring is an inherited grant and a dash is a denied action.');
		expect(text).toContain('A shield marks a role these rules never limit.');
		expect(text).toContain('half full on some content types and full on all');
	});

	it('names the exempt role and says a schema rule replaces the wildcard rule', () => {
		const { container } = render(RulesLegend);
		const text = (container.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toContain('super_admin is never limited by these rules.');
		expect(text).toContain('A content type rule replaces the wildcard rule on that content type.');
	});
});
