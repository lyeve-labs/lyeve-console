import { describe, expect, it } from 'vitest';
import { listQueryFrom } from './entry-view';

describe('listQueryFrom', () => {
	it('hands back every value of the list view and nothing else', () => {
		const url = new URL(
			'http://localhost/admin/content/posts/e1?filters[author][in]=a1&filters[author][in]=a2&sort=title&tab=history&q=x&offset=100',
		);
		const back = new URLSearchParams(listQueryFrom(url).slice(1));
		expect(back.getAll('filters[author][in]')).toEqual(['a1', 'a2']);
		expect(back.get('sort')).toBe('title');
		expect(back.get('q')).toBe('x');
		expect(back.get('offset')).toBe('100');
		expect(back.has('tab')).toBe(false);
	});

	it('is empty when the detail URL carries no view', () => {
		expect(listQueryFrom(new URL('http://localhost/admin/content/posts/e1'))).toBe('');
	});
});
