// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidate, invalidateAll } from '$app/navigation';
import RefreshButton from './RefreshButton.svelte';

vi.mock('$app/navigation', () => ({ invalidate: vi.fn(), invalidateAll: vi.fn() }));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('RefreshButton', () => {
	it('reloads every load and stays busy until the reload ends', async () => {
		let finish = () => {};
		vi.mocked(invalidateAll).mockReturnValue(new Promise<void>((r) => (finish = r)));
		const { getByRole } = render(RefreshButton);
		const button = getByRole('button', { name: /Refresh/ });
		await fireEvent.click(button);
		expect(invalidateAll).toHaveBeenCalledOnce();
		expect(button.getAttribute('aria-busy')).toBe('true');
		finish();
		await vi.waitFor(() => expect(button.getAttribute('aria-busy')).not.toBe('true'));
	});

	it('reloads only the named dependency when given one', async () => {
		vi.mocked(invalidate).mockResolvedValue();
		const { getByRole } = render(RefreshButton, { props: { dependency: 'app:imports' } });
		await fireEvent.click(getByRole('button', { name: /Refresh/ }));
		expect(invalidate).toHaveBeenCalledWith('app:imports');
		expect(invalidateAll).not.toHaveBeenCalled();
	});
});
