import type { SubmitFunction } from '$app/forms';
import { toast } from '@lyeve-labs/ui-kit';

/** Closes a drawer unless its save failed, so a refusal shows inside it, and toasts a success. */
export function closing(close: () => void, message: string): SubmitFunction {
	return () =>
		async ({ result, update }) => {
			if (result.type !== 'failure') close();
			await update();
			if (result.type === 'success') toast.success(message);
		};
}
