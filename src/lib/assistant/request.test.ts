import { describe, expect, it } from 'vitest';
import { readRequest } from './request';

describe('the request the console forwards', () => {
	it('keeps only what the panel sends, so the browser cannot choose the provider', () => {
		const out = readRequest({
			prompt: '  Write the summary  ',
			provider_id: 'p1',
			extra: true,
			conversation_id: '7f0c4f53-8e0a-4a3c-9df4-6c2c2f1e3a10',
			page: { path: '/admin/content/articles/new', title: 'New entry' },
			form: { label: 'New Articles entry', fields: [{ name: 'title', label: 'title', kind: 'text', value: 'Hi', bogus: 1 }] },
		});
		expect(out).toEqual({
			prompt: 'Write the summary',
			conversation_id: '7f0c4f53-8e0a-4a3c-9df4-6c2c2f1e3a10',
			page: { path: '/admin/content/articles/new', title: 'New entry' },
			form: { label: 'New Articles entry', fields: [{ name: 'title', label: 'title', kind: 'text', value: 'Hi' }] },
		});
	});

	it('drops the value and the name of a withheld field even if the browser sent them', () => {
		const out = readRequest({ prompt: 'x', form: { label: 'F', fields: [{ name: 'notes', label: 'notes', kind: 'text', withheld: true, value: 'secret' }] } });
		expect(out?.form?.fields).toEqual([{ label: 'notes', kind: 'text', withheld: true }]);
	});

	it('refuses an empty prompt and a conversation id that is not one', () => {
		expect(readRequest({ prompt: '   ' })).toBeNull();
		expect(readRequest({ prompt: 'x', conversation_id: '../x' })).toEqual({ prompt: 'x' });
	});
});
